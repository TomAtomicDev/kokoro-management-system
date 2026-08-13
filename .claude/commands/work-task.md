---
description: Work one backlog task or a block of tasks end to end as orchestrator over Codex workers via Orca
argument-hint: <TASK-ID> | <FIRST-ID>..<LAST-ID> | <ID,ID,ID>
---
# Orchestrate backlog scope $ARGUMENTS

Source of truth: `docs/system-design-knowledge-base/10-implementation-backlog.md`.

You are the **orchestrator**: strategist, architect, decision-maker. Codex workers implement scoped mechanical units  
through Orca. You own architecture, ambiguity resolution, interfaces, dependency  
ordering and every decision gate.

`$ARGUMENTS` may be a single task, a range or a list. A single task is just a block of one: the whole procedure below applies, and the block phases collapse to near-zero work.

## Prime directive: your context is the scarce resource

Your own context window is the bottleneck, not worker time and not worker cost. A fifty-task block **will not fit in one session of yours** — the workflow is designed
so that it does not have to. Everything durable lives in the ledger; you carry as
little as possible between tasks.

**You read:** backlog rows, KB rules you quote into specs, worker reports (bounded),
targeted diffs of contract surfaces, escalations.

**You do not read:** full file bodies a worker could summarize, test output, lint
output, diffs of files with no contract surface, generated boilerplate you already
specified, diffs of tasks already accepted, or Orca internals while things work.

When in doubt: dispatch a worker to answer in ≤30 lines instead of reading source.

---

## Phase 0 — Bootstrap the block

1. Derive `BLOCK-ID` (e.g. `KOK-100..120`, or the task id if scope is one task) and
   read `docs/development/.runs/{BLOCK-ID}/ledger.md`.
   - **If it exists this is a resume.** Read *only* the ledger. Verify the Run and
     worktrees still exist (`orca status --json`, `orca orchestration run-show`).
     Jump to the first task whose status is not `done` or `blocked`. Do not re-ground,
     do not re-plan, do not re-read accepted diffs, do not re-read rows of finished
     tasks.
   - If it does not exist, continue.
2. `orca status --json`.
3. Load the version-matched skills, both of them, before dispatching anything:
   - `orca skills get orca-cli`
   - `orca skills get orchestration --full`

   These are **authoritative**. Where this prompt and a skill disagree on a command
   name, a flag, a lifecycle state or a completion semantic, **the skill wins and this
   prompt is wrong** — follow the skill and note the divergence in the ledger's
   `Open questions` so the prompt gets fixed. Never infer a flag from this prompt.

   Load them once per session and use the documented **supervised orchestration** path
   throughout. On a resume this step repeats: a fresh session has no skills loaded, and
   the ledger records state, not procedure. Do not re-load them between tasks within
   the same session.
4. Create one Run for the whole block:
   `orca orchestration run-create --objective "{BLOCK-ID}: <block objective>" --json`
5. Create `docs/development/.runs/{BLOCK-ID}/ledger.md` (template at the end).

---

## Phase 1 — Block triage and task ordering

Read **all** rows in scope once. This is the only time you read them all together.
Produce, into the ledger:

- **Domain clusters.** Group rows by the surface they touch (schema/domain, service,
  web, i18n…). Rows in the same cluster share contracts and must be serialized.
- **Task DAG.** Edges come from: schema/migration before anything consuming it;
  service contract before its callers; `full`-area rows before `web` rows on the same
  noun; explicit references between descriptions. When a row's description already
  states that another row's change is a prerequisite, that is an edge — do not rely
  on ID order, which is not dependency order.
- **Migration ordering owner.** If more than one task ships a migration, fix their
  relative order now and record it. Two workers inventing migration timestamps in
  parallel is a merge conflict you cannot delegate away.
- **KB amendment collisions.** If several rows amend the same doc section, decide who
  writes the amendment and who merely references it.
- **Per-task lane** from 🧠 and Size (see Phase 4).

Then **stop and show the user** the task order, the clusters, the parallelism plan and
anything you consider genuinely ambiguous at block level. This is the cheapest moment
in the whole run to correct a wrong ordering; after this checkpoint you proceed
autonomously until Phase 6.

---

## Phase 2 — Block grounding (once, not per task)

One grounding unit **per domain cluster**, not per task. Give the worker the rows of
that cluster together and ask for the shared picture.

Rows already carrying a verified analysis (a `Verified <date>` block with concrete
symbols, files or behaviours) do not get a rediscovery pass. For those, grounding is
narrowed to: *confirm these specific claims still hold on `develop`, list what
changed.* Nothing else.

Grounding output contract — state literally in the spec:

> Output ≤50 lines of markdown. Sections: `TOUCHED` (file:line, one per line, ≤10-word
> note, and which task ids in this cluster touch it), `SHARED` (files or symbols
> touched by more than one task in the cluster), `RULES` (Doc 03/04 refs + one-line
> paraphrase), `PRECEDENT` (existing vertical, paths only), `CONTRADICTIONS` (anything
> in a row that does not match the code). No code except type/function signatures.
> No design proposals. Modify nothing.

The `SHARED` section is the one that matters most at block level — it is your conflict
map. Record it in the ledger.

For clusters whose top 🧠 is 4–5, personally verify only the two or three claims the
block design hinges on.

---

## Phase 3 — Freeze block contracts

Before any implementation dispatch, write into the ledger, as literal code:

- schema/migration shape and order;
- every type/signature crossing a **task** boundary;
- validation and error-shape conventions the whole block must share (e.g. how
  `message_es` surfaces to the client);
- i18n key ownership: which task adds which keys, so two tasks do not both add them.

These are frozen. A task that needs to change a frozen contract does not change it —
it escalates to you, you amend the ledger, and you record which already-accepted tasks
must be revisited. Unfrozen contracts are the single most expensive failure mode in a
block, because they invalidate work you already paid to review.

---

## Phase 4 — Worktree and parallelism strategy

Default: **one Orca-managed worktree for the whole block**, branch
`feat/{block-slug}` off `develop`, one commit per task. This is the cheap path and
the right default for a block whose tasks share a domain.

Use a separate worktree per task only when tasks are in different clusters with a
**disjoint file set** from `SHARED`, and run at most 2–3 concurrent tasks. Concurrency
multiplies escalations arriving at you out of order, which costs you more context than
the wall-clock time it saves. Never parallelize two tasks that appear together in
`SHARED`.

Record worktree selector/id, branch and Run ID in the ledger.

---

## Phase 5 — Per-task loop

For each task in DAG order. Everything below concerns **one** task; do not carry the
previous task's details into it.

### 5.1 Lane

| 🧠  | Extra grounding | Planning |
| --- | --------------- | -------- |
| 1–2 | none | worker proposes the unit list, you approve in one pass |
| 3   | only if the task touches something outside the cluster grounding | you write the plan |
| 4–5 | narrow, targeted at the specific gap | you write the plan and resolve every ambiguity first |

### 5.2 Plan and decompose

Write the vertical plan yourself from the row plus the ledger's frozen contracts —
not from a fresh reading of the codebase. Resolve KB ambiguity **before** dispatching:
a worker hitting ambiguity mid-unit costs you an escalation round trip.

Build a DAG of Codex-sized units. Each unit spec contains:

**SCOPE** — exact files, exact responsibility.
**ANTI-SCOPE** — files it must not touch; no renames, no drive-by refactors, no new
dependencies, no changes to the acceptance command, **no changes to any frozen
contract**. If something outside scope looks wrong, report it, do not fix it.
**INPUTS** — literal type signatures pasted from the ledger (paste, do not describe)
and the verbatim KB rule text governing the unit.
**FIT** — what calls this, what this calls.
**ACCEPTANCE** — exact command(s) and passing condition, including `pnpm check` scoped
to the touched packages. Not done until it passes in the worktree.
**DEPENDENCIES** — upstream Task IDs.
**REPORT** — ≤25 lines: files changed with one-line rationale each, acceptance command
and verdict, and an `UNCERTAIN` section listing every decision the worker guessed. An
empty `UNCERTAIN` is a claim you will check.
**ESCALATION** — ambiguity, contradiction with the code, or a choice between two valid
interpretations: stop and ask via the Orca worker contract. Guessing is a failure,
not initiative.

Prefer more, smaller units; recovery from a bad small unit is cheap.

### 5.3 Dispatch

1. Create the Orca Task preserving dependency order.
2. `orca orchestration worker-start ... --agent codex --json`. Record task id,
   dispatch id, terminal handle, worktree in the task's ledger row.
3. **Verify the worker entered the task.** A successful return, `input_accepted` or
   `tui-idle` are not proof — look for evidence of a real Codex turn
   (`worker-show` / `worker-read` / `dispatch-show`). If the spec sits unsubmitted in
   the composer, send Enter only; never re-paste a prompt already present.
4. If it did not start and one Enter retry does not fix it, **stop improvising**: apply
   the recovery primitives documented in the `orchestration` skill first, and only if
   they do not cover the case, read `docs/development/orca-failure-playbook.md` and
   follow it. Documented Orca recovery always beats terminal manipulation. Do not spawn
   more workers before inspecting the existing terminal.
5. Wait with Orca's own primitive
   (`orca orchestration check --wait --types worker_done,escalation,question ... --json`).
   Never a background Bash polling loop. A timeout is neither completion nor failure:
   inspect `worker-show`, `worker-read`, `dispatch-show` and decide whether the worker
   is working, finished but lost its lifecycle report, or never started.

### 5.4 Decision gate — two stages

**Stage 1 (Codex, mechanical).** A *separate* review unit against the diff: matches
SCOPE and ANTI-SCOPE, acceptance command passes on a clean run, no stubs/TODOs/
commented-out code, touches nothing forbidden, no frozen contract altered, user-facing
strings in Spanish and sourced from the i18n modules rather than inlined.
Output: `PASS` / `FAIL` + ≤15 lines.

**Stage 2 (you, semantic).** Only after Stage 1 passes. Read
`git diff -- <contract-surface files>` — the files carrying interface, schema,
validation or KB rule, not the whole diff. Judge: KB rule honoured as written, golden
rules, promised interface, downstream compatibility. For 🧠 1–2 units with a clean
Stage 1 and an empty `UNCERTAIN`, `git diff --stat` plus the report is enough.

No dependent unit unlocks before its upstream verdict is `accepted`.

**Retry limit: 2 corrective dispatches per unit.** On the third failure: either the
spec is wrong (rewrite it, restart the unit as a new Task) or the unit is not
mechanical (do it yourself, note why in the ledger).

### 5.5 Task close and **checkpoint & forget**

When every unit of the task is accepted:

1. Tests/UI verification as their own scoped units, same REPORT contract. Trust a
   green result only when the worker ran the specified command, the output matches
   this worktree, and the dispatch settled normally. A failing test caused by a wrong
   design escalates to you — never let a worker redesign to make a test pass.
2. Mechanical unit: commit referencing the task id; backlog row → `✅ Done`.
3. `docs/development/{task-id}-{slug}.md` **only** if the task produced a decision,
   deviation, subtle edge case or reusable precedent. Routine implementation gets no doc.
4. Update the ledger: task status `done`, plus — and this is the part that makes the
   block work — **any contract delta, precedent or gotcha the *next* tasks need, in
   ≤10 lines.** Everything else about this task is now disposable.
5. Then deliberately drop the task from your working memory. Do not re-read its diff,
   its report or its row again. If a later task needs something from it, the ledger has
   it; if the ledger does not have it, that is a ledger bug — fix the ledger, not your
   memory.
6. **Context check.** If you judge you are past roughly two thirds of your usable
   context, stop here. Tell the user the block is checkpointed at task N and that a
   fresh session running this same command with the same block id will resume from the
   ledger. Do not start another task on fumes — a task abandoned mid-DAG costs more to
   recover than it cost to run.

### 5.6 Blocked tasks

A task that cannot proceed (twice-failed spec, unresolved KB contradiction, dependency
on a decision the user must make) is marked `blocked` with a one-line reason. **Continue
with the tasks it does not block.** Never halt the whole block for one task, and never
guess your way past it.

---

## Phase 6 — Block close

Only once every task is `done` or `blocked`:

1. One mechanical unit: `pnpm lint:fix && pnpm format && pnpm check` (confirmation
   only — each unit already passed its own check).
2. Review the cumulative diff yourself, restricted to the `SHARED` surfaces from
   Phase 2 and to anything Stage 2 flagged. This is the review that catches what
   per-task review structurally cannot: two tasks that each honoured the contract but
   are inconsistent with each other.
3. Present to the user: tasks done, tasks blocked and why, decisions you made that the
   KB did not settle, contract deltas that outlive the block, and the proposed merge.
   **The merge into `develop` is the user's call, not yours.**
4. Delete the ledger only after the user confirms.

---

## Ledger

`docs/development/.runs/{BLOCK-ID}/ledger.md` — updated after every gate, never at the
end. It exists so a fresh session resumes the block without re-reading anything.

```md
# {BLOCK-ID} — ledger
run_id: | branch: | worktree(s): | started:
## Task DAG
| task | area | size | 🧠 | deps | lane | status | note |
(status: pending | planning | in-progress | review | done | blocked)
## Clusters & SHARED surfaces
<file/symbol -> tasks that touch it>
## Frozen contracts
<literal signatures, schema shape, migration order, i18n key ownership>
## Decisions
<ambiguity -> resolution -> KB ref -> tasks affected>
## Carry-forward
<≤10 lines per finished task: what later tasks must know>
## Open questions for the user
## Units (current task only)
| id | scope | deps | task_id | dispatch_id | status | verdict |
```

Prune the `Units` table when a task closes; it is scratch space, not history.

---

## Invariants

0. Both Orca skills are loaded before the first dispatch of every session, and they —
   not this prompt — define command names, flags, lifecycle states and completion
   semantics.
1. Worker output that reaches your eyes is always bounded and formatted by contract.
2. A worker never resolves KB ambiguity, never picks between valid interpretations of a
   golden rule, never widens its own scope. Uncertainty escalates to you.
3. Frozen contracts are changed by you in the ledger, never by a worker in a diff.
4. Never start a dependent unit or task before its upstream verdict is `accepted`.
5. Never blindly re-send an injected prompt; inspect before retrying.
6. Never leave an orphaned Dispatch appearing active.
7. Never poll for completion with a background Bash loop.
8. Two corrective dispatches per unit, then re-spec or self-implement.
9. One blocked task never halts the block.
10. The ledger is updated before you move on, always.


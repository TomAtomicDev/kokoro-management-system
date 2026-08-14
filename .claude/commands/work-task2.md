---
description: Work one backlog task or a block of tasks end to end as orchestrator over Codex workers via Orca
argument-hint: <TASK-ID> | <FIRST-ID>..<LAST-ID> | <ID,ID,ID>
---
# Orchestrate backlog scope $ARGUMENTS

Source of truth: `docs/system-design-knowledge-base/10-implementation-backlog.md`.

You are the **orchestrator**: strategist, architect, decision-maker. Codex workers
(GPT-5.6-luna, fast and cheap, moderately smart) implement scoped mechanical units
through Orca. You own architecture, ambiguity resolution, interfaces, dependency
ordering and every decision gate.

`$ARGUMENTS` may be a single task, a range or a list.  
A single task is just a block of one: the whole procedure below applies, and the  
block phases collapse to near-zero work.

## Prime directive: your context is the scarce resource

Your own context window is the bottleneck, not worker time and not worker cost. A
twenty-task block **will not fit in one session of yours** — the workflow is designed
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


| 🧠  | Extra grounding                                                  | Planning                                               |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| 1–2 | none                                                             | worker proposes the unit list, you approve in one pass |
| 3   | only if the task touches something outside the cluster grounding | you write the plan                                     |
| 4–5 | narrow, targeted at the specific gap                             | you write the plan and resolve every ambiguity first   |


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

### 5.3 Specs live in files, not in the composer

Do **not** paste unit specifications into Codex. Write each one to
`.orca/specs/{task-id}-{unit-id}.md` inside the worktree (create the directory, keep it
untracked) and dispatch a short instruction instead:

> Read `.orca/specs/KOK-130-u2.md` and execute it exactly. It is your complete
> specification; do not widen it. Write your final report to
> `.orca/reports/KOK-130-u2.md` and then print the single line
> `TASKCOMPLETE-{nonce}: <one-line summary>`.

This is the single highest-leverage mitigation for the injection problem, because every
known failure mode scales with paste size: a three-line instruction rarely triggers the
`[Pasted Content N chars]` path, resubmitting costs nothing, the spec text can never be
mangled or truncated in transit, sentinel strings never appear in scrollback as part of
an echoed prompt, and you can diff the spec file to prove what the worker actually
received. Read reports from the file, not from terminal scrollback.

### 5.4 Dispatch and startup protocol

Codex injection through Orca is **unreliable in this environment** — treat a failed
start as normal, not exceptional. Observed: `worker-start` and worktree-level
`--agent codex` frequently race Codex's TUI readiness; the text lands in the composer
unsubmitted, or is lost before it lands. `terminal wait --for tui-idle` returns
`satisfied: true` while Codex is still in MCP startup, so it is **not** a readiness
signal. Failures cluster in freshly created worktrees (three consecutive failed
`worker-start` attempts observed in a new worktree, while the first dispatch into a
pre-existing worktree succeeded immediately).

**Warm the worktree before the first real dispatch.** After creating a worktree, start
the terminal, wait for idle, then send a trivial probe turn (e.g. `pwd && git branch --show-current`) and confirm from the terminal that Codex actually produced a turn and
returned to idle. Only then dispatch real work. A worktree that has served one
successful turn is far less likely to eat the next injection. Never let the first thing
a fresh worktree receives be a real specification.

Then, per unit:

1. Create the Orca Task preserving dependency order. Record task id, dispatch id,
 terminal handle and worktree in the ledger row.
2. Attempt the supervised path **first, always**: `orca orchestration worker-start ...  --agent codex --json`, or the documented `orca orchestration dispatch --inject` when
 dispatching into an existing terminal. A successful return proves nothing.

  **Never send with `orca terminal send` before attempting supervised injection.** A
   terminal that received its instruction that way holds no capability token, so
   `worker_done` is impossible for it and the unit is silently stuck in degraded mode
   with an empty `dispatch_id` — for the rest of that unit's life, and for anyone
   resuming the block later. This has already happened on this backlog and it is
   orchestrator error, not an Orca limitation. `terminal send` is a recovery tool
   (§5.5), never an opening move.
3. **Verify a real Codex turn started.** `input_accepted`, `tui-idle` and command
 success are all insufficient. Use `worker-show` / `worker-read` / `dispatch-show`
 and, when needed, the terminal tail. What counts as proof is evidence of an actual
 turn or task start — the model working, not the text existing.
4. If the text is in the composer but unsubmitted, send a **separate, empty submit**
 (`terminal send --text "" --enter`). A combined send-with-enter is not sufficient;
 verification and resubmission are two distinct steps. Never re-paste content that
 is already present.
5. If two submit attempts do not produce a turn, stop retrying the supervised path and
 degrade this attempt to §5.5. Do not spawn additional workers before inspecting the
 existing terminal — a second worker on a stuck worktree has failed every time it
 has been tried here.
6. Once a turn is confirmed, wait with Orca's own primitive
 (`orca orchestration check --wait --types worker_done,escalation,question ... --json`).
 A timeout is neither completion nor failure: inspect `worker-show`, `worker-read`,
 `dispatch-show`, and decide whether the worker is working, finished but lost its
 lifecycle report, or never started.

### 5.5 Degraded mode — manual terminal dispatch

Use only after §5.4 step 5. The two completion semantics are **mutually exclusive**;
never mix them.

A Codex session that received its instruction through `orca terminal send` holds no
dispatch-capability token, so `orca orchestration send --type worker_done` will simply
fail for it. Therefore:

1. Reuse the existing stable terminal; wait for idle. Do not create a new one.
2. Generate a nonce for this attempt. The instruction (short, per §5.3) must state
 explicitly: **do not call `orca orchestration send`, `worker_done`, heartbeat, ask,
 gate, or any other orchestration command**; finish by printing
 `TASKCOMPLETE-{nonce}: <summary>` as the final line.
3. Send, then verify delivery in the terminal tail, then submit separately with an
 empty `--enter`. Confirm a turn started before waiting for anything.
4. Poll for the sentinel with **≥2 occurrences required**, never a substring test: the
 instruction itself is echoed into scrollback and matches on the first tick. If the
 short-instruction convention of §5.3 is followed the sentinel appears only in the
 spec file, but keep the ≥2 rule regardless — it costs nothing and it is the exact
 false positive that has already burned a run here.
5. Poll with the durable Monitor mechanism (`persistent: true`), **quiet**: emit output
 only on a real match, never per tick, or it gets throttled for noise. Do not use
 backgrounded Bash loops — they have been killed unpredictably at ~30 s and at
 ~630 s with no diagnostic. Monitor itself has died mid-run (`exit 4`), so bound the
 wait: on monitor death, re-inspect the terminal and the report file once before
 assuming anything, and never treat monitor termination as task failure.
6. Verify the work independently of the sentinel: the expected files changed, the
 report file written, the acceptance command run. The sentinel proves the worker
 stopped, not that it succeeded.
7. **Reconcile the Orca Dispatch.** It is now orphaned and still looks active. Close or
 recover it with the documented lifecycle commands before moving on, and never record
 a sentinel as a `worker_done`.

Log every degradation in the ledger: unit, why supervised injection failed, and whether
the worktree was fresh. If a worktree degrades twice, stop using it for new workers and
say so in the ledger — that is a worktree problem, not a unit problem.

### 5.6 Dispatch granularity — batch units, do not batch context

Every Dispatch re-injects Orca's lifecycle preamble (task id, worker_done/escalation/
question contract, capability token). This is not chatter you can suppress: the
preamble is what authenticates that specific `worker_done` back to that specific
dispatch, and there is no CLI knob to shrink it on a reused terminal. It is re-injected
per **Dispatch**, not per terminal — so reusing a warm terminal does not reduce it, it
merely stacks several preambles plus unrelated prior work into one context window.

**Unit granularity and dispatch granularity are different decisions.** Keep units small
— they are your review boundary. Make dispatches coarser: a run of sequential,
same-scope, low-stakes units belongs in **one** Dispatch, with one spec file per unit
read in order within a single Codex turn:

> Read `.orca/specs/KOK-133-u2.md`, execute it, then `.orca/specs/KOK-133-u3.md`, then
> `.orca/specs/KOK-133-u4.md`, in that order. Complete each fully, including its
> acceptance command, before starting the next. Commit after each one, with the unit id
> in the message. Write one report per unit to `.orca/reports/`.

Batch a run of units when **all** of these hold:

- same file scope, or scopes that do not overlap each other;
- 🧠 1–2 and mechanical;
- no unit's spec depends on reading or reviewing the previous unit's produced code;
- no unit in the run unblocks a *different* task in the block DAG;
- nothing in the run touches a frozen contract.

Split into separate Dispatches when a unit is architecturally load-bearing, when you
must review and commit before the next unit can even be specified correctly, or when
the run has a genuine escalation risk you want to catch early.

The cost of batching is coarser feedback: five units arrive together, and a wrong
decision in the first may have propagated. Mitigate with per-unit commits (so the
review gate stays per unit even though the dispatch was one) and by keeping batches to
roughly 3–5 units.

### 5.6b Terminal reuse — only for genuine context continuity

A warm terminal is worth reusing **only when the next work actually needs what that
session already holds**: a correction to the unit it just wrote, a follow-up on the same
files, a question about its own diff. In those cases reuse saves a real re-explanation.

For anything else, **prefer a fresh terminal**. Carrying an unrelated task's history
into a new unit is not free context, it is contamination: the worker has stale file
contents, superseded instructions, an earlier unit's ANTI-SCOPE, and now several Orca
preambles competing for attention. GPT-5.6-luna is moderately smart — a clean, short
context is the main thing keeping it on rails.

The warm-up finding in §5.4 is about *worktrees*, not about hoarding sessions: warm a
fresh terminal with a probe turn, do not reuse a dirty one to avoid warming a clean one.

Reuse only after Orca confirms the previous Dispatch settled — `worker_done` alone does
not make a terminal reusable — and use the documented lifecycle commands
(`worker-release`, `worker-retain`, follow-up dispatch, retry). If reuse is rejected or
ambiguous, inspect the previous Dispatch rather than re-injecting.

### 5.7 Decision gate — two stages

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

### 5.8 Task close and **checkpoint &amp; forget**

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

### 5.9 Blocked tasks

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
| id | scope | deps | task_id | dispatch_id | mode | status | verdict |
(mode: supervised | degraded — record why, and whether the worktree was fresh.
 An empty dispatch_id with no recorded supervised failure is an orchestrator error.)
 Batched units share one dispatch_id; keep one row per unit anyway.
## Terminal health
<worktree -> warm/settled terminal handle, degradations so far>
```

Prune the `Units` table when a task closes; it is scratch space, not history.

---

## Invariants

1. Both Orca skills are loaded before the first dispatch of every session, and they —
 not this prompt — define command names, flags, lifecycle states and completion
 semantics.
2. Worker output that reaches your eyes is always bounded and formatted by contract.
3. A worker never resolves KB ambiguity, never picks between valid interpretations of a
 golden rule, never widens its own scope. Uncertainty escalates to you.
4. Frozen contracts are changed by you in the ledger, never by a worker in a diff.
5. Never start a dependent unit or task before its upstream verdict is `accepted`.
6. Never blindly re-send an injected prompt; verify, then submit separately.
5a. Supervised injection is always attempted before any `terminal send`. An empty
 `dispatch_id` in the ledger means the unit was degraded — if it was degraded without
 a failed supervised attempt recorded above it, that is a bug in your own procedure.
5b. Supervised completion (`worker_done`) and sentinel completion are mutually
 exclusive. A manually dispatched worker never uses `worker_done`; a supervised
 worker never uses a sentinel unless explicitly degraded.
5c. Never poll a sentinel by substring; require ≥2 occurrences.
7. Never leave an orphaned Dispatch appearing active after a degraded dispatch.
8. Never poll for completion with a background Bash loop. Every wait is bounded, and
 the death of a monitor is not the failure of a task.
9. Two corrective dispatches per unit, then re-spec or self-implement.
10. One blocked task never halts the block.
11. The ledger is updated before you move on, always.


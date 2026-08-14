---
description: Work a backlog task or block end to end as orchestrator over Codex workers via Orca (lean lane)
argument-hint: <TASK-ID> | <FIRST-ID>..<LAST-ID> | <ID,ID,ID>
---

# Orchestrate $ARGUMENTS

Backlog: `docs/system-design-knowledge-base/10-implementation-backlog.md`.

You are the orchestrator: architecture, ambiguity, interfaces, ordering, decisions.
Codex workers (GPT-5.6-luna — fast, cheap, moderately smart) implement to explicit
contracts. A worker never resolves KB ambiguity, never picks between readings of a
golden rule, never widens scope. Uncertainty escalates to you.

**Your context is the bottleneck.** A 20-task block will not fit in one session; it
does not have to. Read: rows, KB rules you quote, bounded reports, contract-surface
diffs, escalations. Don't read: full files, test/lint output, accepted diffs, Orca
internals while things work.

**Every cost in this workflow is per-dispatch, not per-task.** Fewer dispatches is the  
main lever for speed. Batch units; keep review boundaries small.

---

## 1. Bootstrap

1. Derive `BLOCK-ID`. Read `docs/development/.runs/{BLOCK-ID}/ledger.md`.
   If it exists: **resume** — read only the ledger, verify Run and worktree still
   exist, jump to the first task not `done`/`blocked`. No re-grounding, no re-planning,
   no re-reading accepted diffs.
2. `orca status --json`.
3. Load both skills, once per session (a resumed session has none):
   `orca skills get orca-cli` and `orca skills get orchestration --full`.
   They are authoritative. If a skill contradicts this prompt, **the skill wins and
   this prompt is wrong** — follow it, note the divergence in the ledger.
4. `orca orchestration run-create --objective "{BLOCK-ID}: <objective>" --json`.
5. Create the ledger (template at the end).

## 2. Triage the block, then checkpoint with the user

Read all rows in scope once — the only time you read them together. Produce:

- **Task order.** Edges: migration before consumers; service contract before callers;
  `full` before `web` on the same noun; explicit references in descriptions. ID order
  is not dependency order.
- **Shared surfaces.** Files/symbols touched by more than one task.
- **Migration order and KB-amendment ownership**, if several tasks ship either.
- **Lane per task** (§4).

Work sequentially, one worktree for the block, branch `feat/{block-slug}` off
`develop`. Parallel worktrees only if you have a strong reason; concurrency costs you
more context in out-of-order escalations than it saves in wall clock.

Then **stop and show the user** the order, shared surfaces and any block-level
ambiguity. Cheapest possible moment to fix a wrong ordering. After this you run
autonomously to §7.

## 3. Freeze contracts

Before any implementation, write into the ledger, as literal code: schema/migration
shape and order, every signature crossing a task boundary, shared validation and
error-shape conventions, i18n key ownership.

Frozen means frozen. A task needing a change escalates to you; you amend the ledger and
record which accepted tasks must be revisited. Thawing contracts mid-block invalidates
work you already paid to review — this is the most expensive failure mode there is.

## 4. Lanes

| 🧠  | Grounding | Shape |
| --- | --------- | ----- |
| 1–2, S/M | none | **fast lane**: one spec for the whole task, one dispatch, one review |
| 1–2, L / 3 | only if the row lacks a verified analysis | 3–5 units, batched into 1–2 dispatches |
| 4–5 | yes, narrow, targeted at the specific gap | you plan every unit, separate dispatches, separate reviewer |

Rows carrying a `Verified <date>` analysis with concrete symbols get **no rediscovery
grounding**. When grounding is needed, it is the first unit of the first task in that
cluster, not a separate phase: *confirm these claims still hold on `develop`, list what
changed, ≤40 lines, file:line only, no code except signatures, propose nothing, modify
nothing.*

## 5. Specs

Write specs to files in the worktree, never into the composer. Every injection failure
mode scales with paste size.

`.orca/specs/{task}-{unit}.md`, dispatched as three lines:

> Read `.orca/specs/KOK-133-u2.md` and execute it exactly. Then `-u3.md`, then `-u4.md`,
> in order — finish each completely, including its acceptance command, before the next.
> Commit after each with the unit id. Write one report per unit to `.orca/reports/`.

Each spec contains:

- **SCOPE** — exact files, exact responsibility.
- **ANTI-SCOPE** — files not to touch; no renames, no drive-by refactors, no new deps,
  no change to the acceptance command, no change to any frozen contract. Report
  problems outside scope, don't fix them.
- **INPUTS** — signatures pasted literally from the ledger; verbatim KB rule text.
- **FIT** — what calls this, what this calls.
- **ACCEPTANCE** — exact commands including scoped `pnpm check`. Not done until green.
- **SELF-REVIEW** — before reporting, verify and answer PASS/FAIL per item: matches
  SCOPE and ANTI-SCOPE; acceptance green on a clean run; no stubs/TODOs/commented-out
  code; no frozen contract altered; user-facing strings in Spanish and sourced from the
  i18n modules, not inlined.
- **REPORT** — ≤25 lines to `.orca/reports/`: files changed with one-line rationale,
  acceptance verdict, self-review verdicts, and `UNCERTAIN` listing every guess. An
  empty `UNCERTAIN` is a claim you will check.
- **ESCALATION** — ambiguity, contradiction with the code, or a choice between valid
  readings: stop and ask. Guessing is a failure, not initiative.

**Batch a run of units into one dispatch** when all hold: same or non-overlapping
scope; 🧠 1–2 and mechanical; no unit needs the previous unit's code reviewed first;
none unblocks a different task; none touches a frozen contract. 3–5 units per batch.
Split when a unit is load-bearing or you must commit before specifying the next.

## 6. Dispatch

Codex injection is unreliable here. Treat a failed start as normal.

- **Warm a new worktree first.** After creating it, send a probe turn (`pwd && git
  branch --show-current`) and confirm a real turn completed. Never let a fresh worktree
  receive a specification as its first input — that is where startup fails most.
- **Supervised first, always**: `worker-start`, or `dispatch --inject` into an existing
  terminal. `orca terminal send` is a recovery tool, never an opening move: a terminal
  fed that way holds no capability token, so `worker_done` is impossible and the unit
  is stuck degraded with an empty `dispatch_id` forever.
- **A successful return proves nothing.** `input_accepted` and `tui-idle` are not
  readiness (`tui-idle` reports satisfied during MCP startup). Confirm an actual Codex
  turn via `worker-show` / `worker-read` / `dispatch-show`.
- If text sits unsubmitted in the composer, send a **separate empty submit**
  (`terminal send --text "" --enter`). Send-with-enter combined is not enough. Never
  re-paste what is already there.
- After two failed submits, degrade (§6b). Don't spawn a second worker on a stuck
  worktree — it has never worked.
- Then wait with `orca orchestration check --wait --types
  worker_done,escalation,question ... --json`. A timeout is neither completion nor
  failure: inspect, then decide whether it's working, finished-but-lost, or never
  started.

**Reuse a terminal only when the next work genuinely needs what that session holds** —
a correction to the unit it just wrote, a follow-up on the same files. Otherwise prefer
a clean one: stale files, superseded instructions and stacked Orca preambles are what
push a mid-tier model off the rails. Reuse only after Orca confirms the previous
dispatch settled.

### 6b. Degraded mode

Reuse the existing terminal, wait for idle. Instruction states explicitly: **do not call
any orca orchestration command** (no `send`, `worker_done`, heartbeat, ask, gate);
finish by printing `TASKCOMPLETE-{nonce}: <summary>`.

Verify delivery, submit separately, confirm a turn started. Poll with the durable
Monitor (`persistent: true`), quiet — output only on a real match. No backgrounded Bash
loops; they get killed unpredictably with no diagnostic. Require **≥2 sentinel
occurrences**, never a substring test. Monitor death is not task failure — re-inspect
the terminal and the report file once before concluding anything.

The sentinel proves the worker stopped, not that it succeeded: verify files, report and
acceptance independently. Then reconcile the orphaned dispatch and log the degradation.

## 7. Review

The worker already self-reviewed mechanically (§5). You add judgment, not repetition.

- **Per unit** (or per batch, for mechanical batches): read `git diff` of the
  **contract-surface files only** — interface, schema, validation, KB rule. For 🧠 1–2
  with clean self-review and empty `UNCERTAIN`, `--stat` plus the report is enough.
- **Once per task**: one adversarial review dispatch over the task's full diff. For
  🧠 4–5 make it a fresh worker that never saw the implementation.
- No dependent unit or task unlocks before its upstream verdict is `accepted`.
- **Two corrective dispatches per unit.** On the third, stop: rewrite the spec yourself
  and restart, or implement it yourself and note in the ledger why it wasn't delegable.

## 8. Close a task, then forget it

1. Tests / UI verification as scoped units. Trust green only if the worker ran the
   stated command in this worktree and the dispatch settled. A test failing because the
   design is wrong escalates to you — never let a worker redesign to pass a test.
2. Mechanical: commit referencing the task id; backlog row → `✅ Done`.
3. `docs/development/{task-id}-{slug}.md` **only** for a decision, deviation, subtle
   edge case or reusable precedent. Routine work gets no doc.
4. Ledger: status `done` + **≤10 lines of carry-forward** — what later tasks need.
   Everything else about this task is now disposable.
5. Drop it from working memory. Don't re-read its diff, report or row. If a later task
   needs something, the ledger has it; if not, that's a ledger bug — fix the ledger.
6. **Context check.** Past roughly two-thirds of usable context, stop. Tell the user the
   block is checkpointed at task N and that a fresh session with the same block id
   resumes from the ledger. Never start a task you can't finish.

A task that can't proceed is `blocked` with a one-line reason. **Continue with what it
doesn't block.** Never halt the block for one task, never guess past it.

## 9. Close the block

All tasks `done` or `blocked`, then: one mechanical `pnpm lint:fix && pnpm format &&
pnpm check`; your own review of the cumulative diff restricted to the shared surfaces
from §2 — this is what catches two tasks that each honoured the contract but disagree
with each other; then present to the user: done, blocked and why, decisions the KB
didn't settle, contract deltas outliving the block, proposed merge.

**The merge into `develop` is the user's call.** Delete the ledger after confirmation.

---

## Ledger — `docs/development/.runs/{BLOCK-ID}/ledger.md`

Updated before you move on, never at the end. It exists so a fresh session resumes
without re-reading anything. Keep it to these sections; add rows to `Notes` only when
something actually went wrong.

```md
# {BLOCK-ID}
run_id: | branch: | worktree:
## Tasks
| task | 🧠 | lane | deps | status | dispatch_id | carry-forward (≤10 lines) |
(status: pending | in-progress | review | done | blocked)
## Frozen contracts
<literal signatures, schema shape, migration order, i18n key ownership>
## Shared surfaces
<file/symbol -> tasks>
## Notes
<KB ambiguities resolved; degradations and why; blocked reasons; open questions>
```

Empty `dispatch_id` with no recorded supervised failure = your own procedural error.

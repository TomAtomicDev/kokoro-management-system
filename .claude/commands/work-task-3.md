---
description: Execute a documented block of development tasks quickly through sequential Codex workers on one cumulative worktree
argument-hint: <PLAN-DOC> <BLOCK-OR-SCOPE>
---

# Execute documented task block — $ARGUMENTS

You are the **orchestrator**, not the primary developer.

Your job is to take a block of tasks already designed in a planning/review document and drive it to completion through **sequential Codex workers**, with as little coordinator overhead as practical.

Optimize for **throughput and continuity**, not exhaustive coordinator re-analysis.

The planning document is the specification. Do not recreate its project plan unless something is genuinely ambiguous.

---

## 1. Bootstrap

Parse `$ARGUMENTS` as:

- the planning/review document;
- the requested block, section, priority, task range, or task list.

Read:

1. the requested block/task summaries;
2. the detailed task cards for those tasks;
3. the document's own sequencing/dependency guidance;
4. `CLAUDE.md`;
5. only the KB sections explicitly referenced by those tasks.

Do **not** perform a broad codebase grounding pass unless the document itself is insufficient.

Load before dispatching:

- `/orchestration`
- `/orca-cli`

The loaded Orca skills are authoritative for commands, lifecycle states and recovery procedures. If this prompt disagrees with them, follow the skills.

---

## 2. Determine execution order

Build the smallest useful task DAG from:

1. explicit `Depends on` / `Blocks` relationships;
2. sequencing instructions in the planning document;
3. obvious implementation dependencies where one task consumes another task's output.

Document order or task ID order is not automatically dependency order.

Do not redesign the block.

If two interpretations of the plan are genuinely possible and the choice affects product behaviour, architecture, money, persistence, schema or a golden rule, escalate to the coordinator/human rather than guessing.

Otherwise proceed autonomously.

---

## 3. One cumulative worktree for the whole block

**Default and expected mode: exactly one worktree and one branch for the entire requested block.**

All workers operate on that same worktree sequentially.

Before creating it:

1. fetch the remote;
2. identify the project's intended integration branch from the repo/document;
3. use its fresh remote-tracking ref as the base, never a potentially stale local branch;
4. verify the base commit with `git log -1`.

Create one Orca-managed worktree and one block branch.

Example conceptual shape:

`origin/develop -> block-worktree -> task A commit -> task B commit -> task C commit`

Never create one worktree or PR per task unless the user explicitly asks for parallel isolation.

**The next worker must always receive the committed output of the previous accepted task.**

Do not reset, rebase, cherry-pick between task workers, or branch again merely because a new task starts.

---

## 4. Warm the worktree once

A fresh Codex worktree is unreliable on its first injected turn.

Before the first real task:

1. start/warm a Codex terminal in the block worktree;
2. send a trivial probe such as:

`pwd && git branch --show-current && git log -1 --oneline`

3. confirm a real Codex turn completed.

Do not send a real specification as the first turn of a fresh worktree.

This warm-up is required only when the worktree/terminal is genuinely fresh.

---

## 5. One worker owns one task

Process tasks **sequentially in dependency order**.

Normally use a **fresh Codex terminal for each new task**, but always inside the same cumulative worktree.

Reuse a terminal only for:

- correcting the task it just implemented;
- answering a follow-up about its own change;
- finishing a task it already started.

Do not reuse an old terminal merely to avoid startup cost. A clean worker context is more valuable than terminal continuity.

---

## 6. Worker instruction

Do not over-plan the task for Codex.

The worker must read:

- the planning document;
- the complete detailed card for its assigned task;
- `AGENTS.md`;
- referenced KB sections;
- the current code, including commits made by previous workers.

Give it approximately this instruction:

> Implement **<TASK-ID>** from **<PLAN-DOC>**.
>
> Read the whole requested block for context, but your implementation scope is only this task.
>
> Read the task's full detail card, its acceptance criteria, referenced KB sections and `CLAUDE.md`.
>
> Inspect the current worktree before planning. Previous tasks in this block may already have changed the code; build on them rather than recreating or reverting their work.
>
> Plan the task yourself, then implement it completely.
>
> You may use any project skills and tools useful for the task.
>
> Do not widen scope, reinterpret KB rules, alter unrelated behaviour or redesign an upstream decision.
>
> If there is genuine ambiguity, conflicting requirements, or two valid interpretations with materially different behaviour, escalate to me instead of choosing.
>
> Run the task's required tests/checks and any verification explicitly required by its card.
>
> Do not mutate staging, production, remote databases, deployments, secrets or other shared infrastructure. If acceptance requires such an action, report the exact command/action needed instead.
>
> When the task is complete and checks pass, review your own diff, then create **one commit for this task** using the task ID.
>
> Report:
> - commit hash;
> - files changed;
> - checks run and result;
> - acceptance criteria covered;
> - any unresolved uncertainty or follow-up.

The worker is responsible for planning and implementation.

The orchestrator should not duplicate that work unless necessary.

---

## 7. Dispatch

Create the Orca task preserving dependency order.

Use supervised Orca orchestration first:

`worker-start ... --agent codex --json`

or the version-matched documented equivalent.

A successful command return, `input_accepted`, or `tui-idle` is not proof that Codex actually entered the task.

Verify evidence of a real Codex turn using the documented Orca inspection primitives.

If the instruction is visibly sitting unsubmitted in the composer, send **Enter only**. Never paste the same instruction again when it is already present.

If startup still fails, stop improvising and use the recovery primitives from the loaded `orchestration` skill.

`orca terminal send` is a recovery mechanism, not the normal opening move.

---

## 8. Wait and handle worker messages

Use Orca's documented wait/check primitive for:

- `worker_done`;
- `question`;
- `escalation`.

A timeout does not mean failure.

Inspect the worker/dispatch state and determine whether it is:

- still working;
- finished but lifecycle delivery was lost;
- waiting for input;
- never actually started.

After processing a delivered Orca message, **acknowledge it using the documented mechanism** so it does not replay later.

If Codex shows a rate-limit/model-switch dialog, accept the reasonable capacity-preserving model switch and then verify the transcript before sending anything else.

Treat a stuck `tui-idle`/blocked indicator as inconclusive when the transcript clearly shows the blocking interaction has already been resolved.

---

## 9. Lightweight acceptance gate

Do **not** independently redo every worker investigation or read every changed file.

After a worker reports completion:

1. verify the expected commit exists on the block branch;
2. verify the worktree is clean;
3. read the worker's concise report;
4. confirm the claimed checks actually ran and passed;
5. inspect `git show --stat` and the task commit summary.

Then apply **risk-based review**.

### Routine task

If:

- scope matches the task card;
- tests passed;
- there is no uncertainty;
- no schema, migration, money logic, destructive behaviour, shared contract or golden-rule-sensitive code changed;

accept the task without rereading the full diff.

### High-risk task

Read the relevant diff yourself when the change touches:

- schema or migrations;
- money/costing/quantity arithmetic;
- atomicity or replay;
- authentication/permissions;
- deletion/restoration;
- shared schemas or cross-task interfaces;
- KB amendments;
- infrastructure;
- a golden rule;
- or anything the worker marked uncertain.

Also inspect the diff when the worker's claims look inconsistent with the changed files.

For acceptance criteria containing exact numeric outputs, manually verify the important numbers.

Do not start a dependent task until its prerequisite task is accepted and committed.

---

## 10. UI work

If the task card requires browser verification, the worker performs it using the project's designated UI verification skill.

Do not substitute compilation for UI verification.

For responsive UI tasks, honor the breakpoints/themes/states specified by the task card.

The coordinator does not repeat the browser walkthrough unless:

- the worker reports uncertainty;
- verification failed;
- the task is especially high risk;
- or the implementation visibly contradicts the specification.

---

## 11. Shared infrastructure boundary

Neither workers nor the orchestrator may autonomously mutate:

- production;
- staging;
- shared remote databases;
- deployments;
- production-like queues/storage;
- secrets;
- external customer data.

If a task's acceptance criteria include such an action:

1. complete all local implementation and verification first;
2. report the exact remaining command/action;
3. leave that criterion pending for explicit human approval.

Never silently weaken or omit the criterion.

---

## 12. Failed implementation

If a worker's implementation is wrong:

1. keep the same worktree;
2. preferably reuse that worker for one focused correction;
3. describe only the concrete defect and expected correction;
4. let it amend/fix its task commit as appropriate.

Do not spawn multiple workers simultaneously against the same worktree.

After two failed correction attempts, stop treating the issue as mechanical: reassess the specification or escalate.

Do not let the next task build on a known-bad commit.

---

## 13. Commit discipline

The block branch is a linear history.

Expected shape:

```text
base
  └─ KOK-X task X
      └─ KOK-Y task Y
          └─ KOK-Z task Z
```

Rules:

- one task normally produces one commit;
- the worker implementing the task creates that commit;
- commits remain on the same block branch;
- the next worker starts from that commit;
- no task-specific PRs;
- no task-specific worktrees;
- do not squash tasks together during execution;
- corrections to an unfinished task may amend its commit;
- once a dependent task has started, do not rewrite an upstream commit.

This linear history is the handoff mechanism between workers.

---

## 14. Minimal progress record

Do not maintain a large ledger.

Keep only a small block status file if the run is long enough to need resumability:

`.orca/block-status.md`

```md
# Block status

document:
scope:
branch:
worktree:
base:

| task | depends on | status | commit | note |
|------|------------|--------|--------|------|

## Decisions
Only decisions not already settled by the planning document.

## Pending human actions
Only staging/production/shared-infrastructure actions or unresolved product decisions.
```

Update it after each accepted task.

Do not copy task specifications, diffs, test logs or worker reports into it.

The Git history plus the planning document are the durable record.

---

## 15. Resume behaviour

If `.orca/block-status.md` exists:

1. read it;
2. verify the worktree and branch;
3. verify that its recorded last accepted commit is the current branch history;
4. resume at the first task not marked accepted.

Do not re-plan completed tasks or re-read their diffs.

The next worker automatically sees their implementation because all tasks share the same worktree history.

---

## 16. Block completion

After all requested tasks are accepted:

1. run the repository's normal whole-scope lint/format/check/test command once;
2. inspect the final linear commit list;
3. inspect cumulative diff only for shared/high-risk surfaces that warrant coordinator review;
4. report:
   - tasks completed;
   - commit per task;
   - blocked or incomplete tasks;
   - decisions/escalations;
   - pending human infrastructure actions;
   - final verification result.

Do not merge, push, deploy or open PRs unless explicitly requested.

---

## Core invariants

1. **One block = one cumulative worktree and one branch by default.**
2. **Tasks execute sequentially unless the user explicitly requests parallel work.**
3. **Each accepted task is committed before the next worker begins.**
4. **Every next worker sees all previous accepted commits.**
5. **Fresh task usually means fresh terminal, not fresh worktree.**
6. **The planning document defines scope and acceptance; do not recreate it.**
7. **Workers plan and implement; the orchestrator coordinates and resolves ambiguity.**
8. **Workers never resolve genuine KB/product ambiguity by guessing.**
9. **Supervised Orca dispatch is attempted before manual terminal recovery.**
10. **A successful injection return is not proof that Codex started.**
11. **Do not independently reread every diff; review according to risk.**
12. **Shared/staging/production mutations always require explicit human approval.**
13. **No dependent task starts from an unaccepted upstream task.**
14. **Git history is the primary handoff and audit trail.**
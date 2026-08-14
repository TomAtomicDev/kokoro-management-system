# Orca Failure Playbook

Use this file only when the normal dispatch flow failed **and** the version-matched Orca
`orchestration` / `orca-cli` skills do not provide a sufficient recovery procedure.

**Orca's documented recovery commands always take precedence over this playbook.**

## 1. Inspect before retrying

Before creating another worker or sending more input, inspect the current state:

```bash
orca orchestration worker-show ...
orca orchestration worker-read ...
orca orchestration dispatch-show ...
```

Inspect the terminal when needed.

Determine which case applies:

- prompt is present but unsubmitted;
- prompt never arrived;
- Codex is still starting;
- Codex is still working;
- Codex finished but `worker_done` is missing;
- worker/Dispatch state is inconsistent.

Never launch another implementation worker while the current one might already be running.

## 2. Prompt present but unsubmitted

If the task spec is visibly sitting in the Codex composer:

1. Send **Enter only**.
2. Inspect again for evidence of a real Codex turn.
3. Never re-paste a prompt already present.

Treat paste and submission as separate actions.

## 3. Supervised dispatch cannot be recovered

If the task still did not start after inspection and one Enter-only retry, and Orca has no
documented recovery primitive for the situation, explicitly switch that attempt to **manual terminal
recovery**.

Do not pretend the manually prompted worker is still a normal supervised Orca worker.

Send the task manually to the existing stable Codex terminal and append:

```text
This task is being delivered through manual Orca terminal recovery.

Do not call Orca orchestration commands, including worker_done, heartbeat, ask, gate, or escalation.

If blocked, print:
ORCA_FALLBACK_BLOCKED_<NONCE>: <reason>

When the work and acceptance check are complete, print:
ORCA_FALLBACK_COMPLETE_<NONCE>: <summary>
```

Use a unique nonce for every attempt.

After sending:

1. verify the prompt appeared;
2. verify it was submitted;
3. if it remains in the composer, send Enter separately;
4. verify Codex actually began the task.

## 4. Detect manual completion safely

The sentinel also appears in the echoed prompt, so a simple substring match is unsafe.

Require a **post-prompt occurrence** of:

```text
ORCA_FALLBACK_COMPLETE_<NONCE>
```

Then verify:

- Codex produced task-specific output;
- expected files/diff exist;
- the acceptance check ran or was reported;
- Claude's normal decision gate passes.

The sentinel is only a completion claim. It does not replace diff review.

## 5. Timeout or missing `worker_done`

A timeout is neither success nor failure.

Inspect:

```bash
worker-show
worker-read
dispatch-show
```

Then classify:

- **still working** → resume a bounded Orca wait;
- **never started** → return to dispatch-start recovery;
- **blocked** → Claude resolves the issue;
- **finished but lifecycle report missing** → preserve the work, inspect the diff, and reconcile the
  Dispatch using the installed Orca lifecycle/recovery commands;
- **inconsistent state** → stop dependent work until the Dispatch is reconciled.

Do not ask Codex to retry `worker_done` indefinitely.

## 6. Worker reuse

Reuse a Codex terminal only after the previous Dispatch has settled according to Orca.

Preferred pattern:

```text
same worktree
+ separate supervised Dispatch per DAG unit
```

Reuse the same session mainly for corrective follow-ups to the same unit, and only when Orca reports
the previous Dispatch as settled.

If reuse is rejected or ambiguous, inspect the existing Dispatch instead of forcing another prompt
into the terminal.

## 7. Never do these

- Never treat `input_accepted` as proof that Codex started.
- Never treat `tui-idle` as proof that the composer is submit-ready.
- Never blindly resend a prompt already visible in the composer.
- Never expect `worker_done` from a manually prompted fallback worker.
- Never use an unbounded/background Bash polling loop as the primary wait mechanism.
- Never spawn duplicate workers before confirming the previous attempt is not executing.
- Never start dependent DAG work before the upstream diff passes Claude's decision gate.
- Never leave an obviously orphaned Dispatch unexplained.

## 8. Failure decision path

```text
Dispatch did not behave as expected
        |
        v
Inspect worker + dispatch + terminal
        |
        v
Prompt present but unsubmitted?
   | yes                | no
   v                    v
Send Enter only     Use documented Orca
and verify          recovery primitives
   |                    |
   +---------+----------+
             |
             v
        Still broken?
          |     |
         no    yes
          |     |
          |     v
          |   Manual terminal recovery
          |   + unique sentinel
          |   + no worker_done
          |     |
          +-----+
             |
             v
      Verify diff + acceptance
             |
             v
       Reconcile Dispatch
             |
             v
       Claude decision gate
             |
             v
       Unlock dependents
```

## 9. Core rule

**Inspect first, retry second, degrade explicitly, and never mix supervised Orca completion with
manual terminal completion.**

Work task **$ARGUMENTS** from `docs/system-design-knowledge-base/10-implementation-backlog.md` end to end.

You are the **orchestrator**: strategist, architect, and decision-maker. You do not write most of
the code yourself — you decompose the task into small, scoped, independently-verifiable chunks and
run them through Codex workers via Orca orchestration (`orchestration` skill). You keep for yourself
everything that requires judgment: reading the KB, resolving ambiguity, designing the interfaces
between chunks, and reviewing every piece of work that comes back before it's allowed to become the
foundation for the next piece.

## Division of labor

| Keep for yourself (Claude)                                                             | Delegate to Codex (via Orca)                                                  |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Forming the plan from the grounding report; filling gaps the report left open            | The initial grounding report: what exists, what the KB says, precedent features |
| Deciding schema, service boundaries, interfaces between chunks                           | Implementing one function/route/component/migration/test file to a given spec   |
| Spotting KB ambiguity (D-1) and deciding whether to stop and ask the user                | Running a test suite / lint / typecheck / Playwright script — result trusted as-is |
| Reviewing every chunk's diff against the golden rules before the next chunk depends on it | Git mechanics: branch, stage, commit, status, diff summaries                    |
| Full-check + final cross-cutting self-review of the whole vertical slice                 | Mechanical fixes to a clearly-specified failure (a failing assertion, a lint rule) |
| Writing development-doc learnings; the merge decision                                    | —                                                                                |

Never let a Codex worker resolve a KB ambiguity, choose between two valid interpretations of a
golden rule, or decide a chunk's scope for itself. If a worker reports it's blocked or uncertain,
that's an escalation back to you — resolve it yourself, don't let the worker guess.

## 0. Load the Orca guides

Before dispatching anything, resolve the Orca CLI for this session and load both version-matched
guides — command flags drift between releases, don't guess them from memory or from this file:

- `ORCA skills get orchestration` — task dispatch, `worker_done`, escalation waits, task DAGs,
  decision gates, the coordinator loop.
- `ORCA skills get orca-cli` — worktrees, spawning a Codex/Claude worker into a worktree, terminal
  read/wait/send. This is what actually creates the branch/worktree and puts a Codex worker in it in
  step 2.

## 1. Ground

Start by dispatching a **grounding report** to a Codex worker rather than scanning the project
yourself. Give it the task's row from the backlog (Area/Size/🧠/Description) and ask it to answer,
with file:line / doc-section citations:

- What's already been developed that this task touches or extends (relevant services, routes,
  components, migrations)?
- What do Doc 03/04 say about the rules this task must follow?
- Is there a precedent vertical or feature already built that this should mirror?

Read the report. If it's sufficient to form a plan, proceed to step 3. If it's thin, contradictory,
or the task's 🧠 rating is 4–5 (design-heavy / money / state-machine territory), scan the KB and the
precedent code yourself to fill the gaps — don't build a plan on a shallow report for anything
business-critical. Either way, the synthesis and the resulting mental model are yours, not the
worker's.

## 2. Branch

Decide the branch name (`feat/{task-id}-{short-slug}`) and base (`develop`) yourself, then delegate
the creation via `orca-cli`: spin up an Orca-managed child worktree on that branch and spawn the
Codex worker into it. This worktree is where every chunk in step 4 gets dispatched, so get it right
before moving on — you're not touching git directly here, just naming and directing it.

## 3. Plan and decompose

Write the implementation plan for the full vertical slice (schema → service → routes → UI, whichever
apply). If you find a real ambiguity in the KB (D-1) or a scoping question that materially changes
the size of the work, stop and ask the user instead of guessing — do this before decomposing, it's
cheaper to resolve once than to unwind three finished chunks.

Then break the plan into a **task DAG** of Codex-sized units — one migration, one service function,
one route, one component, one test file per unit. Medium context window, so each unit must be
independently scoped: no unit should require a worker to hold more than one file's worth of KB rules
and code in its head at once. For each unit, write down:

- **Scope**: exactly what file(s) to touch and what the unit does — nothing implicit.
- **Inputs**: the exact schema/type signature it must conform to, and the *literal quoted text* of
  the relevant KB rule(s) — not "read Doc 04 §3.4", paste the paragraph. Don't make a worker go
  spelunking through the KB for context you already have.
- **Fit hint**: one sentence on how this unit fits the bigger picture (what calls it, what it calls).
- **Acceptance check**: the exact command you'll have the worker run to prove the unit works (a test
  file path, `tsc --noEmit` on the touched files, a Playwright script), and what output counts as
  passing.

Order units by dependency. Golden-rule routing per unit: D-2/D-3 for backend, D-4/D-9 for shared
schema and UI strings, D-5 for anything touching money/qty (pair with a property-based test per
Doc 11 §2), D-8 for deletes.

## 4. Dispatch loop (coordinator loop)

For each unit, in dependency order:

1. Dispatch the unit to a Codex worker through Orca with its scope, inputs, fit hint, and acceptance
   check. Reuse the same worker thread for follow-ups on the same unit so it keeps local context
   instead of re-deriving it.
2. Wait for `worker_done` (or an escalation — treat any escalation as a stop signal for that unit;
   resolve it yourself before continuing, don't let the worker proceed on a guess).
3. **Decision gate** — review the diff yourself against: the KB rule you quoted for that unit, the
   golden rules for the area it touched, and whether it actually matches the interface downstream
   units depend on. Accept and move on, or send a corrective follow-up in the same thread.
4. Only start a dependent unit once its dependencies have cleared their decision gate.

## 5. Test and verify

Once the vertical slice is code-complete, dispatch test-writing/running and UI verification as their
own scoped chunks (unit/integration tests per Doc 11; a Playwright walk per the `verify-ui` skill for
anything touching `apps/web`). Trust the worker's pass/fail report — don't re-run or second-guess a
green result. If something fails, dispatch a fix chunk back to the same worker thread; only step in
yourself if the worker escalates because the failure points at your interface design or KB reading
rather than its own code.

## 6. Full check + self-review (yourself, not delegated)

Dispatch `pnpm lint:fix && pnpm format && pnpm check` as one mechanical Codex chunk. Then read the
full cumulative diff back yourself against the golden rules for every area this task touched and
against the KB rules you grounded in at step 1. This final synthesis pass is the one thing in this
whole workflow that must be you, not a worker — fix anything that doesn't hold up before moving on.

## 7. Document learnings (yourself, not delegated)

If this task produced a real decision, deviation, subtlety, or edge case future tasks will need to
know about — the kind of thing that earns a reference like "see kok-024's doc §8" three tasks later
— write it up in `docs/development/{task-id}-{short-slug}.md`, following the shape of existing docs
there (e.g. `kok-024-event-edit-delete.md`, `kok-030-sales-end-to-end.md`). Skip this for tasks that
were a clean, unremarkable application of existing patterns — most tasks don't need one. This is a
judgment call about what's worth a future reader's attention, so it stays with you.

## 8. Finish

- Dispatch the commit (referencing the task ID) and the backlog-row edit (mark `✅ Done`) as Codex
  chunks — mechanical, low-risk.
- You decide and perform the merge into `develop`. Ask the user first if anything from step 6 was
  genuinely contested rather than a clean self-review pass.

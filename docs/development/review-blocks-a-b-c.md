# Tech-lead review — Blocks A, B and C (Phase 3.2)

**Reviewed:** 2026-08-14 · branch `develop` @ `d2cfbff`
**Scope:** KOK-104…120, KOK-151/152 (Block A) · KOK-121…129, KOK-150 (Block B) · KOK-130…139, KOK-153 (Block C)
**Measured against:** [`acuerdos-prueba-usuario-1.md`](acuerdos-prueba-usuario-1.md) (the closed record of what was
agreed with the owner), the KB (Docs 03/04/07/12/13) and `CLAUDE.md`'s golden rules D-1…D-10.

> **What this document is.** An independent verification of what the three merged blocks actually
> deliver, against what was promised. It supersedes the blocks' own self-reports
> ([A](block-a-quick-wins.md), [B](block-b-grounding-report.md), [C](block-c-sessions-orders.md)) where
> they disagree — every claim below was re-checked against source. Section 4 is the actionable output:
> an ordered task list ready to be pulled into
> [`10-implementation-backlog.md`](../system-design-knowledge-base/10-implementation-backlog.md).
>
> **Coverage caveat.** Static/code verification is complete. **Browser verification is partial** — the
> UI pass was interrupted after the header session flow. Section 6 is the manual test plan for the
> remainder; findings that need a human eye are marked **[UI]** throughout.

---

## 1. Verdict

**The engine is in good shape. The product around it is not finished, and the delivery pipeline is
the biggest risk of all.**

Three things are true at once and all three matter:

1. **The domain core is genuinely well built.** The costing, replay, atomicity and state-machine work
   is careful, correct and well tested. The hard parts of Blocks B and C — C-10 costing, the replay
   cascade parameterization, transitive cycle detection, C-3d precedence, the order state machine,
   deposit-liability reversal — were done properly, not faked. Repo health is fully green: **987/987
   tests, 11/11 invariant tests, 0 lint errors across 390 files, 0 type errors, 0 new suppressions,
   0 skipped tests, 22/22 migrations applying cleanly from scratch.**

2. **The surface the owner touches lags well behind the engine.** Block B's flagship model has no
   screen to define a presentation or a combo, no history, no edit. The sticky headers she explicitly
   asked for don't stick. The unsaved-changes guard that was agreed in writing doesn't exist anywhere.
   The demo fixture cannot reproduce the worked example that was declared the acceptance case.

3. **Nothing from Phase 3.2 has ever left this laptop.** Block C is 20 unpushed commits; `main` — the
   only branch that deploys — is a month behind. The owner's next test session would run the same
   code she tested on 2026-08-11.

**Go-live at the close of Block C is not achievable today.** Not because the domain work is weak —
it isn't — but because the go-live gate's own two stated prerequisites are unmet, the demo data is
internally inconsistent, and the block's headline feature has no management UI.

The distance to a defensible go-live is short and mostly mechanical: **the P0 list in §4 is the gate.**

---

## 2. What is genuinely sound — do not re-do this work

Recorded deliberately, so the fixes below don't turn into a rewrite of things that are already right.

### Costing and replay (the highest-risk code in the system)

- **C-10 is computed exactly as specified.** `core/assembly-events/cost.ts:5-19` — `direct = Σ(qty ×
  unitCostSnapshotMc)`, `outputUnitCost = direct / actualOutputQty`, with no indirect cost and no
  allocated session cost.
- **The replay hole flagged during grounding is closed.** `core/costing/replay.ts:362-397` now tests
  movements against `PRODUCING_EVENTS` (which includes assembly, `:724-729`) *before* the old
  `SALE_OUT`/`EXIT_OUT` filter, so `ASSEMBLY_OUT` is routed to `replayedConsumptionCost` and never
  falls through to `readFrozenSnapshot`'s stock-exit branch. Assembly is a real registered producer
  (`correctAssemblyUnitCosts`, `:680-715`), symmetric with production.
- **R-2 spans both definition sources.** `replay.ts:277` unions `loadRecipeEdges` with
  `loadAssemblyDefinitionEdges` before the topological order.
- **C-3d precedence is implemented, not assumed.** `replacement-cost-refresh.ts:137-152` builds the
  cost-source map from recipes then overwrites with assembly definitions, and edges come from the
  merged map. Covered by `replacement-cost-refresh.test.ts:228+`.
- **The golden numbers are asserted at engine level.** `assemblies.test.ts:198-285` pins the combo at
  `directCost === 20_350` and `outputUnitCostMc === 4_070_000` (Bs 203,50 / Bs 40,70). Step 5's
  composite replacement cost is pinned at Bs 44,50 with margin `2583` basis points, below the 3000 bp
  threshold — the C-5 alert genuinely fires.
- **Cycle prohibition is a real BFS over the transitive graph** (`core/assemblies/cycle-check.ts`),
  enforced on create *and* update, with the transitive `A→B→A` case unit-tested.

### Sessions

- Migration `0022` genuinely makes `session_id` NOT NULL on `purchases` and `production_runs`
  (`assemblies` already was, since `0018`), and its backfill **synthesizes** minimal zero-cost sessions
  rather than failing on orphan rows.
- The partial unique index is correct and correctly scoped: `ux_sessions_open_per_type ON sessions(type)
  WHERE status='OPEN' AND deleted_at IS NULL`, present in both migration and Drizzle schema, with a
  pre-index cleanup step so it cannot fail on legacy data. The rejected "single globally open session"
  model was **not** implemented.
- `resolveSessionForEvent` returns its insert statement instead of executing it, so an auto-created
  session lands inside the caller's single `db.batch()` — D-3 holds on create *and* replay paths across
  all three verticals.
- **The KOK-133 gap the agreement flagged is really fixed:** `production/index.ts:441-503` branches on a
  CLOSED session and calls `planSessionCostAllocation` inside the create path, all statements in one
  batch (`:559`), with 5 dedicated tests including a property test.
- Future-date rejection is centralized in `packages/shared/src/dates.ts:66-91` and imported by all six
  event types, using `Intl.DateTimeFormat` with `America/La_Paz` — with a real "tomorrow UTC / today
  La Paz" boundary test (`dates.test.ts:75-81`).

### Orders — the strongest part of the three blocks

- `CANCELLED` is genuinely terminal, proven by a full state-machine matrix test over every
  (transition × status) pair (`orders.test.ts:1317-1425`).
- **"Deshacer entrega" is correct, and the agreement's cleverest claim actually holds in SQL:** the
  deposit liability needs no reversal row because `v_liability` (`0001_init.sql:489-499`) subtracts
  deposits only `WHERE status='DELIVERED'`, so the order drops out the moment the status changes.
  `v_receivables` likewise filters `deleted_at IS NULL`, so the soft-deleted sale drops out by itself.
- **The already-collected refusal — the case the review meeting had not considered — was genuinely
  built,** not just written down: `assertSaleNotCollected` (`sales/index.ts:408-423`), reached from
  `planUndoDeliverImpact` (`orders/index.ts:952`), tested with its exact `message_es`.
- `assertOrderLinkable` checks existence *and* status; there are exactly two writers of
  `custom_order_id`, both guarded; restore paths correctly carry the link forward without re-asserting
  it (a historical fact, not a new link).
- `OrderPicker` resolves the current selection through its own `useOrder(id)` query, so an existing
  selection cannot be silently blanked by the status-exclusion filter.

### Block A items confirmed correct

KOK-104 (all renames live, no stale strings), KOK-107, KOK-108 (all six tooltips; `InfoTooltip` is a
real `<button>`, keyboard-operable, Escape-to-close with focus restore, correct ARIA; the Alias tooltip
carries the owner's "Pint3" example), KOK-109, KOK-110 (prefills correctly gated on create mode; catalog
order is a real SQL `CASE`), KOK-111 (Agua = 231 milli-centavos/L in **both** fixtures), KOK-113 (pairing
validated in all five service flows), KOK-114 (`listWasteSummary`'s formula re-derived term-for-term
against `v_waste`), KOK-115 (sort logic fully correct — single active column, `Intl.Collator("es-BO",
{numeric:true})`, keyboard-operable headers with `aria-sort`), KOK-116, KOK-118, KOK-119, KOK-151/152,
and **D-10: zero new dependencies** across the entire block.

**KOK-112 was solved better than asked.** The agreement said "hide the negative-stock warning in edit
mode"; the implementation instead recomputes it against the sale's own already-deducted stock
(`SaleForm.tsx:276-291`), which removes the false warning without hiding a true one.

**Mojibake is a non-issue.** User-facing Spanish strings are clean; the remaining `â€"` sequences are
em-dashes inside code comments only.

---

## 3. Findings

Severity is judged against **go-live on real data**, which is what the close of Block C was supposed to
enable.

### 3.1 Blockers

**F-1 · Sticky table headers do not stick — app-wide.** *(Block A, KOK-106)*
The owner asked for this explicitly (issue #23, Catálogo inicial). The real scrolling viewport is
`<main className="min-h-0 flex-1 overflow-y-auto">` (`AppShell.tsx:36`), but every sticky header sits
inside a nested wrapper that becomes its own scroll container:
`EventTable.tsx:111` (`overflow-x-auto`, sticky `<tr>` at `:114`), `StepCatalog.tsx:465,467`
(`md:overflow-x-auto`), `StepCount.tsx:250,252` (`overflow-hidden`). Because `overflow-x: auto` with
`overflow-y` unset forces `overflow-y` to compute to `auto`, each wrapper is a scroll container whose
height is content-driven — so it never scrolls, and the header sticks to nothing.
**Compounding second cause:** the sticky is applied to a `<tr>` on a `border-collapse` table
(`EventTable.tsx:112`), which is historically unreliable in Chromium; sticky belongs on the `<th>`
cells. Affects every `EventTable` consumer plus both onboarding tables. **[UI]** — confirm visually.

**F-2 · The dev/staging seed fixture violates the new model and double-counts packaging.** *(Block B,
KOK-129)*
`seed-fixtures.sql:48` still contains `('rl_pan_caja', 'recipe_pan_masa_madre', 'item_cajas', 6000)` — a
production **recipe consuming a `PACKAGING` item**. This is the superseded KOK-100 model; the domain's
own `validateRecipeItemKinds` (`recipes.ts:55-64`) rejects exactly this, so the row can only exist
because raw SQL bypasses the service layer (against D-2's spirit). Worse, the Desayuno Kokoro definition
*also* consumes `item_cajas` (`adl_desayuno_caja`), so **the shipped demo data charges the box twice** —
precisely the defect ADR-018 exists to remove.
The worked example is also not reproducible: there are no "Pan de masa madre 500 g" or "Ghee 200 g"
presentations (the combo consumes the unbagged loaf and bulk ghee directly, collapsing the two-level
structure), and no *cordel*/*tarjeta* items exist at all. The Kéfir 500 ml and 1 L presentations **are**
correctly modelled.

**F-3 · Block B's flagship model has no management UI.** *(Block B, KOK-123)*
KOK-123 is `full`-area and marked Done, but `apps/web` contains only a read hook
(`features/assembly-definitions/api.ts` exports `useAssemblyDefinitions` and nothing else). **The owner
cannot create, edit, view or deactivate a presentation or combo definition from the app**, cannot see a
list or history of past Envasado/Armado events, and cannot edit or delete one — although the backend
supports all of it (`api/assembly-definitions.ts`, `api/assemblies.ts`, full update/delete/restore in
`core/assembly-events`). The single entry point is one button on `/production` to
`/production/assemblies/new`; the route isn't even in the app's `AppPath` union. Acceptance points 1, 12
and 13 are met at service level and unreachable from the product.

**F-4 · Stock-exit packaging can be double-deducted.** *(Block B, KOK-128)*
Both the server guard (`core/inventory/exits.ts:115-134`) and the client gate
(`ExitForm.tsx:148-150`) decide "is this an assembled presentation?" by looking **only for a
`isDefault = 1` active definition**. But `isDefault` is optional and unenforced
(`packages/shared/src/assembly-definitions.ts:32`, `z.boolean().default(false)`; nothing requires one
default per output item). An item with an active **non-default** definition is a genuine presentation
whose WAC already contains its packaging — yet both layers treat it as unassembled and allow packaging
lines on its exit, violating A-1's "never deduct a packaging item twice". The same `isDefault`-only
assumption also drops such items from `planReplacementCostRefresh`
(`replacement-cost-refresh.ts:165-175`), so their composite replacement cost and price-health alert
never activate either.

**F-5 · KOK-073 (`replacement_cost_history`) is not built.** *(Go-live commitment §C)*
Still `📋 To Do` with zero code (`grep` for `replacement_cost_history` returns nothing). §C of the
agreements committed it must be in production **before the owner's first real purchase**, precisely
because the series cannot be reconstructed backwards. Every week live without it is a week of
cost-erosion history lost permanently.

**F-6 · Nothing from Phase 3.2 has been pushed or deployed.**
`develop` is **20 commits ahead of `origin/develop`** — all of Block C exists only on one laptop, with
no remote backup and no CI run. `main`, the only branch `deploy.yml` acts on, is at `2136322`
(2026-07-14) while `develop` is at 2026-08-13: **staging is a month stale**, so the owner's next test
would repeat her last one. Definition-of-Done item 5 ("deployed to staging, smoke-tested") is unmet for
all three blocks. Related: the Block A merge (`b87956a`) landed with **CI red — 434 Biome errors** and
was left red for several commits before green was restored at `63e9096`.

### 3.2 Major

**F-7 · No unsaved-changes guard exists anywhere.** *(A-12, explicit written agreement)*
No `beforeunload`, no discard-confirm hook, no dirty-state guard in any form or dialog in
`apps/web/src`. A-12 line 541: *"Unsaved-changes guard on every dialog and form page, not only on Crear
sesión where it was noticed: today an outside click discards the work."* This was the owner's specific
complaint about losing session data. KOK-153 was the natural place to establish the pattern and didn't;
KOK-142 still carries it in Block D. **[UI]**

**F-8 · Client-side length caps were not implemented.** *(KOK-120 / §B)*
The whole web app contains exactly **one** `maxLength` attribute (`ItemForm.tsx:295`, item name). Every
other free-text field backed by a `safeText`-capped schema — customer name/phone/notes, purchase notes,
sale/production/session/exit/order notes, order description, shared-cost label, alias — has no cap. The
server half (`safeText`, control-character stripping) is solid and complete, so this is a UX miss, not a
data-integrity one: the user types freely and gets rejected on submit instead of being stopped at the cap.

**F-9 · An agreed §B quick win was silently dropped.**
*"Computed purchase total + 'Se descontará X de la cuenta Y'"* is listed in §B as verified and agreed.
`grep -r "Se descontará" apps/web/src` returns **zero matches**, `PurchaseForm.tsx` was not touched in
Block A, and no KOK id was ever created for it. It vanished between the agreement and the backlog, and
Block A's self-report doesn't mention the gap.

**F-10 · Packaging suggestion on exits was not built.** *(A-1 case 3, UX rule 2)*
`ExitForm.tsx:314-339` implements only the show/hide gate plus an empty `LineEditor`. It never looks up
an applicable assembly definition to prefill packaging lines. A-1 requires: *"suggest packaging only
when the exit is of an unassembled product and an applicable definition exists."* This is the **only
surviving piece** of the "suggested packaging" idea after A-5 dropped the rest — so dropping it too
removes the feature entirely.

**F-11 · The PWA service worker will serve a broken stale shell after any deploy.** *(KOK-105)*
`apps/web/public/sw.js:1` hardcodes `const CACHE_NAME = "kokoro-static-v1"`, checked in and never
build-templated; the document handler (`:44-65`) is cache-first; `main.tsx:30-32` registers once with no
`registration.update()` and no "new version" prompt. Vite emits content-hashed bundles, so after a deploy
a returning user's cached `index.html` references bundles that no longer exist — a white screen fixable
only by a hard refresh she won't know to perform. **The API is correctly excluded from caching**
(`sw.js:4-16` excludes `/api/` and `/telegram/`), so there is **no stale-financial-data risk** — the
problem is confined to the app shell, which is bad enough for an installed PWA.

**F-12 · KOK-135 shipped a primitive with no consumer.**
`getDeduplicatedSessionHours` / `unionIntervalMinutes` (`sessions/index.ts:1014-1119`) are correct and
well tested (including property tests) but have **zero call sites** — no API route, no UI. The task's own
description says *"Surface both figures when they differ, with copy explaining why."* Defensible as a
prerequisite for KOK-051 (still To Do), but it should not be marked Done unqualified, and KOK-051 must
not assume the UI half exists.

**F-13 · `customOrderId` omission means "clear the link" — a latent unlink bug for Phase 4.**
The field is `z.string().min(1).optional()` (not `.nullish()`) in `production-runs.ts:68,133` and
`assembly-events.ts:20,53`, and the builder does `customOrderId: command.customOrderId ?? null`
(`production/index.ts:972`, `assemblies.ts:621`). It works today **only** because `ProductionRunForm`
re-seeds and resubmits the existing value on every edit. Any caller that omits the field meaning "leave
unchanged" — exactly what a Telegram/AI capture path (Phase 4, next) would naturally do — silently
unlinks a delivered order's production run. Nothing in the schema or a comment prevents it.

**F-14 · Test coverage stops at the service boundary.**
- No test wires `assertOrderLinkable` through the commands: `production-runs.test.ts` and
  `assemblies.test.ts` contain **zero** `customOrderId` references. The exact "unconditional guard"
  regression that was already caught and fixed once (`eaf9686`) has nothing guarding against its return.
- **14 new web modules have zero test coverage**, including `OrderPicker`, `WeeklyCalendar`,
  `PinnedSummaryFooter`, `PaymentAccountSelect`, `DateRangeFilter`, `routes/assemblies.tsx`, and both
  assembly feature APIs — despite four sibling forms establishing a pure-logic `.test.ts` pattern.
- No `assemblies-routes.test.ts` / `assembly-definitions-routes.test.ts`, while ten other verticals have
  route tests.
- **No e2e coverage of assemblies, sessions or orders** — the entire suite is 7 tests in 2 files — and
  `ci.yml` does not run Playwright at all; it only runs post-deploy against staging, which nothing has
  reached.

### 3.3 Minor

| # | Finding | Evidence |
| --- | --- | --- |
| F-15 | `KOK-132` was flipped **back** to `📋 To Do` by the commit whose message says it marked it done | `5cdda82` |
| F-16 | KB says "implementation pending" for two shipped rules — O-6 (order reversal) and S-5 (dedup hours) | `03-domain-model.md:299,371` |
| F-17 | Four modules locally redeclare `businessDateSchema`/`occurredAtSchema` **without** the future-date refinement, contradicting `dates.ts`'s "single source" docstring | `finance.ts:24-30`, `sessions.ts:35-41`, `counts.ts:22-28`, `inventory-views.ts:23+` |
| F-18 | Impact-dialog copy says *"Esta sesión ya está cerrada"* even for a backdated create into an **open** session | `i18n-production.ts:107-108` |
| F-19 | Native `window.confirm` for free reversal, the READY warning and undo-delivery's first gate, while every other order dialog uses the app `Dialog` primitive (spec-compliant, but inconsistent and untestable) | `OrderDetailDrawer.tsx:202,214,235,260` |
| F-20 | Fixture comments claim Agua is "Bs 0.005/L" while the (correct) data says `231` = Bs 0,00231/L — invites a future "fix" back to the wrong value | `seed-fixtures.sql:10`, `StepCatalog.tsx:86-87` |
| F-21 | No UI copy tells the user sorting covers only loaded rows (A-10 asked for the limit to be honoured in copy) | `EventTable.tsx` |
| F-22 | Offline notice is a toast (`role="status"`), while A-9 says "dialog" — confirm intent with the owner | `lib/api.ts:33` |
| F-23 | Drizzle `meta/_journal.json` is stale — 0017…0022 unregistered. Tooling bookkeeping only; D1's own tracking is correct and all 22 apply cleanly | `apps/worker/migrations/meta/_journal.json` |
| F-24 | Hardcoded Spanish `"u. de "` outside i18n (D-9) | `routes/assemblies.tsx:416` |
| F-25 | `/production/assemblies/new` missing from the `AppPath` union — the nav model doesn't know the screen exists | `nav-items.ts:25-46` |
| F-26 | Negative-stock copy reads "El stock quedaría negativo" vs the agreed "…en negativo" | `i18n-sales.ts:73` |
| F-27 | No exhaustiveness test for `WAC_ENTRY_TYPES` (one exists for `STOCK_MOVEMENT_TYPES`) | `costing/wac.ts:154-159` |
| F-28 | Both PWA icons are `"purpose": "any maskable"` on unpadded artwork (Android clipping risk); no PNG favicon fallback | `manifest` + `public/` |
| F-29 | Raw `+=` on Centavos instead of `addMoney` (pre-existing, KOK-130 era, D-5) | `sessions/index.ts:409-410` |
| F-30 | On mobile, **Sesiones** sits behind the "Más" overflow while Finanzas gets a primary tab — questionable for a session-first app used mainly on a phone | `nav-items.ts:96-101` |
| F-31 | Possible edit-mode recompute no-op: saved lines get `lineKey = saved-production-line-${index}`, which never matches a live `recipe.lines[].id` — **single-sourced, needs manual confirmation** | `ProductionRunForm.tsx:115,206-296` |

### 3.4 Traceability discrepancy (not a defect)

Acceptance checklist point **15** ("reports that separate offerings sold from products included") is
listed in §A-1 as a **non-negotiable Block B acceptance requirement**, but the backlog assigns it to
**KOK-050 in Phase 5**. The team did not fail to build it — it was scheduled out of the block by the
backlog itself. The two documents disagree; the backlog should win, and §A-1 should say so.

---

## 4. Ordered task list

Proposed IDs continue from KOK-153. **P0 is the go-live gate.**

### P0 — Required before go-live on real data

| # | ID | Task | Area | Size | Closes |
| --- | --- | --- | --- | --- | --- |
| 1 | **KOK-154** | **Push Block C and restore the pipeline.** Push the 20 local commits, get CI green on `develop`, then merge `develop` → `main` so staging actually receives Phase 3.2, and re-run the staging smoke suite. Nothing else on this list is verifiable until this is done. Also wipe and re-seed staging, per the go-live gate's own second prerequisite (the pre-assembly catalog shape is not migrated forward). | infra | S | F-6 |
| 2 | **KOK-155** | **Repair the seed fixture.** Delete `rl_pan_caja` (recipe consuming PACKAGING). Add "Pan de masa madre 500 g" and "Ghee 200 g" as `FINISHED`/`UNIT` presentations with their assembly definitions, plus *cordel* and *tarjeta* packaging items, so Desayuno Kokoro consumes presentations rather than bulk product. **Acceptance: loading the fixture and running the worked example end-to-end reproduces Bs 13,00/u, Bs 18,00/u, Bs 5,70/u and Bs 40,70/u.** Add a test that validates every fixture recipe/definition line through the domain's own kind validators, so raw SQL can never again encode a rule the services forbid. | full | M | F-2 |
| 3 | **KOK-156** | **Assembly definitions & events UI.** CRUD screens for presentation/combo definitions (list, create, edit, activate/deactivate, live component-cost preview — the backend already returns it), plus an assemblies list/history with detail, edit, delete and restore wired to the existing endpoints. Add a nav entry and add the route to `AppPath`. Without this, Block B is not usable by the owner. | web | L | F-3, F-25 |
| 4 | **KOK-157** | **Fix the packaging double-deduction hole.** Replace the `isDefault`-only test in `exits.ts:115-134`, `ExitForm.tsx:148-150` and `replacement-cost-refresh.ts:165-175` with "any **active** definition for this output item". Decide and enforce the `isDefault` contract (either require exactly one default per output item at write time, or stop relying on it for correctness). Add a regression test for an item with an active non-default definition. | full | S | F-4 |
| 5 | **KOK-158** | **Fix sticky table headers.** Move sticky onto the `<th>` cells and stop the wrappers from becoming phantom scroll containers (`EventTable.tsx:111`, `StepCatalog.tsx:465`, `StepCount.tsx:250`) — either drop the `overflow` on the wrapper or give it a real bounded height. Verify in a browser at desktop and 390 px, on a table long enough to scroll. | web | S | F-1 |
| 6 | **KOK-073** | **`replacement_cost_history`** — already in the backlog (Phase 5.5), already committed in §C as a go-live prerequisite. Pull it forward and ship it **before the first real purchase**. | backend | S | F-5 |

### P1 — Agreed but not delivered; close before the next user test

| # | ID | Task | Area | Size | Closes |
| --- | --- | --- | --- | --- | --- |
| 7 | **KOK-142** | **Unsaved-changes guard** (already in Block D). Promote it: it was an explicit written agreement and addresses a loss the owner personally hit. One shared hook applied to the dialog primitive and to every form page. | web | S | F-7 |
| 8 | **KOK-159** | **Client-side length caps.** Derive `maxLength` from the same `safeText(N)` bounds the shared schemas already declare, so the two cannot drift, and apply to every free-text input. | web | S | F-8 |
| 9 | **KOK-160** | **Purchase total + "Se descontará X de la cuenta Y".** Reuse `PinnedSummaryFooter`. Was agreed in §B, never ticketed, never built. | web | S | F-9 |
| 10 | **KOK-161** | **Packaging suggestion on exits of unassembled product.** Prefill from the applicable active definition; keep manual edits; keep "default to none". | full | M | F-10 |
| 11 | **KOK-162** | **PWA update strategy.** Build-templated or hash-derived `CACHE_NAME`, network-first (or stale-while-revalidate with an update prompt) for the document, and a "nueva versión disponible" affordance. | web | S | F-11 |
| 12 | **KOK-163** | **Harden `customOrderId` semantics before Phase 4.** Make "omitted" and "explicitly cleared" distinguishable (`.nullish()` plus an explicit clear, or a patch-shaped update command), and add a test proving an update that omits the field does not unlink. | shared | S | F-13 |
| 13 | **KOK-164** | **Decide KOK-135's disposition.** Either expose the deduplicated figure through an endpoint and surface both numbers with the agreed explanatory copy, or re-mark it as a prerequisite and record in KOK-051 that the UI half is unbuilt. | backend | S | F-12 |

### P2 — Test and documentation integrity

| # | ID | Task | Area | Size | Closes |
| --- | --- | --- | --- | --- | --- |
| 14 | **KOK-165** | **e2e coverage for the three new verticals** (start/close a session from the header, record an assembly, order confirm→deliver→undo) **and run Playwright in the PR gate**, not only post-deploy. | web | M | F-14 |
| 15 | **KOK-166** | **Close the service/UI test gap:** route tests for `api/assemblies.ts` and `api/assembly-definitions.ts`; a test that drives `assertOrderLinkable` through `recordProductionRun`/`updateProductionRun` and the assembly equivalents (including the "only validate on change" path); pure-logic tests for `OrderPicker`, `WeeklyCalendar` and the assembly form's cost math. | full | M | F-14 |
| 16 | **KOK-167** | **Reconcile status records.** Restore KOK-132 to Done; drop "implementation pending" from O-6 and S-5 now that both shipped; regenerate the Drizzle `_journal.json` for 0017–0022; and correct §A-1 point 15 to reflect that reports are owned by KOK-050 (Phase 5). | docs | S | F-15, F-16, F-23, §3.4 |
| 17 | **KOK-168** | **Make `dates.ts` genuinely the single source.** Have `finance.ts`, `sessions.ts`, `counts.ts` and `inventory-views.ts` import it instead of redeclaring, and decide per module whether future dates are legitimate — then say so in the docstring. Add a per-vertical regression test so a dropped import is caught. | shared | S | F-17 |

### P3 — Polish (batch into one PR)

| # | ID | Task | Closes |
| --- | --- | --- | --- |
| 18 | **KOK-169** | Copy and consistency batch: condition the impact-dialog copy on the real case (F-18); fix the Agua fixture comments (F-20); add sorting-scope copy (F-21); move `"u. de "` into i18n (F-24); fix "…en negativo" (F-26); add a `WAC_ENTRY_TYPES` exhaustiveness test (F-27); padded maskable icon + PNG favicon fallback (F-28); `addMoney` in `sessions/index.ts:409-410` (F-29). |
| 19 | **KOK-170** | Replace the three `window.confirm` calls with the app `Dialog` primitive for visual and testing consistency (F-19). |
| 20 | **KOK-171** | Decide with the owner: offline notice as toast vs dialog (F-22), and whether **Sesiones** should be a primary mobile tab in a session-first app (F-30). Both are product calls, not defects. |
| 21 | — | Confirm or dismiss F-31 (production edit-mode recompute no-op) during the manual UI pass; ticket only if reproduced. |

---

## 5. Process observations

These caused more of the findings above than any individual coding mistake.

1. **Work is being marked Done without the "Done" definition being met.** Definition-of-Done item 5
   (deployed to staging, smoke-tested) has not been met by any of the three blocks, yet 30+ tasks are
   ✅. Either the DoD is honoured or it should be amended to describe what the team actually does —
   the current gap makes "Done" uninformative.
2. **`full`-area tasks are shipping backend-only.** KOK-123 (definitions) and KOK-124 (assembly event)
   are both `full` and both Done, yet the management UI for either never existed — KOK-153 had to be
   created mid-Block-C to notice the recording form was missing, and the definitions UI *still* hasn't
   been noticed. Suggested guard: a `full` task is not Done until a named screen is reachable from the
   navigation.
3. **The agreements doc and the backlog have drifted.** One §B item was lost entirely (F-9), one
   checklist point is scheduled two phases away (§3.4), and a status commit regressed the row it was
   meant to update (F-15). Worth one reconciliation pass (KOK-167) and then treating §B as a checklist
   with ids, not prose.
4. **Long-lived local work is a real risk.** Twenty unpushed commits containing a full block of domain
   changes lived on one machine. Push per task, not per block.
5. **Self-reports are optimistic in a specific, predictable way:** they accurately describe what was
   *built* and under-report what was *not reached* — sticky headers "confirmed to cover every table",
   client-side caps and the purchase total presented as agreed-and-done. Ask each block report to state
   explicitly what it did **not** verify.

---

## 6. Manual UI verification plan

Static review is complete; the browser pass is not. These are the checks that a human eye settles
fastest, ordered by how likely they are to change a P0 decision. Test on **desktop and at ~390 px**,
and in **both themes**.

### A. Confirm the blockers (highest value)

1. **Sticky headers (F-1).** Open any long list — Inventario, Ventas, or onboarding *Catálogo inicial*
   with many rows — and scroll. Do the column titles stay visible? Expected today: **no**. This is the
   single check that confirms KOK-158.
2. **Assembly definitions (F-3).** Try to create a new presentation or combo — e.g. "Kéfir natural
   500 ml" or a new combo — using only the UI. Then try to find the *list of assemblies you have already
   recorded*, open one, and edit it. Expected: none of this is possible. Note how you'd even find
   `/production/assemblies/new` without being told.
3. **Envasado/Armado recording.** From Producción, record an assembly end to end. Check the running
   total, whether consumed components and their costs are visible, and what happens if no definitions
   exist in the database.
4. **Unsaved-changes guard (F-7).** Start filling in *Crear sesión*, then click outside the dialog. Does
   your work vanish? Repeat on the purchase and sale forms. Expected: work is lost everywhere.

### B. Flows never exercised by the automated pass

5. **Orders lifecycle.** Create → confirm (check the single *Método de pago + Cuenta* selector and that
   the payment date is editable) → En producción → back to Confirmado → Listo **with no linked
   production** (expect a warning you must confirm) → Entregar → **Deshacer entrega**. Note which
   confirmations are plain browser pop-ups versus proper in-app dialogs (F-19), and whether undoing a
   delivery that was **already collected** is refused with a clear message.
6. **Production form.** Check: the order picker appears and offers orders in every status except
   Entregado/Cancelado; the per-ingredient stock indicator shows ✓ / ! and a neutral "No medido" for
   Agua; actual output prefills from the recipe and **recomputes when you change batches — but does not
   overwrite a number you typed yourself** (this is F-31: try it in **edit** mode specifically, on a
   saved production run); unit cost reads "Bs/[unidad]"; the extra-cost field has its tooltip and no
   Estimación toggle.
7. **Validation behaviour (F-8).** On *Crear ítem* and *Nueva venta*: type letters into a numeric field,
   paste a very long text into notes, and submit with a required field empty. Record **when** feedback
   appears (as you type? on leaving the field? only on save?) and whether required fields are marked.
   This is the baseline for Block D's KOK-143 — your notes here are worth more than any code review.
8. **Filters and sorting.** On Ventas / Pedidos / Salidas: does the date range default to *inicio de mes
   → hoy*, and does it survive a page reload? Click column headers to sort — asc, desc, back to natural
   — and confirm sorting a second column clears the first. Try it with the keyboard (Tab + Enter).

### C. Cross-cutting

9. **Dark mode.** Toggle it in Configuración and check the **calendar icons** on date fields (the
   original complaint) and general contrast on 2–3 screens.
10. **PWA (F-11).** Install it on your phone. Then have someone rebuild/redeploy and open it again —
    does it still work, or does it break until you force-refresh?
11. **Mobile at ~390 px.** Start a session from the header, open the weekly calendar, and fill one
    line-bearing form. Also judge F-30: should **Sesiones** be a primary bottom tab instead of hidden
    under "Más"?
12. **Copy check.** Confirm live: "Artículos comprados", "Artículos vendidos", "Artículos del pedido",
    "Preparación", "Costo invisible del periodo", and the Ventas note telling you to use *Entregar
    pedido* for an order.

**Already verified in the browser before the pass was stopped:** starting a session from the header,
closing the previous session and starting a new one of the same type in a single step, and running
concurrent sessions of different types. These worked.

---

## 7. Method and coverage

| Area | How verified | Confidence |
| --- | --- | --- |
| Costing, replay, WAC, cycle detection, C-3d | Source read + test read + golden-number assertions | High |
| Sessions domain (KOK-130…135) | Source + migration + tests | High |
| Orders domain (KOK-136…139) | Source + full state-machine matrix test | High |
| Block A items | Source read, item by item | High (except pixel alignment) |
| Repo health | Commands executed: lint, typecheck, build, 987 tests, invariants, migration reset | High |
| Fixtures | Source read + independent re-verification | High |
| Docs/KB/backlog consistency | Source + `git log`/`git show` | High |
| Pipeline state | `git rev-list`, `gh run list`, `deploy.yml` | High |
| **Browser behaviour** | **Partial — header session flow only** | **Low — see §6** |
| Pixel-level alignment (KOK-109) | Not verifiable statically | None |

**Commands run (read-only):** `pnpm run lint`, `pnpm run typecheck`, `pnpm --filter @kokoro/web run
build`, `pnpm run test`, the invariant suite, and `pnpm run db:reset:dev` against the local Miniflare
database only. No source file was modified during this review.

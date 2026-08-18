# Tech-lead review — Blocks A, B and C (Phase 3.2)

**First issued:** 2026-08-14 · branch `develop` @ `d2cfbff`
**Revised:** 2026-08-16 · `develop` = `main` = `origin/main` @ `45a04ea`
**Scope:** KOK-104…120, KOK-151/152 (Block A) · KOK-121…129, KOK-150 (Block B) · KOK-130…139, KOK-153 (Block C)
**Measured against:** [`acuerdos-prueba-usuario-1.md`](acuerdos-prueba-usuario-1.md) (the closed record of what was
agreed with the owner), the KB (Docs 03/04/06/07/12/13) and `CLAUDE.md`'s golden rules D-1…D-10.

**New inputs folded into this revision:**

- **PRs #24–#29** merged 2026-08-14/15 — the deploy pipeline was restored, three real D1 migration
bugs were found and fixed while getting Phase 3.2 onto staging, staging was wiped and reseeded, and
four onboarding defects were fixed.
- **The owner's own manual verification of §6 Section A**, recorded in
[**Issue #30**](https://github.com/TomAtomicDev/kokoro-managemnt-system/issues/30) (2026-08-16). She
confirmed the blockers this review predicted **and found fourteen more**, all of them in the daily
capture forms.

> **What this document is.** An independent verification of what the three merged blocks actually
> deliver, against what was promised, kept current as evidence arrives. It supersedes the blocks' own
> self-reports ([A](block-a-quick-wins.md), [B](block-b-grounding-report.md),
> [C](block-c-sessions-orders.md)) where they disagree. **§4 is the actionable output**: task cards
> ready to be pulled into
> [`10-implementation-backlog.md`](../system-design-knowledge-base/10-implementation-backlog.md).
>
> **Coverage.** Static/code verification is complete and was re-run against `45a04ea`. Browser
> verification is now **partially owner-led**: §6 Section A is done (Issue #30); Sections B and C are
> still outstanding. Findings still awaiting a human eye are marked **[UI]**.

---

## 0. What changed since the 2026-08-14 issue


| Was                                                                 | Now                                                                                                                                                                | Evidence                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **F-6** — nothing pushed, `main` a month stale, staging unreachable | ✅ **Resolved.** `origin/main` = `origin/develop` = `45a04ea`. Phase 3.2 is deployed; staging was wiped, re-migrated (0001–0022) and reseeded. **KOK-154 is done.** | `git rev-list --left-right --count origin/main...origin/develop` → `0 0`; PRs #24–#27 |
| Migrations "22/22 apply cleanly"                                    | Still true **from scratch** — but getting them onto a **non-empty** database exposed three latent data-loss bugs, now fixed                                        | PRs #25/#26/#27                                                                       |
| **F-1, F-3, F-7** predicted from source                             | ✅ **Owner-confirmed in the browser**                                                                                                                               | Issue #30 §A-1, §A-2, §A-4                                                            |
| §6 Section A "not yet run"                                          | ✅ Run by the owner, and it surfaced **F-32…F-45** — fourteen new findings, all in the capture forms                                                                | Issue #30                                                                             |
| Task list assumed the pipeline was the top risk                     | The pipeline is fixed. **The top risk is now the form layer**, and the KB already specifies its fix (Doc 06 §3) — it was simply never built                        | §1                                                                                    |


Everything else in §3 was re-verified against `45a04ea` and **still stands unfixed**: `rl_pan_caja`
is still in the seed fixture, `replacement_cost_history` still returns zero grep hits, the app still
contains exactly one `maxLength`, "Se descontará" still returns zero matches, and there is still no
`beforeunload` or dirty-state guard anywhere in `apps/web/src`.

---

## 1. Verdict

**The engine is sound. The pipeline is fixed. The product the owner touches is the whole remaining
problem — and its fix is already written down in our own KB.**

Three things are true, and the third is the strategic point of this revision:

1. **The domain core is genuinely well built.** Costing, replay, atomicity and state machines are
areful, correct and well tested. Nothing in §2 needs re-doing.
2. **The pipeline risk is retired, and retiring it paid for itself.** Pushing Block C forced the deploy
hat found `PRAGMA foreign_keys=OFF` is a no-op inside D1's implicit migration transaction — which
eans migrations 0012/0013/0014/0022 would have **silently deleted** every item alias, purchase line
nd production consumption row the first time they met a non-empty database. That bug was invisible
o a from-scratch test and would have been catastrophic in production. The month of local-only work
as a real mistake; discovering this was the reward for ending it.
3. **Every single one of the owner's fourteen new complaints lands in a form, and nine of them are
ymptoms of one unbuilt pattern.** Doc 06 §3 and Doc 07 §8 — written before any of this code — say
very line-bearing form (Compra, Venta, Producción, Envasado/Armado, Pedido, Conteo) is **a full
age with its own URL and a pinned summary footer**, and §A-12 of the agreements adds an
nsaved-changes guard to all of them. Today **only Envasado/Armado is a page**; the rest are
ialogs. The owner independently rediscovered our own specification, in her own words: *"El
ormulario de registrar compra es un desastre!! Mejor hacerla una pantalla separada."*

  That is not a new requirement. It is **KOK-140/141/142, sitting in Block D**, behind work that
   matters less to her daily use. The correct response is to **pull the form pattern forward**, not to
   patch twelve symptoms individually.

**Revised go-live position.** The gate is shorter than it was on 2026-08-14 — deployment and staging
are no longer blockers — but it is **not** shorter overall, because the owner's test converted three
"probably fine" areas into confirmed blockers and added the Envasar surface as a real, daily,
unusable-today workflow. **Go-live on real data still requires the full P0 list in §4.1.**

One thing worth saying plainly: this test session was worth more than the entire static review. Every
finding in §3.2 that the owner confirmed was already predicted here — but F-33 (an error message she
could not act on), F-38 (a button cut in half), F-41 (a delete button scrolled out of sight) and F-39
(arithmetic she should never have been asked to do) were all invisible to source reading. **Section B
and C of §6 have not been run yet, and they should be run before the next block is planned.**

---

## 2. What is genuinely sound — do not re-do this work

Recorded deliberately, so the fixes below don't turn into a rewrite of things that are already right.

### Costing and replay (the highest-risk code in the system)

- **C-10 is computed exactly as specified.** `core/assembly-events/cost.ts:5-19` — `direct = Σ(qty × unitCostSnapshotMc)`, `outputUnitCost = direct / actualOutputQty`, with no indirect cost and no
allocated session cost.
- **The replay hole flagged during grounding is closed.** `core/costing/replay.ts:362-397` tests
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
- The partial unique index is correct and correctly scoped: `ux_sessions_open_per_type ON sessions(type) WHERE status='OPEN' AND deleted_at IS NULL`, present in both migration and Drizzle schema, with a
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

### Deployment and migration safety — new since 2026-08-14

Added here because it is now load-bearing and must not be undone by a future "cleanup":

- `**PRAGMA defer_foreign_keys=ON` is the only pragma that works** inside `wrangler d1 migrations apply`'s implicit transaction. `PRAGMA foreign_keys=OFF` is silently a no-op there. Migrations
0012/0013/0014/0022 now use `defer_foreign_keys` **and** snapshot/restore their `ON DELETE cascade`
child tables (`item_aliases`, `purchase_lines`, `production_consumptions`), because deferring does
not stop cascades — they fire immediately regardless of the pragma (PR #25).
- `**reset-remote-d1.mjs` now drops in real FK-dependency order**, computed from `PRAGMA foreign_key_list` per table, handles the one genuine cycle (`sales` ⇄ `custom_orders`) by deleting
rows before dropping tables, drops views as well as tables, and excludes Cloudflare's reserved
`_cf_%` tables (PRs #26/#27).
- `**wrangler d1 execute --remote --file=…` collapses a multi-statement file into a single summary
row**, unlike `--local`, which returns one result set per statement. Any script that reads results
back must use one `--command` per statement. This cost a full debugging cycle; it is written down
here so it costs nobody another one.

### Block A items confirmed correct

KOK-104 (all renames live, no stale strings), KOK-107, KOK-108 (all six tooltips; `InfoTooltip` is a
real `<button>`, keyboard-operable, Escape-to-close with focus restore, correct ARIA; the Alias tooltip
carries the owner's "Pint3" example), KOK-109, KOK-110 (prefills correctly gated on create mode; catalog
order is a real SQL `CASE`), KOK-111 (Agua = 231 milli-centavos/L in **both** fixtures), KOK-113 (pairing
validated in all five service flows), KOK-114 (`listWasteSummary`'s formula re-derived term-for-term
against `v_waste`), KOK-115 (sort logic fully correct — single active column, `Intl.Collator("es-BO", {numeric:true})`, keyboard-operable headers with `aria-sort`), KOK-116, KOK-118, KOK-119, KOK-151/152,
and **D-10: zero new dependencies** across the entire block.

**KOK-112 was solved better than asked.** The agreement said "hide the negative-stock warning in edit
mode"; the implementation instead recomputes it against the sale's own already-deducted stock
(`SaleForm.tsx:276-291`), which removes the false warning without hiding a true one.

**Mojibake is a non-issue.** User-facing Spanish strings are clean; the remaining `â€"` sequences are
em-dashes inside code comments only.

**The assembly form's stock indicator does exist.** `routes/assemblies.tsx:163-200` computes per-line
sufficiency correctly, including a neutral "no medido" state for unmetered items. The owner's complaint
(F-35) is that it is an icon with a `title` — not that the logic is missing. Fix the presentation, keep
the logic.

---

## 3. Findings

Severity is judged against **go-live on real data**, which is what the close of Block C was supposed to
enable. Findings keep their original numbers so earlier references stay valid.

### 3.1 Resolved since the first issue

**F-6 · Nothing from Phase 3.2 had been pushed or deployed.** ✅ **Closed.** `develop` and `main` are
both at `45a04ea`; staging runs all 22 migrations on freshly seeded data. Closed by **KOK-154** (PRs
#24–#27). Two residues, carried into §5: the Block A merge landed with CI red for several commits, and
migrations 0012–0014/0022 were **edited after being authored** (legitimate — they had never been
recorded as applied anywhere — but they are now applied on staging and are **frozen from here on**,
per the `CLAUDE.md` guardrail).

### 3.2 Blockers

**F-1 · Sticky table headers do not stick — app-wide.** *(Block A, KOK-106)* · **✅ Owner-confirmed**
Owner, Issue #30 §A-1: *"No sticky first row (titles) in long tables like Catálogo de Ítems, but they
do exist on Calendar view of sessions."* That contrast is the diagnosis, not an inconsistency: the
calendar has no intermediate `overflow-*` wrapper, so its sticky resolves against the real viewport.
Everywhere else, the scrolling viewport is `<main className="min-h-0 flex-1 overflow-y-auto">`
(`AppShell.tsx:36`), but every sticky header sits inside a nested wrapper that becomes its own scroll
container: `EventTable.tsx:111` (`overflow-x-auto`, sticky `<tr>` at `:114`), `StepCatalog.tsx:347`,
`StepCount.tsx:252`. Because `overflow-x: auto` with `overflow-y` unset forces `overflow-y` to compute
to `auto`, each wrapper is a scroll container whose height is content-driven — so it never scrolls,
and the header sticks to nothing.
**Compounding second cause:** the sticky is applied to a `<tr>` on a `border-collapse` table
(`EventTable.tsx:112`), which is historically unreliable in Chromium; sticky belongs on the `<th>`
cells. → **KOK-158**

**F-2 · The dev/staging seed fixture violates the new model and double-counts packaging.** *(Block B,
KOK-129)* · **Unfixed, and now shipped to staging**
`seed-fixtures.sql:48` still contains `('rl_pan_caja', 'recipe_pan_masa_madre', 'item_cajas', 6000)` — a
production **recipe consuming a `PACKAGING` item**. This is the superseded KOK-100 model; the domain's
own `validateRecipeItemKinds` (`recipes.ts:55-64`) rejects exactly this, so the row can only exist
because raw SQL bypasses the service layer (against D-2's spirit). Worse, the Desayuno Kokoro definition
*also* consumes `item_cajas` (`adl_desayuno_caja:72`), so **the shipped demo data charges the box
twice** — precisely the defect ADR-018 exists to remove.
**New as of this revision:** the staging reset in PR #26/#27 reseeded staging **from this same file**,
so staging's Desayuno Kokoro cost and its Precios y márgenes row are wrong *right now*. Anything the
owner reads there about that combo should be disregarded until this is fixed.
The worked example is also not reproducible: there are no "Pan de masa madre 500 g" or "Ghee 200 g"
presentations (the combo consumes the unbagged loaf and bulk ghee directly, collapsing the two-level
structure), and no *cordel*/*tarjeta* items exist at all. The Kéfir 500 ml and 1 L presentations **are**
correctly modelled. → **KOK-155**

**F-3 · Block B's flagship model has no management UI.** *(Block B, KOK-123)* · **✅ Owner-confirmed,
and the ask is bigger than the finding**
`apps/web` contains only a read hook (`features/assembly-definitions/api.ts` exports
`useAssemblyDefinitions` and nothing else) and one write hook for events. The owner cannot create,
edit, view or deactivate a presentation or combo, and cannot list, open, edit or delete a recorded
Envasado — although the backend supports all of it (`api/assembly-definitions.ts`, `api/assemblies.ts`,
full update/delete/restore in `core/assembly-events`). The single entry point is one link on
`/production` (`routes/production.tsx:38`); the route isn't in the `AppPath` union.
Owner, Issue #30 §A-2: *"No list of assemblies (in Spanish it would be better to call them
'Envasado/Pack'). The button 'Registrar Armado' is hidden on Producción. It would be great to separate
all of it to a new page 'Envasar', separate from 'Producción'."* → **KOK-156**

**F-4 · Stock-exit packaging can be double-deducted.** *(Block B, KOK-128)*
Both the server guard (`core/inventory/exits.ts:115-134`) and the client gate
(`ExitForm.tsx:149`) decide "is this an assembled presentation?" by looking **only for a
`isDefault = 1` active definition**. But `isDefault` is optional and unenforced
(`packages/shared/src/assembly-definitions.ts:32`, `z.boolean().default(false)`; nothing requires one
default per output item). An item with an active **non-default** definition is a genuine presentation
whose WAC already contains its packaging — yet both layers treat it as unassembled and allow packaging
lines on its exit, violating A-1's "never deduct a packaging item twice". The same `isDefault`-only
assumption also drops such items from `planReplacementCostRefresh`
(`replacement-cost-refresh.ts:86,113,165-175`), so their composite replacement cost and price-health
alert never activate either.
**New product angle:** the owner independently asked for exactly the affordance `isDefault` was meant
to be (F-37, *"¿no hay ningún atajo o 'Envasado predeterminado'?"*). So the resolution is no longer
"pick one of two options" — see the recommendation in **KOK-157**. → **KOK-157**

**F-5 · KOK-073 (`replacement_cost_history`) is not built.** *(Go-live commitment §C)*
Still `📋 To Do` with zero code (`grep` for `replacement_cost_history` returns nothing, re-checked at
`45a04ea`). §C of the agreements committed it must be in production **before the owner's first real
purchase**, precisely because the series cannot be reconstructed backwards. Every week live without it
is a week of cost-erosion history lost permanently. → **KOK-073**

**F-32 · The Envasado form's "Definición" selector is empty and unexplained.** *(new — Issue #30 §A-3)*
Owner: *"El campo 'Definición' es un selector con una sola opción 'Sin definición (entrada manual)'.
Dos problemas: (1) no se entiende qué es ni la razón de existir de ese campo, y (2) si solo tengo una
opción, no hay razón de ser de ese selector."*
Both are correct. `routes/assemblies.tsx:340-352` always renders the `<select>` even when
`definitions.length === 0`, and `i18n-assemblies.ts:6`'s placeholder — "Sin definición (entrada
manual)" — describes an implementation branch, not something she asked for. There is no help text
saying a definition is a reusable template. And because F-3 leaves no way to create one, on a freshly
onboarded database the list is **always** empty, so the control can never do anything but confuse.
→ **KOK-173** (presentation) + **KOK-156** (the missing definitions themselves)

**F-33 · The Envasado output-item rule is enforced only at submit, with no way to see or satisfy it.**
*(new — Issue #30 §A-3)*
Owner: *"Al guardar aparece un error 'El ítem de salida debe ser un producto terminado con unidad de
medida UNIT' pero nunca sabemos cuál es la unidad del ítem de salida que hemos elegido."*
`validateAssemblyItemKinds` (`core/assemblies/assembly-definitions.ts:43-48`) correctly enforces Doc 03's
AssemblyDefinition rule (*"Output item is FINISHED with unit `UNIT`"*). The UI enforces **half** of it:
`ItemPicker` is called with `kindFilter="FINISHED"` (`routes/assemblies.tsx:367`) and **no unit
filter**, and neither the picker nor the selected-item display ever shows a unit. So the app actively
offers a choice it will then reject, with an error naming a property it never displayed. This is a
correct rule delivered as a dead end. → **KOK-176** (+ unit display in **KOK-173**)

**F-40 · Every line-bearing form except Envasado is still a modal, contradicting the KB.** *(new —
Issue #30 §A-4; pre-existing spec gap)*
Doc 06 §3 (`06-ux-ui-specification.md:94`) and Doc 07 §8 (`07-screen-catalog.md:8`) both state that
Compra, Venta, Producción, Envasado/Armado, Pedido and Conteo are **full pages with their own URL and
a pinned summary footer**. §A-12 of the agreements repeats it and adds the unsaved-changes guard.
Today `PurchaseForm`, `SaleForm`, `ProductionRunForm`, `CountForm` and the order forms are all
`<Dialog>`; only `/production/assemblies/new` is a page. This is not new work — it is **KOK-140/141**,
scheduled into Block D behind lower-value items. The owner reached the same conclusion unprompted:
*"El formulario de registrar compra es un desastre!! Mejor hacerla una pantalla separada."*
It is listed as a blocker here — not because the pattern is missing, but because **it is the single
change that resolves F-41, F-43, F-9 and half of F-36 at once**, and because purchases are a daily
task she currently describes as *"un horror"*. → **KOK-140** (pulled forward)

**F-41 · `LineEditor`'s column headers desynchronize from its rows, and the row overflows
horizontally — hiding the remove button and the cost preview.** *(new — Issue #30 §A-4)*
Owner: *"Se genera la barra de scroll horizontal (no se ve el costo unitario vs costo de reposición
anterior) y el título 'Total de línea (Bs)' está mal ubicado, está encima de la columna de cantidad…
Puedo agregar líneas de artículos comprados pero no eliminarlos, y luego me obligan a llenar los datos
de una fila que me sobra, eso es un horror!"*
Root cause is one layout decision: `LineEditor.tsx:92-100` renders the header as **its own flex row**,
and `:103-168` renders each data row as **a separate flex row inside a bordered, padded box**. The two
share no layout context, so any cell with an intrinsic minimum wider than its declared width — the
`ItemPicker` combobox is the culprit — pushes the row's columns right while the header stays put. At
that point the header labels sit over the wrong columns, and the row exceeds the dialog width, so the
last two cells (`renderExtraColumns`, which holds the unit-cost-vs-replacement-cost preview, and the
remove `<Button>` at `:158-167`) scroll out of sight.
**The remove button therefore exists and works — the owner simply cannot see it.** That is worse than
it being missing, because it reads as "the app forces me to submit a blank row". → **KOK-172**

**F-43 · Modal-hosted forms discard all input on close; drawer-hosted forms do not.** *(refines F-7 —
Issue #30 §A-4)*
Owner: *"Si cierro el modal y vuelvo a darle al botón 'Registrar compra' se pierden todos los datos y
tengo que iniciar de nuevo. Lo mismo en el formulario de Nueva venta. Esto es tedioso."* — but also:
*"Los datos ingresados en el formulario de cerrar sesión sí se mantienen si cierro el drawer"* and
*"El formulario de 'Conteo' sí mantiene los datos si cierro el drawer sin presionar 'Confirmar
conteo'."*
This sharpens F-7 usefully: the loss is not universal, it is **structural**. Forms whose state lives in
a component that unmounts with the dialog lose everything; forms whose state lives in a parent that
survives (or is server-persisted, as the count is) keep it. So the fix is not "add a `beforeunload`"
— it is the guard **plus** deciding where each form's state lives, which is exactly what the full-page
migration settles. → **KOK-142** (pulled forward) + **KOK-140**

### 3.3 Major

**F-7 · No unsaved-changes guard exists anywhere.** *(A-12, explicit written agreement)*
No `beforeunload`, no discard-confirm hook, no dirty-state guard in any form or dialog in
`apps/web/src` — re-confirmed at `45a04ea`. A-12: *"Unsaved-changes guard on every dialog and form
page, not only on Crear sesión where it was noticed: today an outside click discards the work."*
Now owner-confirmed via F-43. → **KOK-142**

**F-8 · Client-side length caps were not implemented.** *(KOK-120 / §B)*
The whole web app contains exactly **one** `maxLength` attribute (`ItemForm.tsx:292`, item name). Every
other free-text field backed by a `safeText`-capped schema — customer name/phone/notes, purchase notes,
sale/production/session/exit/order notes, order description, shared-cost label, alias — has no cap. The
server half (`safeText`, control-character stripping) is solid and complete, so this is a UX miss, not a
data-integrity one. → **KOK-159**

**F-9 · An agreed §B quick win was silently dropped.**
*"Computed purchase total + 'Se descontará X de la cuenta Y'"* is listed in §B (`acuerdos:579`) as
verified and agreed. `grep -r "Se descontará" apps/web/src` returns **zero matches**, `PurchaseForm.tsx`
was not touched in Block A, and no KOK id was ever created for it. → **KOK-160** (absorbed by KOK-140
if that lands first)

**F-10 · Packaging suggestion on exits was not built.** *(A-1 case 3, UX rule 2)*
`ExitForm.tsx:314-339` implements only the show/hide gate plus an empty `LineEditor`. It never looks up
an applicable assembly definition to prefill packaging lines. A-1 requires: *"suggest packaging only
when the exit is of an unassembled product and an applicable definition exists."* This is the **only
surviving piece** of the "suggested packaging" idea after A-5 dropped the rest. → **KOK-161**

**F-11 · The PWA service worker will serve a broken stale shell after any deploy.** *(KOK-105)* ·
**now live, so now real**
`apps/web/public/sw.js:1` hardcodes `const CACHE_NAME = "kokoro-static-v1"`, never build-templated; the
document handler (`:44-65`) is cache-first; `main.tsx:30-32` registers once with no
`registration.update()` and no "new version" prompt. Vite emits content-hashed bundles, so after a
deploy a returning user's cached `index.html` references bundles that no longer exist — a white screen
fixable only by a hard refresh she won't know to perform. **The API is correctly excluded from caching**
(`sw.js:4-16` excludes `/api/` and `/telegram/`), so there is **no stale-financial-data risk**.
Severity note: this was hypothetical while nothing deployed. Staging now deploys, so the next deploy
after she installs the PWA is the one that breaks it. → **KOK-162**

**F-12 · KOK-135 shipped a primitive with no consumer.**
`getDeduplicatedSessionHours` / `unionIntervalMinutes` (`sessions/index.ts:1014-1119`) are correct and
well tested (including property tests) but have **zero call sites**. The task's own description says
*"Surface both figures when they differ, with copy explaining why."* → **KOK-164**

**F-13 · `customOrderId` omission means "clear the link" — a latent unlink bug for Phase 4.**
The field is `z.string().min(1).optional()` (not `.nullish()`) in `production-runs.ts:68,133` and
`assembly-events.ts:20,53`, and the builder does `customOrderId: command.customOrderId ?? null`
(`production/index.ts:972`, `assemblies.ts:621`). It works today **only** because `ProductionRunForm`
re-seeds and resubmits the existing value on every edit. Any caller that omits the field meaning "leave
unchanged" — exactly what a Telegram/AI capture path (Phase 4, next) would naturally do — silently
unlinks a delivered order's production run. → **KOK-163**

**F-14 · Test coverage stops at the service boundary.**

- No test wires `assertOrderLinkable` through the commands: `production-runs.test.ts` and
`assemblies.test.ts` contain **zero** `customOrderId` references. The exact "unconditional guard"
regression already caught and fixed once (`eaf9686`) has nothing guarding against its return.
- **14 new web modules have zero test coverage**, including `OrderPicker`, `WeeklyCalendar`,
`PinnedSummaryFooter`, `PaymentAccountSelect`, `DateRangeFilter`, `routes/assemblies.tsx`, and both
assembly feature APIs.
- No `assemblies-routes.test.ts` / `assembly-definitions-routes.test.ts`, while ten other verticals have
route tests.
- **No e2e coverage of assemblies, sessions or orders**, and `ci.yml` does not run Playwright at all;
it only runs post-deploy against staging. → **KOK-165, KOK-166**

**F-34 · The unit selector built for recipes was never propagated to the other line editors.** *(new —
Issue #30 §A-3, §A-4)*
Owner, on purchases: *"Tampoco puedo ver en qué unidades debo agregar la harina; por el trabajo que
hicimos, debería poder elegir en qué unidad colocar: Kg o gramos."* And on Envasado: *"Tampoco se ve la
unidad del componente del armado que se pone en el campo 'Cantidad'."*
KOK-101 / PR #19 built exactly this — a compatible-unit selector with magnitude-based defaults — but
wired it **only** into `RecipeForm`, via the `onItemChange` escape hatch `LineEditor` exposes
(`LineEditor.tsx:55`). `PurchaseForm.tsx:394-408` and `routes/assemblies.tsx:434-449` pass no
`onItemChange` and render no unit anywhere. The canonical-unit work is done; only its reuse is missing.
→ **KOK-172**

**F-38 · The session detail drawer's action row overflows and truncates "Eliminar".** *(new — Issue
#30 §A-4)*
Owner: *"la lista de botones es tan ancha que el botón eliminar queda a medias y no se ve la otra
mitad."*
`SessionDetailDrawer.tsx:169-210` puts a status `<Badge>` and up to **four** buttons (Registrar
producción / Registrar compra, Cerrar, Editar, Eliminar) in a single `flex items-center gap-2` with no
`flex-wrap` and no overflow handling, inside `justify-between` against the badge. An OPEN
`PRODUCTION` session hits the worst case and clips the destructive action — the one where a
half-visible button is most dangerous. → **KOK-175**

**F-39 · Closing a session asks the owner to do arithmetic the app should do.** *(new — Issue #30 §A-4)*
Owner: *"la fecha y hora Fin debería ser lo actual por defecto y ya luego yo poder editarlo, cosa de
que lo único que tenga que hacer es darle al botón cerrar. Y si pongo manualmente una duración en
minutos, la fecha y hora fin debería calcularse automáticamente. De esa forma los dos datos pueden
estar presentes sin representar incoherencias, generando el error 'Indica la hora de fin o la duración,
no ambas.'"*
Both are right, and neither needs a KB change. Doc 03 **S-2** says a session records *"`ended_at` (or
direct `duration_min`)"* — the exclusivity is a **command** rule
(`packages/shared/src/sessions.ts:96-102`), not a display rule. Today the UI enforces it by *disabling*
the end field once a duration is typed (`SessionForm.tsx:398`), which is the least helpful way to
express "one or the other". Deriving one from the other in the UI and submitting exactly one field
satisfies the schema unchanged. → **KOK-174**

**F-42 · The purchase item picker offers items the service will always reject.** *(new — Issue #30 §A-4)*
Owner: *"¿Por qué puedo poner agua en registros comprados? Nunca debería — dijimos que marcar una
materia prima como 'No medible' significa que nunca lo voy a comprar realmente."*
She is quoting our own KB back at us. Doc 03 C-9 (`03-domain-model.md:187`): *"**No PURCHASE_IN.**
`recordPurchase` rejects a line against an unmetered item."* The service **does** enforce it
(`core/purchasing/index.ts:195`). The picker does not filter on `isUnmetered`, so the app offers Agua,
lets her fill in a quantity and a total, and rejects the whole purchase on submit. Same failure shape
as F-33: a correct rule, invisible until it bites. `ItemPicker` has no `isUnmetered` filter prop at
all (`ItemPicker.tsx:24-67`). → **KOK-176**

### 3.4 Minor


| #    | Finding                                                                                                                                                                                         | Evidence                                                                             | Task              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------- |
| F-15 | `KOK-132` was flipped **back** to `📋 To Do` by the commit whose message says it marked it done                                                                                                 | `5cdda82`                                                                            | KOK-167           |
| F-16 | KB says "implementation pending" for two shipped rules — O-6 (order reversal) and S-5 (dedup hours)                                                                                             | `03-domain-model.md:299,371`                                                         | KOK-167           |
| F-17 | Four modules locally redeclare `businessDateSchema`/`occurredAtSchema` **without** the future-date refinement, contradicting `dates.ts`'s "single source" docstring                             | `finance.ts:24-30`, `sessions.ts:35-41`, `counts.ts:22-28`, `inventory-views.ts:23+` | KOK-168           |
| F-18 | Impact-dialog copy says *"Esta sesión ya está cerrada"* even for a backdated create into an **open** session                                                                                    | `i18n-production.ts:107-108`                                                         | KOK-169           |
| F-19 | Native `window.confirm` for free reversal, the READY warning and undo-delivery's first gate, while every other order dialog uses the app `Dialog` primitive                                     | `OrderDetailDrawer.tsx:202,214,235,260`                                              | KOK-170           |
| F-20 | Fixture comments claim Agua is "Bs 0.005/L" while the (correct) data says `231` = Bs 0,00231/L — invites a future "fix" back to the wrong value                                                 | `seed-fixtures.sql:10`, `StepCatalog.tsx:86-87`                                      | KOK-169           |
| F-21 | No UI copy tells the user sorting covers only loaded rows (A-10 asked for the limit to be honoured in copy)                                                                                     | `EventTable.tsx`                                                                     | KOK-169           |
| F-22 | Offline notice is a toast (`role="status"`), while A-9 says "dialog" — confirm intent with the owner                                                                                            | `lib/api.ts:33`                                                                      | KOK-171           |
| F-23 | Drizzle `meta/_journal.json` is stale — 0017…0022 unregistered. Tooling bookkeeping only; D1's own tracking is correct                                                                          | `apps/worker/migrations/meta/_journal.json`                                          | KOK-167           |
| F-24 | Hardcoded Spanish `"u. de "` outside i18n (D-9)                                                                                                                                                 | `routes/assemblies.tsx:416`                                                          | KOK-169           |
| F-25 | `/production/assemblies/new` missing from the `AppPath` union — the nav model doesn't know the screen exists                                                                                    | `nav-items.ts:25-46`                                                                 | KOK-156           |
| F-26 | Negative-stock copy reads "El stock quedaría negativo" vs the agreed "…en negativo"                                                                                                             | `i18n-sales.ts:73`                                                                   | KOK-169           |
| F-27 | No exhaustiveness test for `WAC_ENTRY_TYPES` (one exists for `STOCK_MOVEMENT_TYPES`)                                                                                                            | `costing/wac.ts:154-159`                                                             | KOK-169           |
| F-28 | Both PWA icons are `"purpose": "any maskable"` on unpadded artwork (Android clipping risk); no PNG favicon fallback                                                                             | `manifest` + `public/`                                                               | KOK-169           |
| F-29 | Raw `+=` on Centavos instead of `addMoney` (pre-existing, KOK-130 era, D-5)                                                                                                                     | `sessions/index.ts:409-410`                                                          | KOK-169           |
| F-30 | On mobile, **Sesiones** sits behind the "Más" overflow while Finanzas gets a primary tab — questionable for a session-first app used mainly on a phone                                          | `nav-items.ts:96-101`                                                                | KOK-171           |
| F-31 | Possible edit-mode recompute no-op: saved lines get `lineKey = saved-production-line-${index}`, which never matches a live `recipe.lines[].id` — **still unconfirmed; belongs to §6 Section B** | `ProductionRunForm.tsx:115,206-296`                                                  | §6 B-6            |
| F-35 | Per-line *"Aporte al costo:"* text repeats the column header, and the insufficient-stock signal is an icon + `title` only — invisible on touch, unreadable by the owner                         | `routes/assemblies.tsx:163-200`, `i18n-assemblies.ts:20-22`                          | KOK-173           |
| F-36 | `PinnedSummaryFooter` on the Envasado page renders wider than the form body (the footer is full-bleed, the form is `max-w-3xl` centred) and eats vertical space the form needs                  | `PinnedSummaryFooter.tsx:21`, `routes/assemblies.tsx:335,467`                        | KOK-173           |
| F-37 | No "envasado predeterminado" / repeat-last shortcut: the owner packs the same combination daily and must refill the form each time                                                              | product gap; `isDefault` exists but is unreachable                                   | KOK-156 + KOK-157 |
| F-44 | *"Armado"* is not the owner's word — she says *"Envasado/Pack"*, *"Envasar"* — and the surface should be its own nav section, not a link card inside Producción                                 | `i18n-assemblies.ts`, `nav-items.ts`, Doc 06 §2, Doc 07 SC-20                        | KOK-156           |
| F-45 | Sticky headers **do** work in the sessions weekly calendar — the only table with no intermediate `overflow-*` wrapper. Use it as the reference implementation, not as a counter-example         | Issue #30 §A-1                                                                       | KOK-158           |


### 3.5 Traceability discrepancy (not a defect)

Acceptance checklist point **15** ("reports that separate offerings sold from products included") is
listed in §A-1 as a **non-negotiable Block B acceptance requirement**, but the backlog assigns it to
**KOK-050 in Phase 5**. The team did not fail to build it — it was scheduled out of the block by the
backlog itself. The two documents disagree; the backlog should win, and §A-1 should say so.

---

## 4. Task list

**Legends**:

- **Size** — S ≤ half day · M ≤ 1.5 days · L ≤ 3 days (AI-assisted).
- **🧠 Required intelligence (1–5)** — 1 mechanical · 2 routine · 3 standard engineering · 4 complex
logic (money math, state machines, atomicity) · 5 design-heavy. Anything touching money arithmetic,
the kardex or derived-row regeneration is 4–5 regardless of size.
- **Status** — all new rows start 📋 To Do.

**How to use this section.** §4.1 is the whole batch at a glance, one table per priority tier. Every
P0 and P1 row has a **detail card** below it (§4.3 and §4.4) with the owner's own words, the exact
files, acceptance criteria a reviewer will check, and the rules that constrain the change. **Read the
card before starting the task** — the table row is a summary, not a spec.

**Two standing instructions for this batch:**

1. **Nothing here is a licence to touch `core/` costing.** §2 lists what is already correct. If a task
eems to require changing replay, WAC or C-10, stop and escalate — it almost certainly doesn't.
2. **Every UI task ships with a browser verification** using the `verify-ui` skill, at desktop **and**
390 px, in **both themes**. "It compiles" is not evidence; this whole revision exists because
ourteen defects survived a thorough source review.

---

### 4.1 All tasks at a glance

#### Done since the first issue


| ID      | Task                               | Area  | Size | 🧠  | Status | Description                                                                                                                                                                                               |
| ------- | ---------------------------------- | ----- | ---- | --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KOK-154 | Push Block C, restore the pipeline | infra | S    | 3   | ✅ Done | Pushed 20 local commits, green CI, `develop` → `main`, staging wiped and reseeded. Went far beyond scope: three D1 migration data-loss bugs found and fixed on the way (PRs #24–#27). Closes F-6. See §2. |


#### P0 — required before go-live on real data


| ID      | Task                                              | Area    | Size | 🧠  | Status | Description                                                                                                                                                                                                                                         |
| ------- | ------------------------------------------------- | ------- | ---- | --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KOK-172 | Rebuild `LineEditor` as one aligned grid          | web     | L    | 3   | ✅ Done | **Do first.** Header and rows share one grid so columns can't drift; row never overflows, so the remove button and cost preview stay visible; per-line unit selector (Kg/g) reused from `RecipeForm`. Closes F-41, F-34. → §4.3.1                   |
| KOK-155 | Repair the seed fixture, make it un-breakable     | full    | M    | 4   | ✅ Done | Delete `rl_pan_caja` (recipe consuming PACKAGING, double-charges the box), add the two missing presentations + *cordel*/*tarjeta*, and add a test that pushes every fixture line through the domain validators. Closes F-2, F-20. → §4.3.2          |
| KOK-156 | "Envasar" section: definitions CRUD + history     | full    | L    | 4   | ✅ Done | Block B's flagship model has no UI. Own top-level nav section, definitions CRUD with live cost preview, Envasado list/detail/edit/delete, owner's vocabulary, Doc 06/07 amended in the same PR. Closes F-3, F-25, F-44, half of F-37. → §4.3.3      |
| KOK-173 | Envasado recording form: usability pass           | web     | M    | 3   | ✅ Done | Hide the empty "Definición" selector and explain what a definition is; show the output item's unit; explicit "Stock insuficiente" text; constrain the pinned footer to the form width. Closes F-32, F-35, F-36. → §4.3.4                            |
| KOK-157 | Packaging double-deduction + `isDefault` contract | full    | M    | 4   | ✅ Done | Three layers test `isDefault=1` where they mean "is this an assembled presentation?". Use *any active definition* for correctness; enforce one default per output item as the owner's "envasado predeterminado". Closes F-4, half of F-37. → §4.3.5 |
| KOK-158 | Fix sticky table headers                          | web     | S    | 2   | ✅ Done | Nested `overflow-x-auto` wrappers become phantom scroll containers, so headers stick to nothing. Drop or bound them and move sticky onto `<th>`. The sessions calendar already works — use it as the reference. Closes F-1, F-45. → §4.3.6          |
| KOK-073 | `replacement_cost_history` log                    | backend | S    | 3   | ✅ Done | Already in the backlog (Phase 5.5) and already committed in §C as a go-live prerequisite. Must ship **before the owner's first real purchase** — the series cannot be reconstructed backwards. Closes F-5. → §4.3.7                                 |


#### P1 — close before the next owner test session


| ID      | Task                                              | Area    | Size | 🧠  | Status | Description                                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------- | ------- | ---- | --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KOK-140 | Full-page form pattern + Compra and Venta         | web     | L    | 3   | ✅ Done | **Pulled forward from Block D.** Doc 06 §3 always specified it; the owner demanded it in her own words. Own URL, state owned by the route, pinned footer with the total and "Se descontará X de la cuenta Y". Closes F-40, F-9, structurally F-43. → §4.4.1 |
| KOK-142 | Global unsaved-changes guard                      | web     | S    | 2   | ✅ Done | **Pulled forward from Block D.** One hook on the `Dialog` primitive + route-level blocking + `beforeunload`. Dirty = differs from initial, not "was touched". Closes F-7, F-43. → §4.4.2                                                                    |
| KOK-174 | Closing a session should take one click           | web     | S    | 3   | ✅ Done | Default the end time to now; derive end ↔ duration instead of forbidding both. Submit one field, so the shared schema and Doc 03 S-2 stay unchanged. Closes F-39. → §4.4.3                                                                                  |
| KOK-175 | Session drawer action row overflows               | web     | S    | 2   | ✅ Done | Badge + 4 buttons in one non-wrapping flex row clips **Eliminar** — the destructive action — in half. Wrap or use an overflow menu; audit the other detail drawers too. Closes F-38. → §4.4.4                                                               |
| KOK-176 | Pickers must only offer acceptable items          | web     | S    | 2   | ✅ Done | Purchases offer Agua and Envasado offers non-`UNIT` outputs, both rejected only at submit by rules the UI never displayed. Add kind/unit/`isUnmetered` eligibility to `ItemPicker`. Closes F-42, picker half of F-33. → §4.4.5                              |
| KOK-159 | Client-side length caps                           | web     | S    | 2   | ✅ Done | The app has exactly **one** `maxLength`. Derive it from the same `safeText(N)` bound the shared schema declares so the two cannot drift. Closes F-8. → §4.4.6                                                                                               |
| KOK-160 | Purchase total + "Se descontará X de la cuenta Y" | web     | S    | 2   | ✅ Done | delivered by KOK-140 (commit 861d027): Purchase and Sale pinned footers render the computed total and destination-account line. Closes F-9. → §4.4.7                                                                                                        |
| KOK-161 | Packaging suggestion on exits                     | full    | M    | 3   | ✅ Done | A-1 case 3: prefill packaging from the applicable **default** definition when the exit is of an unassembled product. The only surviving piece of the "suggested packaging" idea. Closes F-10. → §4.4.8                                                      |
| KOK-162 | PWA update strategy                               | web     | S    | 3   | ✅ Done | Hardcoded `CACHE_NAME` + cache-first document = white screen after any deploy. **Now real**, because staging deploys again. Keep the `/api/` exclusion exactly as it is. Closes F-11. → §4.4.9                                                              |
| KOK-163 | Harden `customOrderId` semantics before Phase 4   | shared  | S    | 4   | ✅ Done | "Omitted" currently means "clear the link". A Telegram/AI capture path omitting the field would silently unlink a delivered order's production run. Fix before Phase 4 starts. Closes F-13. → §4.4.10                                                       |
| KOK-164 | Decide KOK-135's disposition                      | backend | S    | 3   | ✅ Done | Deduplicated-hours primitive is correct, property-tested and has **zero call sites**. Either expose it with the agreed copy, or re-mark it a prerequisite and record the gap in KOK-051. Closes F-12. → §4.4.11                                             |


#### P2 — test and documentation integrity


| ID      | Task                                        | Area   | Size | 🧠  | Status   | Description                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------- | ------ | ---- | --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| KOK-165 | e2e for the three new verticals + PR gate   | web    | M    | 3   | 📋 To Do | Session start/close from the header, record an Envasado, order confirm → deliver → undo. **Run Playwright in the PR gate**, not only post-deploy — `ci.yml` runs none today. Add the two owner-confirmed regressions as specs. Closes F-14.                                                                  |
| KOK-166 | Close the service/UI test gap               | full   | M    | 3   | 📋 To Do | Route tests for `api/assemblies.ts` and `api/assembly-definitions.ts`; a test driving `assertOrderLinkable` through the production/assembly commands including the "only validate on change" path (`eaf9686`); pure-logic tests for `OrderPicker`, `WeeklyCalendar` and the assembly cost math. Closes F-14. |
| KOK-167 | Reconcile status records                    | docs   | S    | 2   | 📋 To Do | Restore KOK-132 to ✅ (flipped back by `5cdda82`); drop "implementation pending" from O-6 and S-5; regenerate Drizzle `_journal.json` for 0017–0022; correct §A-1 point 15 to KOK-050/Phase 5; record KOK-154 done with its four PRs. Closes F-15, F-16, F-23, §3.5.                                          |
| KOK-168 | Make `dates.ts` genuinely the single source | shared | S    | 3   | 📋 To Do | `finance.ts`, `sessions.ts`, `counts.ts` and `inventory-views.ts` redeclare the date schemas **without** the future-date refinement, contradicting the docstring. Import it, decide per module whether future dates are legitimate, and add a per-vertical regression test. Closes F-17.                     |


#### P3 — polish (one PR each)


| ID      | Task                                     | Area | Size | 🧠  | Status   | Description                                                                                                                                                                                                                                                                                                                                              |
| ------- | ---------------------------------------- | ---- | ---- | --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KOK-169 | Copy and consistency batch               | full | M    | 2   | 📋 To Do | Impact-dialog copy conditioned on the real case (F-18); Agua fixture comments if KOK-155 hasn't (F-20); sorting-scope copy (F-21); `"u. de "` into i18n if KOK-173 hasn't (F-24); "…en negativo" (F-26); `WAC_ENTRY_TYPES` exhaustiveness test (F-27); padded maskable icon + PNG favicon (F-28); `addMoney` in `sessions/index.ts:409-410` (F-29, D-5). |
| KOK-170 | `window.confirm` → app `Dialog`          | web  | S    | 2   | 📋 To Do | Three native pop-ups in `OrderDetailDrawer.tsx:202,214,235,260` while every other order dialog uses the app primitive. Spec-compliant today, but inconsistent and untestable. Closes F-19.                                                                                                                                                               |
| KOK-171 | Two product calls to make with the owner | —    | S    | 1   | 📋 To Do | **Not defects.** Offline notice as toast vs dialog (F-22 — A-9 says dialog); and whether **Sesiones** should replace one of the four primary mobile tabs in a session-first phone app (F-30). Put both on the next test session's agenda rather than deciding them in code review.                                                                       |


---

### 4.2 Suggested sequencing

Dependencies matter more than the priorities here, and one ordering dominates:


| Wave  | Tasks                                                                                  | Why this order                                                                                                                                       |
| ----- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **KOK-172** first, then **KOK-155**, **KOK-158**, **KOK-073**, **KOK-157** in parallel | KOK-172 is the shared body of every capture form — everything downstream builds on it. The other four touch disjoint files and can run concurrently. |
| **2** | **KOK-156** → **KOK-173**; **KOK-140** → **KOK-142** in parallel                       | The Envasar lane and the form-pattern lane are independent of each other, but strictly ordered inside themselves.                                    |
| **3** | Remaining P1 (KOK-174, 175, 176, 159, 160, 161, 162, 163, 164)                         | All small, all independent; assign freely.                                                                                                           |
| **4** | P2, then P3                                                                            | Test/doc integrity, then polish.                                                                                                                     |


**Three traps worth naming before anyone picks up a task:**

- **KOK-173 before KOK-156 is wasted work.** Polishing a form whose central field can never be
populated just moves the confusion around.
- **KOK-161 before KOK-157 builds on sand.** "The applicable definition" is not well-defined until
KOK-157 settles what `isDefault` means.
- **KOK-140 is where scope creep will happen.** It is the pattern plus **two** forms. Producción,
Envasado, Pedido and Conteo are **KOK-141**, deliberately a separate task. Resist merging them.

---

### 4.3 P0 — detail cards

#### 4.3.1 · KOK-172 · Rebuild `LineEditor` as a single aligned grid

**Area** web · **Size** L · **🧠** 3 · **Closes** F-41, F-34 · **Depends on** — · **Blocks** KOK-140, KOK-173

**Why.** This one component is the shared body of every capture form the owner uses daily — purchases,
sales, recipes, production, Envasado, exits. Its layout is why she cannot see the remove button
(*"puedo agregar líneas… pero no eliminarlos… eso es un horror!"*), why the column titles sit over the
wrong columns, why the unit-cost-vs-replacement-cost preview is off-screen, and why she cannot tell
whether the app wants kilograms or grams. Fixing it once fixes the same complaint in six places, and
every later form task builds on the result.

**What to build.**

1. **Replace the parallel-flex-rows layout with one grid definition.** Header (`:92-100`) and each row
`:103-168`) currently declare their widths independently, so any cell with an intrinsic minimum
ider than its nominal width desynchronizes them permanently. Define the column template **once**
nd apply it to both, so alignment cannot drift. `StepCount.tsx:252`'s `COUNT_GRID_COLUMNS`
onstant is the in-repo precedent for this and should be followed.
2. **Guarantee the row never overflows its container.** Give the item cell a real `min-w-0` and let the
ombobox truncate rather than push; the remove control and the `renderExtraColumns` slot must remain
isible at every breakpoint down to 390 px without horizontal scrolling. If the desktop layout
enuinely cannot hold every column, the mobile stacked layout is the correct fallback — not a
crollbar.
3. **Make removal obvious.** The ghost icon-only `<Button>` at `:158-167` survives, but it must be
isible, hit-target-sized (≥44 px) and reachable by keyboard, with its `aria-label` unchanged.
4. **Promote the per-line unit selector to a first-class prop.** KOK-101 already built the compatible-unit
elector with magnitude-based defaults; `RecipeForm` wires it through `onItemChange`
`LineEditor.tsx:55`). Lift that into an opt-in `unitSelector` capability on `LineEditor` and adopt
t in `PurchaseForm` and the Envasado form. Where a caller opts out, still **display** the item's
anonical unit next to the quantity input — never leave the unit unstated.

**Acceptance.**

- At 1280 px and 390 px, in both themes, with an item whose name is 60 characters: header labels sit
over their own columns; no horizontal scrollbar; remove button and extra-columns slot fully visible.
- Purchases: selecting Harina lets the owner enter `500 g` **or** `0,5 kg`, and both persist as the same
canonical milli-unit value.
- Envasado: each component line shows the component's unit.
- Removing the second of three lines leaves lines 1 and 3 with their values intact (index-as-key is
currently safe only because rows are never reordered — keep that invariant or key properly).
- Pure-logic unit tests for the unit-conversion prop; a `verify-ui` pass attached to the PR.

**Files.** `apps/web/src/components/line-editor/LineEditor.tsx` ·
`components/purchases/PurchaseForm.tsx:394-408` · `routes/assemblies.tsx:434-449` ·
`components/recipes/RecipeForm.tsx` (source of the selector) · `components/onboarding/StepCount.tsx:250-255`
(grid precedent).

**Rules.** D-5 (no float math on money/qty — conversion goes through `qty.ts`), D-9, D-10 (no
layout/table dependency), zero new lint suppressions.

---

#### 4.3.2 · KOK-155 · Repair the seed fixture and make it un-breakable

**Area** full · **Size** M · **🧠** 4 · **Closes** F-2, F-20 · **Depends on** —

**Why.** `seed-fixtures.sql:48` encodes the superseded KOK-100 model — a production recipe consuming a
`PACKAGING` item — which the domain's own `validateRecipeItemKinds` rejects. It exists only because raw
SQL bypasses the service layer. Because the Desayuno Kokoro definition also consumes `item_cajas`
(`:72`), **the demo data charges the box twice**: the exact defect ADR-018 was written to eliminate.
Urgency increased since 2026-08-14: staging was reseeded from this file on 2026-08-14, so staging's
combo cost and its Precios y márgenes row are **wrong right now**.

**What to build.**

1. Delete `rl_pan_caja`.
2. Add **"Pan de masa madre 500 g"** and **"Ghee 200 g"** as `FINISHED` / `UNIT` presentations with
heir own assembly definitions, so Desayuno Kokoro consumes **presentations**, not bulk product —
estoring the two-level structure the worked example depends on.
3. Add the missing *cordel* and *tarjeta* `PACKAGING` items.
4. Mark one definition per output item as `isDefault` (see KOK-157) so the fixture also exercises the
efault path.
5. **Add a fixture-validation test** that loads the fixture and pushes every recipe line and every
efinition line through the domain's own kind validators (`validateRecipeItemKinds`,
validateAssemblyItemKinds`). This is the actual deliverable: raw SQL must never again be able to
ncode a rule the services forbid.
6. Fix the misleading Agua comments (F-20): the data says `231` = Bs 0,00231/L and is correct; the
omment says Bs 0.005/L and invites someone to "fix" the right number into a wrong one.

**Acceptance.** Loading the fixture and running the agreements' worked example end to end reproduces
**Bs 13,00/u, Bs 18,00/u, Bs 5,70/u and Bs 40,70/u**. The validation test fails if `rl_pan_caja` is
reintroduced. `pnpm run db:reset:dev` and `db:reset:staging` both succeed, and staging is reseeded as
part of this task.

**Files.** `apps/worker/src/db/seed-fixtures.sql` · a new `apps/worker/test/fixtures.test.ts` ·
`core/recipes/recipes.ts:55-64` · `core/assemblies/assembly-definitions.ts:32-70`.

**Rules.** D-1, D-2 (the point of the test), D-6 if any rule text needs clarifying.

---

#### 4.3.3 · KOK-156 · "Envasar": its own section, definitions CRUD, and event history

**Area** full · **Size** L · **🧠** 4 · **Closes** F-3, F-25, F-44, half of F-37 · **Depends on** KOK-172 · **Blocks** KOK-173

**Why.** Block B's flagship model has no management UI. The backend is complete —
`api/assembly-definitions.ts`, `api/assemblies.ts`, full update/delete/restore in
`core/assembly-events` — and none of it is reachable. The owner, Issue #30 §A-2: *"No list of
assemblies (in Spanish it would be better to call them 'Envasado/Pack'). The button 'Registrar
Armado' is hidden on Producción. It would be great to separate all of it to a new page 'Envasar',
separate from 'Producción'."*

That last sentence is a **product decision worth taking**, not a preference to note. Packing is a
distinct daily activity from producing: different rhythm, different inputs, and — per C-10 — different
cost treatment (assemblies absorb **no** allocated session cost). Burying it inside Producción as an
unlabelled link card is why she could not find it.

**What to build.**

1. **A top-level "Envasar" nav section** with its own route, added to `AppPath`, `primaryNav`, and the
obile "Más" sheet. Landing page lists recorded Envasados (date, output, qty, unit cost, session)
ith the standard `EventTable` filters, plus a primary "Registrar envasado" action and a secondary
ntry into definitions.
2. **Definitions CRUD**: list, create, edit, activate/deactivate (never hard-delete — Doc 03 treats
efinitions exactly like recipes), with the **live component-cost preview the backend already
eturns**. Enforce the cycle prohibition message the service already produces rather than
e-implementing the check client-side.
3. **Event history**: detail view, edit, delete and restore, wired to the existing endpoints, with the
ImpactConfirmDialog`/`useReplayConfirmableMutation `pattern for replay-affecting edits — same as ProductionRunForm`.
4. **Terminology.** Adopt the owner's vocabulary in the UI: the section is **Envasar**, the record is
n **Envasado**, the template is a **Definición de envasado**. Keep `Assembly` / `AssemblyDefinition`
s the code and KB identifiers (D-9: Spanish in `i18n/`, English in identifiers) — this is a
i18n-assemblies.ts`+`i18n-nav.ts` change, **not** a rename of tables, services or KB entities.
5. **KB amendment in the same PR** (D-1/D-6): Doc 06 §2's nav tree and Doc 07 SC-20's route/placement
urrently put this under `/production`. Update both to the new section, and record the reason
owner's Phase 3.2 test, Issue #30). Do not silently diverge from the KB — amend it.

**Acceptance.** From a cold start with an empty database, the owner can: find Envasar in the nav
without being told the URL; create a "Kéfir natural 500 ml" presentation and a combo; see their
component costs before saving; record an Envasado against them; find that Envasado in a list the next
day; open, edit and delete it. `AppPath` contains every new route. No hardcoded Spanish outside
`i18n/` (this also closes F-24's neighbourhood).

**Files.** new `apps/web/src/routes/packing*.tsx` (or `assemblies.tsx` split) ·
`features/assembly-definitions/api.ts` (currently read-only) · `features/assemblies/api.ts` ·
`components/layout/nav-items.ts:25-46,68-101` · `lib/i18n-assemblies.ts`, `lib/i18n-nav.ts` ·
`docs/system-design-knowledge-base/06-ux-ui-specification.md` §2 ·
`07-screen-catalog.md` SC-20.

**Rules.** D-1, D-4 (the same shared schemas the API route uses), D-6, D-8, D-9.

---

#### 4.3.4 · KOK-173 · Envasado recording form: usability pass

**Area** web · **Size** M · **🧠** 3 · **Closes** F-32, F-35, F-36; completes F-33 · **Depends on** KOK-172, KOK-156

**Why.** Owner, Issue #30 §A-3: *"El formulario de registro de Armado es un desastre."* The costing
behind it is correct (§2) and the stock logic exists — the presentation defeats both. Four distinct
defects, all cheap:

**What to build.**

1. **The "Definición" field.** Hide the `<select>` entirely when there are no active definitions
`routes/assemblies.tsx:340-352`), and in its place show a one-line explanation with a link to
reate one: a definition is a **reusable template** ("Pan integral + bolsa + etiqueta + cordel")
hat pre-fills this form. When definitions do exist, replace the placeholder *"Sin definición
entrada manual)"* (`i18n-assemblies.ts:6`) with wording that describes the owner's choice, not the
mplementation branch — e.g. *"Sin plantilla — cargar componentes a mano"* — and add an
InfoTooltip` (the KOK-108 primitive) explaining the field.
2. **Output-item unit, visibly.** Show the selected item's unit next to it, and next to the "Salida
eal" input replace the hardcoded `"u. de {name}"` (`:416`, also F-24) with an i18n string. Pair with
OK-176's picker filter so an ineligible item can no longer be chosen at all. The error at
core/assemblies/assembly-definitions.ts:44` must become unreachable through the UI.
3. **Line presentation** (F-35). Drop the repeated `"Aporte al costo:"` prefix now that the column has
eader (KOK-172 guarantees the header aligns), and render insufficient stock as **explicit text**
"Stock insuficiente"* — not an icon with a `title` attribute. Keep the ✓ / neutral-dash states
nd keep the unmetered branch exactly as it is; the logic at `:163-200` is correct.
4. **Footer** (F-36). `PinnedSummaryFooter` is full-bleed while the form body is `max-w-3xl` centred,
o the footer reads as a wider, disconnected block and steals vertical space. Constrain its inner
ontent to the same `max-w-3xl` container and tighten its vertical rhythm. **Check every other
onsumer** of `PinnedSummaryFooter` in the same pass — this is a shared component and the same
ismatch will appear wherever the body is width-constrained.

**Acceptance.** On an empty database the form explains what a definition is instead of offering an
empty dropdown. With definitions present, choosing one pre-fills components and output. The output
item's unit is visible before submitting. A component with insufficient stock shows readable text on a
touch device. Footer and form share one width and the form body has visibly more room than today.
`verify-ui` pass at both breakpoints and both themes.

**Files.** `apps/web/src/routes/assemblies.tsx:336-372, 403-418, 163-200, 467+` ·
`lib/i18n-assemblies.ts` · `components/common/PinnedSummaryFooter.tsx:21-34` and its other consumers.

**Rules.** D-9, zero new suppressions.

---

#### 4.3.5 · KOK-157 · Close the packaging double-deduction hole and settle the `isDefault` contract

**Area** full · **Size** M · **🧠** 4 · **Closes** F-4, half of F-37 · **Depends on** — · **Blocks** KOK-161

**Why.** Three places decide "is this item an assembled presentation?" by looking **only** for an
`isDefault = 1` active definition — `core/inventory/exits.ts:115-134`, `ExitForm.tsx:149`, and
`replacement-cost-refresh.ts:86,113,165-175`. But `isDefault` is `z.boolean().default(false)`
(`packages/shared/src/assembly-definitions.ts:32`) and **nothing requires one default per output
item**. An item whose only definition is non-default is a real presentation whose WAC already contains
its packaging — yet all three layers treat it as unassembled: exits let packaging be deducted a second
time (violating A-1), and its composite replacement cost and C-5 price-health alert never activate.

**The recommendation** — because the first issue of this review left it open, and the owner's F-37
request now settles it. Do **both**, because they are different questions:

- **For correctness**, test `EXISTS(any active definition for this output item)`. Whether one of them
is the default is irrelevant to "has this item's WAC already absorbed packaging?".
- **For UX**, keep `isDefault` and *enforce* it: at most one default per output item, enforced at write
time in `core/assemblies`. It becomes the "envasado predeterminado" the owner asked for — the
definition that pre-selects itself in the recording form (KOK-173) and prefills exit packaging
suggestions (KOK-161).

**What to build.** The three call-site changes; the write-time uniqueness rule (set-default is a
service command that clears the previous default in the **same batch**, D-3); a regression test for an
item whose only active definition is non-default, asserting the exit guard fires and the replacement-cost
refresh includes it; a KB note in Doc 03's AssemblyDefinition row recording the `isDefault` contract
(D-6).

**Acceptance.** Item with one active non-default definition: exit form hides packaging lines, service
rejects them, `planReplacementCostRefresh` includes the item. Creating a second default for the same
output item demotes the first, atomically. Existing tests stay green.

**Files.** `core/inventory/exits.ts:115-134` · `core/costing/replacement-cost-refresh.ts:86,113,165-175`
· `core/assemblies/assembly-definitions.ts` · `apps/web/src/components/inventory/ExitForm.tsx:148-150`
· `packages/shared/src/assembly-definitions.ts:32` · `docs/…/03-domain-model.md:51`.

**Rules.** D-1, D-2, D-3, D-6.

---

#### 4.3.6 · KOK-158 · Fix sticky table headers

**Area** web · **Size** S · **🧠** 2 · **Closes** F-1, F-45 · **Depends on** —

**Why.** The owner asked for this explicitly (issue #23), and confirmed in Issue #30 §A-1 that it still
does not work in Catálogo de Ítems — while noting it **does** work in the sessions weekly calendar.
That contrast is the fix: the calendar has no intermediate `overflow-*` wrapper, so its sticky resolves
against `AppShell.tsx:36`'s real scrolling `<main>`. Everywhere else, a wrapper with `overflow-x: auto`
and `overflow-y` unset computes `overflow-y: auto`, becoming a content-height scroll container that
never scrolls — so the header sticks to nothing.

**What to build.** For each of `EventTable.tsx:111-114`, `StepCatalog.tsx:347` and `StepCount.tsx:252`:
either remove the wrapper's `overflow` (relying on the page scroller) or give it a genuinely bounded
height so it becomes a real scroll container. **Additionally**, move the sticky from the `<tr>` to the
`<th>` cells — sticky on a row of a `border-collapse` table is historically unreliable in Chromium.
Use the weekly calendar as the reference implementation.

**Acceptance.** In Chromium and WebKit, at 1280 px and 390 px, in both themes: scrolling Inventario,
Ventas and onboarding *Catálogo inicial* with enough rows to overflow keeps the column titles visible.
Horizontal scrolling still works where a table genuinely needs it. `verify-ui` screenshots attached.

**Files.** `apps/web/src/components/data-table/EventTable.tsx` ·
`components/onboarding/StepCatalog.tsx` · `components/onboarding/StepCount.tsx` ·
`components/layout/AppShell.tsx:36` (context) · `components/sessions/WeeklyCalendar.tsx` (reference).

---

#### 4.3.7 · KOK-073 · `replacement_cost_history`

**Area** backend · **Size** S · **🧠** 3 · **Closes** F-5 · **Depends on** —

**Why.** Already in the backlog (Phase 5.5) and already committed in §C of the agreements as a
**go-live prerequisite**: it must exist **before the owner's first real purchase**, because the series
cannot be reconstructed backwards. Zero code exists (`grep` re-checked at `45a04ea`). Every week live
without it is a week of cost-erosion history lost permanently — and cost erosion under Bolivian
inflation is one of the three reasons this system exists at all (Doc 01 G2).

**What to build.** Pull the existing backlog row forward unchanged: append-only history row on every
`replacement_cost_mc` write, with its migration and its Doc 04 update in the same commit (D-6).

**Acceptance.** Every service path that writes a replacement cost appends exactly one history row in
the **same batch** (D-3). Recording two purchases of the same item on different dates yields two rows
with correct timestamps. Migration applies cleanly on a **non-empty** staging database (see §2 — test
this, do not assume).

---

### 4.4 P1 — detail cards

#### 4.4.1 · KOK-140 · Full-page form pattern + Compra and Venta — pulled forward from Block D

**Area** web · **Size** L · **🧠** 3 · **Closes** F-40, F-9, structurally F-43 · **Depends on** KOK-172 · **Blocks** KOK-141

**Why.** This is the highest-leverage task in the whole list. Doc 06 §3, Doc 07 §8 and agreements §A-12
all specify it; it was scheduled into Block D behind less valuable work; and the owner independently
demanded it — *"Mejor hacerla una pantalla separada"* — after describing the purchase modal as *"un
desastre"* and *"un horror"*. It closes, structurally rather than by patching: the lost-work complaint
(F-43), the cramped layout that produced F-41's symptoms, and the never-built purchase total (F-9).

**Scope note (unchanged from the backlog row).** Read-only detail drawers stay drawers. Small dialogs —
cobrar, transferir, retirar, iniciar sesión, confirmations — stay dialogs. Only line-bearing forms move.

**What to build.**

1. **The pattern**: own route and URL (shareable, real browser back), form state owned by the route so
t survives incidental unmounts, `PinnedSummaryFooter` (total, affected account, warnings) — with
OK-173's width fix applied — and the unsaved-changes guard from KOK-142.
2. **Migrate Compra**, and with it deliver the agreed **"Se descontará X de la cuenta Y"** line
F-9 / KOK-160) in the pinned footer, alongside the computed total.
3. **Migrate Venta.**
4. Keep KOK-172's `LineEditor` as the line body — do not fork it.

**Acceptance.** `/purchases/new` and `/sales/new` (and their edit routes) are real URLs with working
browser back. Filling half a purchase, navigating away and returning via back does not lose the work,
and leaving with unsaved changes prompts. The footer shows the running total and the destination
account line without scrolling, at 390 px. `verify-ui` pass on both forms, both themes.

**Files.** `components/purchases/PurchaseForm.tsx:306-427` · `components/sales/SaleForm.tsx` ·
`routes/purchases.tsx:42`, `routes/sales.tsx` · `components/common/PinnedSummaryFooter.tsx` ·
`components/layout/nav-items.ts` (`AppPath`) · `components/sessions/SessionDetailDrawer.tsx:373`
(a purchase can also be launched from the session drawer — that entry point must navigate, not open a
dialog).

**Rules.** D-4 (same shared schema on route, form and future AI tool), D-9.

> **KOK-141** (Producción, Envasado, Pedido, Conteo onto the same pattern, plus cancel-draft-count)
> stays in Block D and follows this task. Its backlog row's premise is now correct: KOK-153 shipped the
> Envasado page, and KOK-140 will have established the pattern.

---

#### 4.4.2 · KOK-142 · Global unsaved-changes guard — pulled forward from Block D

**Area** web · **Size** S · **🧠** 2 · **Closes** F-7, F-43 · **Depends on** KOK-140 (for the route-level half)

**Why.** An explicit written agreement (§A-12) that addresses a loss the owner personally hit and
reported twice — Crear sesión in the first test, Compra and Nueva venta in this one. Nothing exists:
no `beforeunload`, no discard confirmation, no dirty-state hook anywhere in `apps/web/src`.

**What to build.** One shared hook, applied to (a) the `Dialog` primitive, so every dialog inherits it,
and (b) route-level navigation blocking for the full-page forms KOK-140 introduces, plus a
`beforeunload` handler for tab close/reload. Dirty state is "differs from the initial values", not
"was touched" — re-typing the original value must not trigger the prompt. Copy in `i18n/es.ts`, warm
and short (D-9).

**Acceptance.** Typing into Crear sesión and clicking the overlay prompts before discarding. The same
for Compra and Nueva venta. Closing a **pristine** dialog does not prompt. Reloading the tab with a
dirty form prompts. Confirmations, cobrar/transferir/retirar and read-only drawers are unaffected.

**Do not break what already works.** The close-session form and the count form both preserve state
across a drawer close today, and the owner explicitly said so (Issue #30 §A-4). Do not "fix" them into
prompting on every close; the count form persists on blur by design (see KOK-141's backlog note).

---

#### 4.4.3 · KOK-174 · Closing a session should take one click

**Area** web · **Size** S · **🧠** 3 · **Closes** F-39 · **Depends on** —

**Why.** Owner, Issue #30 §A-4: *"la fecha y hora Fin debería ser lo actual por defecto… cosa de que
lo único que tenga que hacer es darle al botón cerrar. Y si pongo manualmente una duración en minutos,
la fecha y hora fin debería calcularse automáticamente."* Today `SessionForm.tsx:398` *disables* the
end field once a duration is typed, and the schema rejects both together with *"Indica la hora de fin
o la duración, no ambas."* — so the app expresses "one or the other" in the least helpful way
available, and closing a session she just finished requires her to type a timestamp.

**What to build.**

1. **Default `endedAt` to now** when the close form opens (La Paz time, via the existing
Intl.DateTimeFormat`/`America/La_Paz` helpers — do **not** hand-roll a timezone), editable.
2. **Derive, don't forbid.** Typing a duration recomputes the end instant from `startedAt`; editing the
nd recomputes the duration. Both stay visible and consistent. Stop disabling the end field.
3. **Submit exactly one field.** Send `endedAt` only. This satisfies
packages/shared/src/sessions.ts:96-102` **unchanged** and Doc 03 S-2 unchanged — the exclusivity is
ommand rule, not a display rule. **No schema change, no KB amendment.** If implementation
uggests otherwise, stop and escalate rather than relaxing the refinement.
4. Keep the "end must be after start" error and surface it live rather than on submit.

**Acceptance.** Opening the close form on an open session and pressing "Cerrar" immediately closes it
with an end time of now. Typing `90` in duration sets the end to start + 90 min. Editing the end back
sets the duration accordingly. The "no ambas" error becomes unreachable through this form. The
existing `SessionForm.test.ts` cases stay green and gain coverage for the derivation.

**Files.** `apps/web/src/components/sessions/SessionForm.tsx:145,226-231,390-420` ·
`components/sessions/SessionDetailDrawer.tsx:214+` (close form host) · `lib/i18n-sessions.ts:120-123` ·
`packages/shared/src/dates.ts` (timezone helpers — reuse, don't reimplement).

---

#### 4.4.4 · KOK-175 · Session drawer action row overflows and clips "Eliminar"

**Area** web · **Size** S · **🧠** 2 · **Closes** F-38 · **Depends on** —

**Why.** Owner: *"la lista de botones es tan ancha que el botón eliminar queda a medias."*
`SessionDetailDrawer.tsx:169-210` puts a `<Badge>` plus up to four buttons in one
`flex items-center gap-2`, no wrap, no overflow handling, inside a `justify-between`. An OPEN
`PRODUCTION` session hits the worst case — and the clipped control is the **destructive** one, which
is the worst possible thing to render half-visible.

**What to build.** Rework the row so every action is fully visible at 390 px: wrap to a second line,
or move secondary actions (Editar, Eliminar) into an overflow menu and keep the contextual primary
actions (Registrar…, Cerrar) inline. Prefer the overflow menu if one already exists in the codebase —
check `SessionChip`'s action menu (KOK-132) before building a new primitive. **Audit the other detail
drawers in the same pass** (`ExitDetailDrawer`, `PurchaseDetailDrawer`, `OrderDetailDrawer`): the same
pattern is likely to overflow with a similar number of actions.

**Acceptance.** OPEN PRODUCTION session at 390 px: every action fully visible and tappable, destructive
action clearly distinguished and never truncated. Keyboard order preserved.

---

#### 4.4.5 · KOK-176 · Item pickers must only offer items the service will accept

**Area** web (+ small shared helper) · **Size** S · **🧠** 2 · **Closes** F-42, picker half of F-33 · **Depends on** —

**Why.** Two of the owner's complaints are the same bug in two places: the app offers a choice, lets
her do the work, and rejects it at submit with an error naming a property it never displayed.

- **Purchases and unmetered items.** She quotes our KB back at us: *"dijimos que marcar una materia
prima como 'No medible' significa que nunca lo voy a comprar realmente."* Doc 03 C-9
(`03-domain-model.md:187`) says exactly that, and `core/purchasing/index.ts:195` enforces it — but
`ItemPicker` has no `isUnmetered` filter (`ItemPicker.tsx:24-67`), so Agua is offered on every
purchase line.
- **Envasado output item.** Doc 03 requires FINISHED **and** unit `UNIT`; `routes/assemblies.tsx:367`
filters on kind only.

**What to build.** Extend `ItemPicker` with an eligibility filter that can express both — kind, unit,
and `isUnmetered` — and apply it: purchases and stock exits exclude unmetered items (Doc 03 C-9 forbids
both `PURCHASE_IN` and StockExit against them, `:187,190`); Envasado's output picker requires
`FINISHED` + `UNIT`. Where filtering would leave the list empty, say why in a short empty-state message
rather than showing a blank list. **Do not remove the server-side guards** — the picker is a UX layer;
the service remains the enforcement point (D-2).

**Acceptance.** Agua cannot be selected on a purchase line or a stock exit. A `FINISHED`/`KG` item
cannot be selected as an Envasado output. `core/purchasing/index.ts:195` and
`core/assemblies/assembly-definitions.ts:44` keep their tests and stay reachable via the API. Empty
filtered lists explain themselves.

**Files.** `apps/web/src/components/catalog/ItemPicker.tsx:24-67,138-141` ·
`components/purchases/PurchaseForm.tsx` · `components/inventory/ExitForm.tsx` ·
`routes/assemblies.tsx:364-370` · `docs/…/03-domain-model.md:187,190` (rule source, no change expected).

---

#### 4.4.6 · KOK-159 · Client-side length caps

**Area** web · **Size** S · **🧠** 2 · **Closes** F-8 · **Depends on** —

**Why.** The whole web app contains exactly **one** `maxLength` (`ItemForm.tsx:292`, item name). Every
other free-text field backed by a `safeText`-capped schema has none, so the owner types freely and is
rejected on submit instead of being stopped at the cap. The server half is solid — this is a UX miss,
not a data-integrity one.

**What to build.** Export the bound alongside each `safeText(N)` schema and derive `maxLength` from it,
so the two cannot drift. Apply to customer name/phone/notes, purchase notes, sale/production/session/
exit/order notes, order description, shared-cost label and alias.

**Acceptance.** No literal cap numbers in the UI; changing a schema bound propagates without a UI edit;
a test asserts each capped field's `maxLength` equals its schema bound.

**Rules.** D-4.

---

#### 4.4.7 · KOK-160 · Purchase total + "Se descontará X de la cuenta Y"

**Area** web · **Size** S · **🧠** 2 · **Closes** F-9 · **Depends on** — (absorbed by KOK-140 if that lands first)

**Why.** Listed in §B of the agreements (`acuerdos:579`) as verified and agreed; `grep -r "Se descontará" apps/web/src` returns **zero matches**; `PurchaseForm.tsx` was never touched in Block A and
no KOK id was ever created for it. It vanished between the agreement and the backlog.

**What to build.** The computed purchase total and the destination line in `PinnedSummaryFooter`.

**Disposition.** delivered by KOK-140 (commit 861d027): both the PurchaseForm and SaleForm pinned footers render the computed total and destination-account line.

**Process note.** If KOK-140 lands first, deliver this inside it and **close this row explicitly as
"delivered by KOK-140"** rather than dropping it. The silent drop is what produced this finding.

---

#### 4.4.8 · KOK-161 · Packaging suggestion on exits of unassembled product

**Area** full · **Size** M · **🧠** 3 · **Closes** F-10 · **Depends on** KOK-157

**Why.** A-1 case 3 requires: *"suggest packaging only when the exit is of an unassembled product and
an applicable definition exists."* `ExitForm.tsx:314-339` implements only the show/hide gate plus an
empty `LineEditor` — it never looks up a definition. This is the **only surviving piece** of the
"suggested packaging" idea after A-5 dropped the rest, so dropping it removes the feature entirely.

**What to build.** Prefill packaging lines from the applicable **default** active definition (KOK-157
makes "default" well-defined), keep manual edits, keep "default to none" when nothing applies.

---

#### 4.4.9 · KOK-162 · PWA update strategy

**Area** web · **Size** S · **🧠** 3 · **Closes** F-11 (and part of F-28) · **Depends on** —

**Why.** `sw.js:1` hardcodes `CACHE_NAME = "kokoro-static-v1"`, never build-templated; the document
handler (`:44-65`) is cache-first; `main.tsx:30-32` registers once with no `registration.update()`.
Vite emits content-hashed bundles, so after a deploy a returning user's cached `index.html` references
bundles that no longer exist — a white screen fixable only by a hard refresh she won't know to perform.
**Now urgent:** staging deploys again, so the first deploy after she installs the PWA is the one that
breaks her shell.

**What to build.** Build-templated or hash-derived `CACHE_NAME`; network-first (or
stale-while-revalidate with an update prompt) for the document; a "nueva versión disponible"
affordance driven by `registration.update()`.

**Do not change** the `/api/` and `/telegram/` cache exclusions (`sw.js:4-16`) — they are why there is
no stale-financial-data risk.

---

#### 4.4.10 · KOK-163 · Harden `customOrderId` semantics before Phase 4

**Area** shared · **Size** S · **🧠** 4 · **Closes** F-13 · **Depends on** —

**Why.** The field is `z.string().min(1).optional()` (not `.nullish()`) in `production-runs.ts:68,133`
and `assembly-events.ts:20,53`, and the builder does `customOrderId: command.customOrderId ?? null`
(`production/index.ts:972`, `assemblies.ts:621`). It works today **only** because `ProductionRunForm`
re-seeds and resubmits the existing value on every edit. Any caller that omits the field meaning "leave
unchanged" — exactly what a Telegram/AI capture path would naturally do — silently unlinks a delivered
order's production run, with nothing thrown and no type error.

**What to build.** Make "omitted" and "explicitly cleared" distinguishable (`.nullish()` plus an
explicit clear, or a patch-shaped update command), and add a test proving an update that **omits** the
field does not unlink.

**Timing.** Do this **before Phase 4 starts**, not during it.

---

#### 4.4.11 · KOK-164 · Decide KOK-135's disposition

**Area** backend · **Size** S · **🧠** 3 · **Closes** F-12 · **Depends on** —

**Why.** `getDeduplicatedSessionHours` / `unionIntervalMinutes` (`sessions/index.ts:1014-1119`) are
correct, property-tested and have **zero call sites** — no API route, no UI. KOK-135's own description
says *"Surface both figures when they differ, with copy explaining why."*

**What to build — either is acceptable, leaving it as-is is not.** Expose the figure through an
endpoint and surface both numbers with the agreed explanatory copy; **or** re-mark KOK-135 as a
prerequisite and record in **KOK-051** that the UI half is unbuilt, so that task does not assume
otherwise.

---

## 5. Process observations

These caused more of the findings above than any individual coding mistake. Two have been answered
since the first issue; the rest stand.

1. **Work is being marked Done without the "Done" definition being met.** Definition-of-Done item 5
deployed to staging, smoke-tested) had not been met by any of the three blocks, yet 30+ tasks were
. **Partially answered:** KOK-154 restored the pipeline, so item 5 is achievable again — but it
as 30 tasks' worth of "Done" claimed before it was. Honour it or amend it.
2. `**full`-area tasks are shipping backend-only.** KOK-123 and KOK-124 are both `full` and both Done,
et the management UI for either never existed — KOK-153 was created mid-Block-C to notice the
recording* form was missing, and the definitions UI still hasn't been built. **Suggested guard,
ow with evidence behind it: a `full` task is not Done until a named screen is reachable from the
avigation by someone who was not told the URL.** The owner could not find `/production/assemblies/new`.
3. **The agreements doc and the backlog have drifted.** One §B item was lost entirely (F-9), one
hecklist point is scheduled two phases away (§3.5), and a status commit regressed the row it was
eant to update (F-15). One reconciliation pass (KOK-167), then treat §B as a checklist with ids.
4. **Long-lived local work is a real risk.** ✅ **Answered, expensively and instructively.** Twenty
npushed commits containing a full block of domain changes lived on one machine; pushing them
evealed three migration bugs that would have silently destroyed data on any non-empty database.
*Push per task, not per block** — and note that from-scratch migration tests are not sufficient
vidence. Any migration that rebuilds a table must be tested against a **populated** database.
5. **Self-reports are optimistic in a specific, predictable way:** they accurately describe what was
built* and under-report what was *not reached*. Ask each block report to state explicitly what it
id **not** verify.
6. **New: source review cannot substitute for the owner using the app.** Every finding in §3.2 that
he owner confirmed had already been predicted here — but F-33, F-38, F-39 and F-41 were invisible
o source reading, and F-41 in particular (a working delete button she cannot see) is the kind of
efect that only a real user finds. Sixty minutes of her time produced fourteen findings.
*Schedule the owner-led pass as a standing gate at the end of every block, not as a one-off.**
7. **New: we specified the fix before we built the problem.** Doc 06 §3 has said "full page with a
inned summary footer" since before any of these forms were written, and they were all built as
ialogs anyway, with the correction scheduled into a later block. The owner then asked for it in
er own words. When the KB already answers a design question, building the other thing first is not
hortcut — it is the same work, done twice.

---

## 6. Manual UI verification — remaining plan

**Section A is complete** (owner, 2026-08-16, Issue #30) and its results are folded into §3. Sections
B and C have **not** been run and should be, before the next block is planned — Section A's yield
argues strongly that they will find things this review cannot.

Test on **desktop and at ~390 px**, and in **both themes**.

### B. Flows never exercised by any pass

1. **Orders lifecycle.** Create → confirm (check the single *Método de pago + Cuenta* selector and that
he payment date is editable) → En producción → back to Confirmado → Listo **with no linked
roduction** (expect a warning you must confirm) → Entregar → **Deshacer entrega**. Note which
onfirmations are plain browser pop-ups versus proper in-app dialogs (F-19), and whether undoing a
elivery that was **already collected** is refused with a clear message.
2. **Production form.** Check: the order picker appears and offers orders in every status except  
ntregado/Cancelado; the per-ingredient stock indicator shows ✓ / ! and a neutral "No medido" for  
gua; actual output prefills from the recipe and **recomputes when you change batches — but does not**  
**rewrite a number you typed yourself**. **This is F-31 — try it in *edit* mode specifically, on a saved production run.** It is the last finding still unconfirmed; ticket it only if reproduced.
3. **Validation behaviour.** On *Crear ítem* and *Nueva venta*: type letters into a numeric field, paste
ery long text into notes, and submit with a required field empty. Record **when** feedback appears
as you type? on leaving the field? only on save?) and whether required fields are marked. This is
he baseline for **KOK-143** (live validation, Block D's largest task) — these notes are worth more
han any code review.
4. **Filters and sorting.** On Ventas / Pedidos / Salidas: does the date range default to *inicio de mes
oy*, and does it survive a page reload? Click column headers to sort — asc, desc, back to natural
nd confirm sorting a second column clears the first. Try it with the keyboard (Tab + Enter).
5. **Stock exits.** Record a waste/self-consumption exit. Does it offer packaging lines for an item that
lready has an assembly definition? (That is F-4 seen from the owner's side.) Does it offer Agua?
F-42.)

### C. Cross-cutting

6. **Dark mode.** Toggle it in Configuración and check the **calendar icons** on date fields (the
riginal complaint) and general contrast on 2–3 screens.
7. **PWA (F-11).** Install it on your phone. Then have someone rebuild/redeploy and open it again — does it still work, or does it break until you force-refresh? **This is now testable for the first**  
**time**, since staging actually deploys.
8. **Mobile at ~390 px.** Start a session from the header, open the weekly calendar, and fill one line-bearing form. Also judge F-30: should **Sesiones** be a primary bottom tab instead of hidden
nder "Más"?
9. **Copy check.** Confirm live: "Artículos comprados", "Artículos vendidos", "Artículos del pedido",
Preparación", "Costo invisible del periodo", and the Ventas note telling you to use *Entregar
edido* for an order.

### Already verified in the browser

- **By the reviewer (2026-08-14):** starting a session from the header; closing the previous session and
starting a new one of the same type in a single step; running concurrent sessions of different types.
All worked.
- **By the owner (2026-08-16, Issue #30):** all of Section A — see §3. Also confirmed working: the
close-session form and the count form both **preserve** input across a drawer close; sticky headers
**do** work in the sessions weekly calendar.

---

## 7. Method and coverage


| Area                                          | How verified                                                                                      | Confidence                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Costing, replay, WAC, cycle detection, C-3d   | Source read + test read + golden-number assertions                                                | High                                         |
| Sessions domain (KOK-130…135)                 | Source + migration + tests                                                                        | High                                         |
| Orders domain (KOK-136…139)                   | Source + full state-machine matrix test                                                           | High                                         |
| Block A items                                 | Source read, item by item                                                                         | High (except pixel alignment)                |
| Repo health (2026-08-14)                      | Commands executed: lint, typecheck, build, 987 tests, invariants, migration reset                 | High                                         |
| Repo health (2026-08-16, re-run at `45a04ea`) | `pnpm run test` — **989/989 passing, 0 failures** (worker 765/58 files, shared 154/15, web 70/11) | High                                         |
| Fixtures                                      | Source read + independent re-verification, re-checked at `45a04ea`                                | High                                         |
| Docs/KB/backlog consistency                   | Source + `git log`/`git show`                                                                     | High                                         |
| Pipeline state                                | `git rev-list --left-right`, `gh pr list`, `deploy.yml`, PRs #24–#29                              | High                                         |
| Migration safety on non-empty DBs             | PR #25–#27 narratives + a real staging run                                                        | Medium — verified once, against one database |
| **Browser behaviour, Section A**              | **Owner-led pass, 2026-08-16 (Issue #30)**                                                        | **High**                                     |
| **Browser behaviour, Sections B &amp; C**     | **Not run**                                                                                       | **None — see §6**                            |
| Pixel-level alignment (KOK-109)               | Not verifiable statically                                                                         | None                                         |


**Commands run for this revision (read-only):** `pnpm run test` (989/989 green),
`git log`, `git diff --stat d2cfbff..45a04ea`,
`git rev-list --left-right --count origin/main...origin/develop`, `gh issue view 30`,
`gh pr list --state merged`, and targeted `grep`/source reads across `apps/web`, `apps/worker`,
`packages/shared` and the KB. No source file was modified during this review.
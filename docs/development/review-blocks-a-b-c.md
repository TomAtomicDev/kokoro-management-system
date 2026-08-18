# Tech-lead review — Blocks A, B and C (Phase 3.2)

**First issued:** 2026-08-14 · branch `develop` @ `d2cfbff`
**Revised:** 2026-08-16 · `develop` = `main` = `origin/main` @ `45a04ea`
**Revised:** 2026-08-18 · `develop` @ `f273f54` — **release revision**
**Scope:** KOK-104…120, KOK-151/152 (Block A) · KOK-121…129, KOK-150 (Block B) · KOK-130…139, KOK-153 (Block C)
**Measured against:** [`acuerdos-prueba-usuario-1.md`](acuerdos-prueba-usuario-1.md) (the closed record of what was
agreed with the owner), the KB (Docs 03/04/06/07/12/13) and `CLAUDE.md`'s golden rules D-1…D-10.

**New inputs folded into this revision:**

- **The P0 and P1 batches shipped** (PRs #31–#43, #45). All seven P0 tasks and all eleven P1 tasks
  from the 2026-08-16 revision are merged and deployed to staging.
- **The owner completed §6 Sections B and C** on staging, recorded in
  [**Issue #44**](https://github.com/TomAtomicDev/kokoro-managemnt-system/issues/44) (2026-08-18).
  §6 is now **fully executed**: Sections A, B and C are all done.
- **A production release date:** the business goes live on **real data in the production
  environment this week.** That constraint, not tidiness, is what orders §4 below.

> **What this document is.** An independent verification of what the three merged blocks actually
> deliver, against what was promised, kept current as evidence arrives. It supersedes the blocks' own
> self-reports ([A](block-a-quick-wins.md), [B](block-b-grounding-report.md),
> [C](block-c-sessions-orders.md)) where they disagree. **§4 is the actionable output**: §4.1 is the
> release lane for this week; §4.4 is what follows it, before the team returns to
> [`10-implementation-backlog.md`](../system-design-knowledge-base/10-implementation-backlog.md).
>
> **Coverage.** Static/code verification is complete and was re-run against `f273f54`; every finding
> added in this revision was reproduced in the source before being written down. Browser
> verification is complete for §6 A, B and C. What remains unverified is **production itself** —
> §6 Section D.

---

## 0. What changed since the 2026-08-16 revision


| Was                                                             | Now                                                                                                                                                                        | Evidence                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 7 P0 tasks open, 11 P1 tasks open                               | ✅ **All 18 merged and on staging.** F-1…F-5, F-7…F-13, F-32…F-45 closed                                                                                                    | PRs #31–#43, #45; §3.1               |
| §6 Sections B and C "not run"                                   | ✅ Run by the owner, surfacing **F-46…F-65** — twenty new findings, and confirming F-31                                                                                     | Issue #44                            |
| **F-31** listed as "possible, unconfirmed"                      | ✅ **Real, and now reproduced in the source.** Production edit mode never recomputes                                                                                        | §3.2, `ProductionRunForm.tsx:116,220` |
| **F-30** was an open product question                           | ✅ **Answered by the owner: no.** Sesiones does not need a mobile bottom tab — the header controls are enough                                                               | Issue #44 §C-8                       |
| Go-live meant "the owner starts using staging for real"         | Go-live now means a **first deploy to the `prod` environment this week**. Nothing has ever been deployed there; the release itself is an untested path                     | `wrangler.toml` `[env.prod]`, §4.3.5 |
| Top risk was the form layer                                     | The form layer is materially better. **The top risk is now that one whole vertical — Pedidos — is unusable, for two reasons neither review nor test-A could have predicted** | §1, F-46/F-47                        |
| KOK-115 (sorting) recorded as "sort logic fully correct"        | Still true, and still almost entirely **unreachable**: only 2 of 10 tables opt any column in                                                                               | F-51                                 |
| KOK-147 recorded "inventing a code system was rejected"         | The owner has now asked for exactly that, unprompted, across six event types. **The decision is reversed**                                                                 | F-57, Issue #44 §B-4                 |
| Repo health: 989 tests green at `45a04ea`                       | **1021 tests green at `f273f54`** (worker 773/59 files, shared 158/15, web 90/15)                                                                                          | `pnpm run test`, this revision       |


---

## 1. Verdict

**The engine is sound, the form layer is fixed, and the release is one week away. Between here and
production stand six defects — two of which make the Pedidos vertical unusable, and neither was
findable without the owner sitting in front of the app.**

Four things are true:

1. **The P0/P1 batch worked.** Every one of the owner's fourteen Section-A complaints is closed, and
   she confirms it in her own words: the stock indicator reads correctly, the batch recompute works,
   dark mode and its calendar icons are right, the PWA survives a redeploy, and every copy check
   passes. That is the first test session in this project's history that closed more than it opened
   in the areas it was aimed at.
2. **The two blockers she found are both invisible-by-construction bugs, and both are in Pedidos.**
   The order form rejects future delivery dates — because §A-6's "no future dates" rule, written for
   *transaction* dates, was applied to `deliveryDate`, a field that is future **by definition**
   (F-46). And an order created after 20:00 La Paz vanishes from the board entirely, because
   `listOrders` compares a UTC `created_at` against La Paz calendar-date boundaries (F-47). She
   filed the issue at 00:01 La Paz, which is exactly why she saw it and we did not. Neither is
   findable by reading a form; both are one-line-shaped fixes with real reasoning behind them.
3. **F-31 is real, and it is the one finding that can put a wrong number in the database.** Editing a
   production run and changing `batches` recomputes nothing — not the output quantity, not the
   untouched ingredient lines — because saved lines are keyed `saved-production-line-${index}` while
   the recipe map is keyed by `recipe.lines[].id`, so every lookup misses silently. The owner
   changes 1 tanda to 3, sees the numbers stay put, and either fixes twelve fields by hand or saves
   a run that claims 3 batches consumed one batch of ingredients. That is a costing-data defect
   wearing a UI costume.
4. **The release itself is the least-tested path in the system.** `[env.prod]` has a database id and
   a workflow job, and has never run. Twenty-three migrations will apply to an empty prod D1 for the
   first time; two secrets must exist before the first login; and the owner must run the onboarding
   wizard on her real catalog rather than inherit the dev fixture. None of that is hard — all of it
   is unrehearsed, and it is scheduled for the same week as six code fixes.

**Release position.** The gate is now **six tasks** (§4.1), all sized S or M, plus a rehearsed
release procedure. That is a realistic week. **What is explicitly *not* in the gate** is the larger
half of Section B/C's yield: sorting that exists but was never switched on, human-readable event
codes, live field validation, and the session-UX pass. Those are real, the owner will feel them
daily, and they are §4.4 — the week *after* the release, before the team returns to Block D.

One judgement worth stating plainly, because it will otherwise be re-litigated: **F-57 (human
readable codes for sessions, productions, sales, packings, purchases and orders) reverses a decision
this project already recorded.** KOK-147 says "inventing a code system was rejected as unnecessary."
The owner has now asked for it in her own words, having used the app, after seeing a production
session render as the bare word "Producción". She is right and the earlier decision was wrong. It is
not a release blocker — a per-type sequence backfills cheaply from `created_at` — but it should land
before the data grows, and the KB must record the reversal rather than let two documents disagree.

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
- Future-date rejection is centralized in `packages/shared/src/dates.ts:118-149` and imported by all
six event types, using `Intl.DateTimeFormat` with `America/La_Paz` — with a real "tomorrow UTC /
today La Paz" boundary test. **Its one misapplication is F-46**, which is a call-site error, not a
defect in this module.

### Orders — the strongest part of the three blocks (domain layer)

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

> The domain layer is not what F-46/F-47 break. Both live in the schema call-site and the list query
> respectively; nothing in this subsection needs to change to fix them.

### Deployment and migration safety

Recorded because it is load-bearing and must not be undone by a future "cleanup":

- `**PRAGMA defer_foreign_keys=ON` is the only pragma that works** inside `wrangler d1 migrations apply`'s implicit transaction. `PRAGMA foreign_keys=OFF` is silently a no-op there. Migrations
0012/0013/0014/0022 now use `defer_foreign_keys` **and** snapshot/restore their `ON DELETE cascade`
child tables (`item_aliases`, `purchase_lines`, `production_consumptions`), because deferring does
not stop cascades — they fire immediately regardless of the pragma (PR #25).
- `**reset-remote-d1.mjs` now drops in real FK-dependency order**, computed from `PRAGMA foreign_key_list` per table, handles the one genuine cycle (`sales` ⇄ `custom_orders`) by deleting
rows before dropping tables, drops views as well as tables, and excludes Cloudflare's reserved
`_cf_%` tables (PRs #26/#27).
- `**wrangler d1 execute --remote --file=…` collapses a multi-statement file into a single summary
row**, unlike `--local`, which returns one result set per statement. Any script that reads results
back must use one `--command` per statement.

### Confirmed working in the browser by the owner, 2026-08-18 (Issue #44)

Recorded so nobody spends the release week re-verifying what she already signed off:

- **Dark mode** and the date-field **calendar icons** in both themes (§C-6). KOK-106/151/152 close.
- **The installed PWA survives a redeploy** — no white screen, no forced hard refresh (§C-7).
  KOK-162's update strategy works in the field. Its only remaining gap is naming (F-61).
- **All copy checks pass** (§C-9): "Artículos comprados/vendidos/del pedido", "Preparación", "Costo
  invisible del periodo", and the Ventas → *Entregar pedido* note.
- **The per-ingredient stock indicator** renders correctly per line in the production form, and
  **create-mode batch recompute works as designed** (§B-2). KOK-116/117 close.
- **Stock exits refuse Agua** (§B-5) — KOK-176's `isUnmetered` eligibility filter works against a real
  catalog, closing the browser half of F-42.
- **Envasado has working column sorting**, including the "one active column at a time" rule (§B-4) —
  the KOK-115 engine is correct; F-51 is that almost nothing else uses it.
- **The order picker appears in the production form** and resolves its selection (§B-2).

### Block A/B/C items confirmed correct by source review

KOK-104, KOK-107, KOK-108 (all six tooltips; `InfoTooltip` is a real `<button>`, keyboard-operable,
Escape-to-close with focus restore, correct ARIA), KOK-109, KOK-110, KOK-111 (Agua = 231
milli-centavos/L in **both** fixtures), KOK-113, KOK-114, KOK-115 (sort logic: single active column,
`Intl.Collator("es-BO", {numeric:true})`, keyboard-operable headers with `aria-sort`), KOK-116,
KOK-118, KOK-119, KOK-151/152, and **D-10: zero new dependencies** across the entire phase.

**KOK-112 was solved better than asked.** The agreement said "hide the negative-stock warning in edit
mode"; the implementation instead recomputes it against the sale's own already-deducted stock
(`SaleForm.tsx:276-291`), which removes the false warning without hiding a true one.

**Mojibake is a non-issue in the product.** User-facing Spanish strings are clean; the remaining
`â€"` sequences are em-dashes inside code comments only.

---

## 3. Findings

Severity is judged against **the first production release**, which is now this week. Findings keep
their original numbers so earlier references stay valid.

### 3.1 Resolved

**Closed in the 2026-08-16 batch** (PRs #31–#43, #45), each verified at `f273f54`:


| Finding                                   | Closed by | Note                                                                                                |
| ----------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| F-6 (nothing deployed)                    | KOK-154   | `origin/main` and `origin/develop` both carry the phase; staging deploys on every merge             |
| F-1, F-45 (sticky headers)                | KOK-158   | `EventTable` now scrolls in a bounded `max-h-[32rem] overflow-auto` box with sticky `<th>` cells    |
| F-2, F-20 (seed fixture)                  | KOK-155   | `rl_pan_caja` gone; presentations added; fixture-validation test added                              |
| F-3, F-25, F-44 (no Envasar UI)           | KOK-156   | `/packing` + `/packing/definitions` are real nav sections with CRUD and history                     |
| F-4, F-37 (`isDefault` double-deduction)  | KOK-157   | `ExitForm.tsx:217` now gates on **any** active definition (`hasActiveAssemblyDefinition`)           |
| F-5 (`replacement_cost_history`)          | KOK-073   | Migration `0023_replacement_cost_history.sql` applied                                               |
| F-7, F-43 (no unsaved-changes guard)      | KOK-142   | Dialog primitive + route blocking + `beforeunload`                                                  |
| F-8 (no client-side caps)                 | KOK-159   | `maxLength` derived from the shared `safeText(N)` bound — see F-50 for what this does *not* cover  |
| F-9 (purchase total line)                 | KOK-160   | Delivered inside KOK-140; both pinned footers render total + destination account                    |
| F-10 (packaging suggestion on exits)      | KOK-161   | `packagingLinesFromDefaultDefinition` in `ExitForm.tsx:93`                                          |
| F-11 (PWA stale shell)                    | KOK-162   | **Owner-verified in the field**: the installed PWA survived a redeploy (§C-7)                        |
| F-12 (KOK-135 has no consumer)            | KOK-164   | Disposition recorded; KOK-135 stays a prerequisite of KOK-051                                       |
| F-13 (`customOrderId` unlink)             | KOK-163   | Omitted vs. cleared now distinguishable                                                             |
| F-32, F-35, F-36 (Envasado form)          | KOK-173   | Definition field, stock text, footer width                                                          |
| F-33, F-42 (pickers offering rejects)     | KOK-176   | `ItemPicker` eligibility (kind/unit/`isUnmetered`) — **owner-verified for Agua on exits**            |
| F-34, F-41 (`LineEditor` layout)          | KOK-172   | One shared grid template for header and rows — but see **F-54**, a regression it introduced         |
| F-38 (session drawer clipping)            | KOK-175   | Action row wraps                                                                                    |
| F-39 (session close arithmetic)           | KOK-174   | End defaults to now; end ↔ duration derived                                                        |
| F-40 (forms are modals)                   | KOK-140   | Compra and Venta are full pages with their own URLs                                                 |


**Answered by the owner, not by code:**

- **F-30 — should Sesiones be a primary mobile tab? No.** Issue #44 §C-8: *"No es necesario que
  sesiones sea un bottom tab, las funcionalidades de abrir y cerrar rápido desde el header son
  suficientes."* `mobileTabs` (`nav-items.ts:104-109`) stays as it is. **Close this question.**
- **F-22 (offline notice: toast vs. dialog)** was not exercised in Sections B/C and remains the only
  open item in KOK-171.

### 3.2 Blockers — must be fixed before the production release

**F-46 · The order form rejects future delivery dates, so no order can carry one.** *(new — Issue #44
§B-1)* · **Owner-reported as blocking**
Owner: *"El formulario de nuevo pedido no acepta fechas de entrega futuras. Un pedido siempre tendrá
una fecha futura."*
She is right, and the cause is a rule applied one field too far. `quoteOrderCommandSchema`
(`packages/shared/src/orders.ts:120`) declares `deliveryDate: businessDateSchema.optional()`, and
`businessDateSchema` (`dates.ts:124-134`) refuses anything after today in La Paz with *"La fecha no
puede ser futura."* That refinement exists for agreements §A-6, whose reasoning is explicit and
correct: *"transactions post immediately and affect today's balance, so a future date would
communicate something false."* A promised delivery date is **not a transaction date** — it moves no
money, writes no kardex row and posts nothing. KOK-138 applied A-6 across "purchases, sales,
production, assemblies, exits and order payments" — `deliveryDate` was never in that list and was
caught by reuse of the wrong schema. This is the only such misapplication: `deliveryDate` appears in
exactly one command schema, and no update-order command exists to carry a second copy. → **KOK-177**

**F-47 · An order created in the evening disappears from the board — a UTC/business-date boundary
bug.** *(new — Issue #44 §B-1)* · **Owner-reported as blocking**
Owner: *"Después de registrar el pedido, el formulario se cierra pero nada aparece en la columna
cotizando ni en ninguna otra columna. ¡No es posible probar el flujo completo!"*
`listOrders` (`core/orders/index.ts:1305-1308`) filters on:

```ts
gte(t.createdAt, `${filters.fromDate}T00:00:00.000Z`)
lte(t.createdAt, `${filters.toDate}T23:59:59.999Z`)
```

`created_at` is a **UTC instant** (`nowIso()`); `fromDate`/`toDate` are **La Paz business dates**
supplied by `getDefaultDateRange()` (`DateRangeFilter.tsx:21-24`, start-of-month → today). La Paz is
UTC−4, so an order created at 20:00 or later local time carries a `created_at` on the **next** UTC
day and falls outside `toDate`'s upper bound. The owner filed Issue #44 at 00:01 La Paz. Every order
she created that evening was written correctly and then filtered out of her own board.
**Why this survived every previous check:** `custom_orders` has no `business_date` column (it is not
a kardex event), so this is the one list in the app that must derive the local day from an instant —
and it is the only place in `apps/worker/src` where a date string is concatenated onto a UTC literal
(`grep` for `T23:59:59.999Z` returns these two lines and nothing else). `OrderPicker` passes no date
filter at all, which is why the picker kept working and hid the failure from the production form.
**Do not fix this by hardcoding −4.** Doc 02 §5 and `dates.ts`'s own docstring make the timezone
configurable through Intl on purpose. → **KOK-178**

**F-31 · Production edit mode never recomputes — confirmed.** *(was §6 B-2's open question; Issue #44
§B-2 confirms it)*
Owner: *"En modo edición, si cambio las tandas, la cantidad de salida y los ingredientes no
modificados no se actualizan como deberían, F-31 es real."*
Two independent causes, both in `ProductionRunForm.tsx`:

1. **The line keys never match.** Edit mode seeds saved lines with
   `lineKey: `saved-production-line-${index}`` (`:116`), while the recompute effect looks each line up
   in `recipeLinesById`, a map keyed by `recipe.lines[].id` (`:263`) — the key create mode uses
   (`:255`). Every `recipeLinesById.get(line.lineKey)` returns `undefined`, the guard at `:289`
   returns the line unchanged, and **not one ingredient is ever recomputed in edit mode.**
2. **Output quantity is force-marked dirty.** The edit-mode seeding branch sets
   `actualOutputQtyDirtyRef.current = true` (`:220`), which the batches handler at `:278` reads as
   "the owner typed this herself — never touch it". So the output quantity is frozen too.

Severity is higher than a UI annoyance: the owner changes 1 tanda to 3, sees nothing move, and either
retypes twelve fields or saves a run whose `batches` says 3 while its consumptions say 1. That is
wrong data reaching WAC and C-4, written by the app behaving exactly as coded. → **KOK-179**

**F-54 · The unit selector squeezes the quantity input down to a sliver — a KOK-172 regression.**
*(new — Issue #44 §B-4)*
Owner, on the Envasado form: *"el campo numérico para cantidad es tan estrecho que no se ve el número
que uno escribe y parece vacío."*
`LineEditor.tsx:110-115` fixes the quantity column at `9rem` (144 px). Inside that column
(`:177-213`) sit an `<Input className="min-w-0 flex-1">` **and**, when `unitSelector` is passed, a
`<Select className="h-9 w-24 shrink-0 … sm:w-28">` — 112 px at the `sm` breakpoint and up, taken out
of 144 px before the gap. The number field is left roughly **20 px wide**: it accepts input and
displays almost none of it.
Four call sites pass `unitSelector` and are all affected: `PurchaseForm.tsx:525` (a daily form),
`RecipeForm.tsx:452`, `routes/assemblies.tsx:538` and `routes/packing-definitions.tsx:292`. The
column template was correct before KOK-172 promoted the selector out of `RecipeForm`; the promotion
did not widen the column that now has to hold two controls. → **KOK-180**

**F-61 · Staging and production install as the same PWA.** *(new — Issue #44 §C-7)*
Owner: *"He instalado la PWA, funciona bien aún después de un redeploy, pero el nombre es Kokoro
tanto para el ambiente staging como para producción, debería diferenciarse con QA-Kokoro para
staging."*
`apps/web/public/manifest.webmanifest` is a static file with `"name": "Kokoro Management"` and
`"short_name": "Kokoro"`, served identically by both environments. Two installed icons on one phone,
same name, same letter — and one of them writes to a database with her real money in it. This is a
release blocker specifically **because** the release is what creates the second installation.
→ **KOK-183**

**F-66 · The production environment has never been exercised.** *(new — release readiness, not an
owner finding)*
`[env.prod]` in `apps/worker/wrangler.toml` names `kokoro-prod` with a real `database_id`, and
`deploy.yml:118-151` has a gated job for it — and nothing has ever run through either. Concretely,
before the owner can log in to production:

- **23 migrations** (`0001`…`0023`) apply to an empty D1 for the first time. The from-scratch path is
  the one that *is* well tested (§2, and `db:reset:dev` runs it constantly), but it has never been
  run against `kokoro-prod`.
- **Two secrets must exist or every request 500s**: `SESSION_SECRET` and `OWNER_PASSWORD_HASH`
  (`apps/worker/src/env.ts:17-24`; used at `api/auth.ts:39` and `middleware/auth.ts:40`). They are
  `wrangler secret put` values, not repo config, so nothing in CI will tell you they are missing.
- **Production must NOT be seeded from `seed-fixtures.sql`.** That file is dev/staging demo data. The
  real path is the onboarding wizard, run by the owner against her own catalog, balances and counts.
- The `production` GitHub Environment's required reviewer must actually be configured, or the job
  either blocks forever or does not block at all.

→ **KOK-182**

### 3.3 Major — fix in the week after the release

**F-57 · No event has a human-readable identifier, and the owner has now asked for one.** *(new —
Issue #44 §B-4)* · **Reverses a recorded decision**
Owner: *"En la tabla se muestra una sesión de producción solo con el nombre 'Producción'. Creo que
será de mucha utilidad crear un código identificador humanamente comprensible de cada sesión,
producción, venta, envasado, compra y pedido."*
The immediate symptom is `routes/packing.tsx:101-106`, whose session column renders
`sessionsLabels.typeLabels[session.type]` and nothing else — so three packings against three
different sessions all read "Producción". But her request is the general one, and it lands against
**KOK-147**, which records: *"no internal IDs are exposed — events have no short human code and the
internal ones are unreadable UUIDs, and inventing a code system was rejected as unnecessary."*
That decision was made before she had used the app. She has now hit the exact problem it predicted
would not matter. **The reversal is the correct call**, and it must be written into the KB rather
than left as two documents disagreeing (D-1/D-6). A per-type dated sequence (`PRD-2026-0184`,
`VTA-2026-0912`, …) backfills deterministically from `created_at`, which is why this is *not* a
release blocker — but every week of real data makes the backfill a longer script.
→ **KOK-185**, and **KOK-147 must be amended, not silently contradicted**

**F-51 · Column sorting was built once and switched on twice.** *(new — Issue #44 §B-4)*
Owner: *"La tabla ventas no tiene capacidad de sorting… Producción no tiene sorting y sí debería… La
tabla de envasado sí tiene sorting funcional… Tabla de compras, inventario, salidas, conteos,
finanzas y catálogo no tienen sorting."*
Exactly right, and the reason is structural: `EventTable`'s sorting is **opt-in per column**
(`sortable?: boolean` + `sortValue`, `EventTable.tsx:47-49`), and a repo-wide grep for `sortable:`
finds it declared in precisely two files — `routes/packing.tsx` and `routes/packing-definitions.tsx`,
both written for KOK-156, weeks after KOK-115 shipped the engine. Ventas, Producción, Compras,
Inventario (stock), Salidas, Conteos, Finanzas and Catálogo declare none.
So KOK-115 is not wrong — §2 still stands — it is **8/10 unreachable**. The owner's read is also
correct that Pedidos needs no sorting: it is a status board, not a table. → **KOK-184**

**F-52 · Sort state does not survive a reload, unlike every other view setting.** *(new — Issue #44
§B-4)*
Owner: *"el sort de una columna deshace el sort del anterior, pero no sobrevive a una recarga de
página."*
The first half is the agreed behaviour (KOK-115: one active column). The second half is an
inconsistency: `EventTable` holds sort state in a component `useState` (`:69-71`), while KOK-114
deliberately put the date range, filters and active tab in the URL so a reload or a shared link keeps
the view. Sorting was simply never included. Fix it in the same task as F-51 — the routes are already
being touched. → **KOK-184**

**F-50 · Numeric fields silently swallow letters, and the submit error names the wrong problem.**
*(new — Issue #44 §B-3)*
Owner: *"Si escribo letras dentro del campo numérico cantidad, nada pasa, no aparece ninguna
advertencia. Puedo pegar un párrafo de más de 300 caracteres en Notas y tampoco hay advertencia. Solo
al hacer submit me aparece el mensaje 'Cada línea necesita un ítem, una cantidad y un precio unitario
válidos.' Cuando los datos de los ítems de venta están correctos pero el campo notas tiene demasiados
caracteres, aún así se muestra el mensaje 'Cada línea necesita…'"*
Three distinct facts behind one complaint:

1. **Letters in the quantity field.** `LineEditor.tsx:181-188` renders a plain `<Input>` with
   `inputMode="decimal"` — a keyboard hint, not a constraint. Letters are accepted into state,
   `parseDecimalToInt` returns `null` at submit, and the line is reported invalid.
2. **The notes cap is real but invisible, and larger than she expects.** `SaleForm.tsx:617` does carry
   `maxLength={SALE_NOTES_MAX_LENGTH}` (KOK-159 delivered), but that constant is **2000**
   (`packages/shared/src/sales.ts:33`), not 300 — so a long paragraph is genuinely accepted, with no
   counter to say how much room is left. Her instinct that "something should have said something" is
   the finding; the cap value itself is fine.
3. **The error message is wrong for her case.** `SaleForm.tsx:379-383` returns
   `salesLabels.errors.invalidLine` for *any* unparseable line and returns immediately — so a
   left-over blank line row produces a message about "cada línea" that points at nothing she can see
   as wrong, and the real cause (a row she never meant to fill) is never named.

This is the diagnosis **KOK-143** (live validation, Block D's largest task, 9–14 days) was written
for, and it should not be started in release week. But two slices of it are small, independent and
worth taking early: constrain numeric input at the source, and make the submit error identify the
line and field it is complaining about. → **KOK-187**, feeding KOK-143

**F-48 · Two orders from the same customer on the same day are indistinguishable in the picker.*
*(new — Issue #44 §B-2)*
Owner: *"El order picker aparece, pero si hay dos pedidos del mismo cliente y la misma fecha, no se
sabe cómo diferenciarlos. Mejor agregar también la descripción del pedido."*
`OrderPicker.tsx:87-95` renders each option as customer name over delivery date. `description` is
**already fetched and already searched** (`:45-49`) — it is simply never displayed, in the option or
in the collapsed selected value (`:52-54`). One of the smallest fixes in this document, on the
control that links production and packing to orders. → **KOK-186**

**F-60 · With more than one open session, the chip has no way to close one.** *(new — Issue #44 §C-0)*
Owner: *"Una vez que se ha iniciado sesión, el botón '[Sesión] en curso' al presionarlo debería abrir
un pequeño modal con las sesiones abiertas para cerrar una fácilmente."*
`SessionChip` has two different behaviours. With **exactly one** open session (`:103-136`) it opens a
popover with "ver detalle" and "cerrar ahora" — which is what she is describing and which works. With
**more than one** (`:84-96`) it renders a count and navigates to `/sessions`, with no menu at all.
Concurrent sessions of different types are a designed capability (KOK-130), so this is the normal
case for a day with both a purchase trip and a production run open. Extend the existing popover to
list every open session with its own close action rather than building a second control. → **KOK-188**

**F-62 · `/sessions` opens on the list, not the calendar.** *(new — Issue #44 §C-8)*
Owner: *"Si puedo iniciar una sesión desde el header, el weekly calendar de sesiones debería ser la
vista por defecto."* `routes/sessions.tsx:50`: `const view = searchView ?? "list"`. The toggle and the
URL parameter both already exist — this is the default value, and her reasoning is sound: the list is
for auditing, the calendar is for seeing the week. → **KOK-188**

**F-63 · Session cards in the weekly calendar are the same colour as the calendar.** *(new — Issue #44
§C-8)*
Owner: *"El card de sesión es del mismo color que del fondo, debería diferenciarse mejor."*
`WeeklyCalendar.tsx:145` gives the card `bg-card`; the hour cells it sits on are also `bg-card`
(`:262`), as is the calendar container (`:224`). The only separation is a 1 px `border-border` — and
KOK-151 already established that in dark mode border *is* the depth cue, precisely because shadow is
not. A card floating on an identical surface is the one case that cue cannot carry. → **KOK-188**

**F-64 · "Iniciar ahora" is the default mode of a form mostly used to log the past.** *(new — Issue #44
§C-8)*
Owner: *"En el formulario de Nueva sesión, el modo 'registrar sesión pasada' debería ser el por
defecto."* `SessionForm.tsx:185`: `useState<CreateMode>("START_NOW")`. Her reasoning is consistent
with F-60 and with the recent header change: starting a session now is a **header** action (one tap
on the chip), so by the time she deliberately opens the full form, it is nearly always to record
something that already happened. → **KOK-188**

**F-65 · The session start/end fields are unreadable on a phone.** *(new — Issue #44 §C-8)*
Owner: *"Las horas en los campos Inicio y Fin no se logran ver en mobile, los campos se hacen muy
pequeños, tal vez solo para mobile ambos campos deben ocupar todo el ancho del formulario y estar en
columna en lugar de en fila."*
`SessionForm.tsx:429` wraps the two `datetime-local` inputs in an unconditional
`grid grid-cols-2 gap-3` — no breakpoint. A `datetime-local` control renders a date **and** a time
sub-field plus a picker button; at 390 px each gets under 170 px and the time is clipped. Her
proposed fix (stack on mobile, side by side from `sm:`) is exactly right and is the pattern the rest
of the form already uses (`:531`, `:548`). → **KOK-188**

**F-56 · "Salida planificada" asks the owner for a number the app already knows.** *(new — Issue #44
§B-4)*
Owner: *"El campo salida planificada es inútil, solo debería existir salida real y pre-llenarse con
el dato de salida planificada por defecto."*
`routes/assemblies.tsx:479-493` renders a `plannedOutputQty` input whenever a definition is selected,
prefilled from `definition.outputQty` (`:187`), while `actualOutputQty` (`:495-513`) starts empty. So
she is shown a number she did not choose and asked for one she must type — the inverse of the useful
arrangement. **Do not simply delete the field**: planned-vs-actual is the breakage/spillage signal
C-10 depends on (Doc 03: "9 usable bottles out of 10 planned absorb 100% of the cost"). Keep
submitting `plannedOutputQty` from the definition and prefill `actualOutputQty` with it, so the
common case is one confirmation and the exception is one edit. → **KOK-181**

**F-55 · The Envasado form does not need per-line unit selectors.** *(new — Issue #44 §B-4)*
Owner: *"El formulario nuevo envasado no necesita selectores para unidades."* She is right about the
domain: an assembly component is consumed in its own canonical unit, and the Kg/g choice that makes
purchases and recipes easier adds a control and no decision here. Dropping `unitSelector` from
`routes/assemblies.tsx:538` (keeping the canonical-unit label `LineEditor` shows when no selector is
passed) also removes the F-54 squeeze from this form for free. Note this is a **per-call-site**
judgement, not a rollback of KOK-172: purchases and recipes keep theirs. → **KOK-180**

**F-53 · Nothing tells the owner a table row is clickable.** *(new — Issue #44 §B-4)*
Owner, on Producción: *"también debería mostrar un lápiz y un subrayado en el nombre de la receta para
mostrar que así se entra al modo editar."*
`EventTable` wires `onRowClick` (`:56`) and every list route passes one, but the row carries no
affordance — no underline, no icon, no cursor cue on the identifying cell. KOK-110 already added
exactly this affordance ("pencil icon and 'Editar ítem' title") to the catalog drawer, so the pattern
exists and is hers. Apply it at the `EventTable` level so every list inherits it. → **KOK-190**

**F-58 · The stock-exit item picker searches the whole catalog with no way to narrow it.** *(new —
Issue #44 §B-5)*
Owner: *"En el formulario registrar salida, sería más útil seleccionar primero el tipo del ítem (por
defecto en producto final) y así facilitar la búsqueda en el select."*
`ExitForm.tsx:367-373` passes `eligibility={{ isUnmetered: false }}` and no kind filter, so every
metered item in the catalog is in one list. A kind selector defaulting to `FINISHED` in front of the
picker is a small, self-contained addition, and it is the same shape as the eligibility prop KOK-176
already built. → **KOK-189**

**F-59 · The "Costo invisible del periodo" card is oversized and misplaced.** *(new — Issue #44 §B-5)*
Owner: *"El costo invisible del periodo está en línea con los filtros de fecha y el botón, pero al ser
un card muy grande se ve muy feo. Hay que ubicarlo de forma que tenga más armonía con los demás
componentes."*
`routes/inventory.tsx:225-227` puts `DateRangeFilter` and `WasteSummaryCard` in one
`flex flex-wrap items-end justify-between`, and the card declares `flex-1`
(`WasteSummaryCard.tsx:25`), so it expands to eat every pixel the filter does not use and sits at the
same level as a control. It is a summary, not a filter. → **KOK-189**

### 3.4 Scheduled work the owner asked for — no new task needed

- **"Sin receta" production mode.** Owner, §B-2: *"Aún no existe el modo 'Sin receta' donde pueda
  especificar el ítem de salida."* Correct — it is **KOK-144**, already scoped in Block D
  (`recipe_id` becomes optional, migration + KB amendment). No new ticket; record that it is now her
  most-wanted Block D item, ahead of KOK-145–149.
- **Order picker status filtering.** Owner, §B-2: *"No puedo probar si solo aparecen los estados
  diferentes a entregado o cancelado."* She could not test it because F-46/F-47 stopped her creating
  orders. The code is correct — `OrderPicker.tsx:23` passes
  `excludeStatuses: ["DELIVERED", "CANCELLED"]` — so this is **untested, not unbuilt**. It belongs to
  §6 Section D's re-run, once KOK-177/178 land.

### 3.5 Resolved by asking — the exit packaging gate is correct

Owner, §B-5: *"Sí ofrece packaging lines para el componente con un assembly definido."* The open
question was whether KOK-157's gate had failed to reach the UI, which would have reopened F-4.

**It had not. The behaviour is correct and F-4 stays closed.** She confirmed she selected **"Pan de
masa madre"** and **"Ghee"** — and in the fixture those are the *bulk base products*
(`item_pan_masa_madre`, `item_ghee`), which appear only as **components**
(`seed-fixtures.sql:70,73` — `adl_pan_base`, `adl_ghee_base`). The definition **outputs** are the
separate presentations `item_pan_500g` and `item_ghee_200g` (`:63-64`). So `ExitForm.tsx:204-218`
queried `/assembly-definitions?outputItemId=item_pan_masa_madre&isActive=true`, correctly found none,
treated the item as unassembled and offered the packaging section — which is A-1 case 3 verbatim:
*"gifting an unbagged loaf physically consumes a bag and a label."*

**What her surprise does tell us** is that the section appears without saying why. A one-line
explanation above it — this item is leaving unpackaged, so add whatever packaging you actually use —
turns a confusing control into an obvious one. **Copy only, no logic change** → folded into
**KOK-169**, not a new task.

### 3.6 Minor — carried forward, unchanged


| #    | Finding                                                                                                  | Task    |
| ---- | -------------------------------------------------------------------------------------------------------- | ------- |
| F-15 | `KOK-132` was flipped **back** to `📋 To Do` by the commit whose message says it marked it done          | KOK-167 |
| F-16 | KB says "implementation pending" for two shipped rules — O-6 (order reversal) and S-5 (dedup hours)     | KOK-167 |
| F-17 | Four modules redeclare `businessDateSchema`/`occurredAtSchema` **without** the future-date refinement   | KOK-168 |
| F-18 | Impact-dialog copy says *"Esta sesión ya está cerrada"* even for a backdated create into an open session | KOK-169 |
| F-19 | Native `window.confirm` in `OrderDetailDrawer.tsx:202,214,235,260` while every sibling uses `Dialog`     | KOK-170 |
| F-21 | No UI copy says sorting covers only loaded rows (A-10) — now more visible once F-51 lands                | KOK-184 |
| F-22 | Offline notice is a toast (`role="status"`) while A-9 says "dialog" — still unexercised                 | KOK-171 |
| F-23 | Drizzle `meta/_journal.json` is stale — 0017…0023 unregistered. Tooling bookkeeping only                | KOK-167 |
| F-24 | Hardcoded Spanish `"u. de "` outside i18n (D-9)                                                          | KOK-169 |
| F-26 | Negative-stock copy reads "El stock quedaría negativo" vs the agreed "…en negativo"                     | KOK-169 |
| F-27 | No exhaustiveness test for `WAC_ENTRY_TYPES` (one exists for `STOCK_MOVEMENT_TYPES`)                     | KOK-169 |
| F-28 | Both PWA icons are `"purpose": "any maskable"` on unpadded artwork; no PNG favicon fallback              | KOK-169 |
| F-29 | Raw `+=` on Centavos instead of `addMoney` (pre-existing, D-5)                                            | KOK-169 |
| F-67 | The alerts bell (`Topbar.tsx:46-55`) is a permanently `disabled` placeholder shipping to production      | KOK-183 |


### 3.7 Traceability discrepancies (not defects)

1. Acceptance checklist point **15** ("reports that separate offerings sold from products included")
   is a Block B acceptance requirement in §A-1 but a **KOK-050 / Phase 5** row in the backlog. The
   backlog should win, and §A-1 should say so. → KOK-167
2. **The backlog was materially out of date — ✅ reconciled 2026-08-18.** KOK-132, KOK-140 and
   KOK-142 were `📋 To Do` there while merged in reality; all three are now ✅, with the evidence
   inline. Five future rows whose premises this review changed were amended in place: **KOK-138**
   (the future-date rule covers transaction dates only — the trap that produced F-46), **KOK-141**
   (its pattern and its Envasar surface now exist), **KOK-143** (KOK-187's two slices ship earlier —
   build on them, don't rebuild them), **KOK-144** (owner-requested twice; now first in Block D) and
   **KOK-147** (the code-system decision is reversed). Phase 3.2's go-live paragraph now records that
   both prerequisites are met and points here for the release lane.
   **Deliberately *not* done: KOK-155…190 were not added to the backlog.** They are defect fixes and
   release work produced by two owner-led test sessions, not phases of the plan. The backlog stays
   the big-picture plan and this document stays the pre-MVP fix list; where the two touch, the
   backlog row says so inline. → KOK-167 is correspondingly narrowed (see §4.5)

---

## 4. Task list

**Legends**:

- **Size** — S ≤ half day · M ≤ 1.5 days · L ≤ 3 days (AI-assisted).
- **🧠 Required intelligence (1–5)** — 1 mechanical · 2 routine · 3 standard engineering · 4 complex
logic (money math, state machines, atomicity) · 5 design-heavy. Anything touching money arithmetic,
the kardex or derived-row regeneration is 4–5 regardless of size.
- **Status** — all new rows start 📋 To Do.

**How to use this section.** §4.1 is the **release lane** — the only work that may be started before
the production deploy. §4.4 is the week after. Every new row has a **detail card** in §4.3 / §4.6
with the owner's own words, the exact files, acceptance criteria a reviewer will check, and the rules
that constrain the change. **Read the card before starting the task.**

**Three standing instructions for this batch:**

1. **Nothing here is a licence to touch `core/` costing.** §2 lists what is already correct. If a task
seems to require changing replay, WAC or C-10, stop and escalate — it almost certainly doesn't.
2. **Every UI task ships with a browser verification** using the `verify-ui` skill, at desktop **and**
390 px, in **both themes**. "It compiles" is not evidence.
3. **Release week is a freeze on scope.** If a §4.1 task turns out to be bigger than its card says,
escalate rather than absorbing it. The release date is the constraint; the task list is negotiable.

---

### 4.1 P0 — the release lane (must land before the production deploy)


| ID      | Task                                            | Area    | Size | 🧠  | Status   | Description                                                                                                                                                                                             |
| ------- | ----------------------------------------------- | ------- | ---- | --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KOK-177 | Orders may carry a future delivery date         | shared  | S    | 3   | 📋 To Do | A promised delivery date is not a transaction date. §A-6's refinement was applied to `quoteOrderCommandSchema.deliveryDate` by schema reuse; lift it, with the KB amendment saying why. Closes F-46. → §4.3.1 |
| KOK-178 | Orders board: filter by business date, not by a UTC instant | backend | S | 4 | 📋 To Do | An order created after 20:00 La Paz falls outside its own board's date filter and disappears. Derive the UTC window from the business dates through Intl — never hardcode −4. Closes F-47. → §4.3.2 |
| KOK-179 | Production edit mode must recompute             | web     | S    | 3   | 📋 To Do | Saved lines are keyed `saved-production-line-${index}`; the recipe map is keyed by line id, so every lookup misses and nothing recomputes. Output qty is force-marked dirty too. Closes F-31. → §4.3.3 |
| KOK-180 | Give the quantity input room back                | web     | S    | 2   | 📋 To Do | A `w-28` unit `Select` inside a `9rem` column leaves ~20 px for the number. Widen the column where a selector is used; drop the selector from Envasado, which does not need one. Closes F-54, F-55. → §4.3.4 |
| KOK-183 | Per-environment PWA identity + hide dead controls | web   | S    | 2   | 📋 To Do | Staging and production install as the same "Kokoro" on the same phone. Template the manifest per environment ("QA-Kokoro"), and hide the permanently disabled alerts bell. Closes F-61, F-67. → §4.3.6 |
| KOK-182 | Production release readiness and first deploy   | infra   | M    | 3   | 📋 To Do | `[env.prod]` has never run: 23 migrations, two secrets, no dev seed, a real reviewer gate, and the owner's own onboarding. Rehearse it, then run it. Closes F-66. → §4.3.5                              |


**Ship-with-the-release if the lane clears early** — both are S, both unblock her own testing, neither
is load-bearing:


| ID      | Task                                    | Area | Size | 🧠  | Status   | Description                                                                                                                    |
| ------- | --------------------------------------- | ---- | ---- | --- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| KOK-186 | OrderPicker must show the description   | web  | S    | 1   | 📋 To Do | The field is already fetched and already searched — it is just never rendered. Closes F-48. → §4.6.3                          |
| KOK-181 | Envasado: ask for real output, not planned | web | S   | 3   | 📋 To Do | Prefill "Salida real" from the definition and stop asking for "Salida planificada" — while still submitting it, because planned-vs-actual is C-10's breakage signal. Closes F-56. → §4.6.2 |


---

### 4.2 Release-week sequencing

Six tasks, one week, one hard date. The ordering that matters:


| Day     | Work                                                              | Why                                                                                                                                            |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**   | **KOK-177 + KOK-178 together, as one PR if convenient**           | They are the same blocked flow. Neither alone lets the owner create an order and see it. Merge them, deploy staging, and **ask her to re-run §6 B-1 immediately** — that re-test is the gate for everything else. |
| **1–2** | **KOK-179**, **KOK-180** in parallel                              | Disjoint files (`ProductionRunForm.tsx` vs `LineEditor.tsx` + four call sites). KOK-179 is the data-correctness one; do not let it slip.        |
| **2**   | **KOK-183**                                                       | Must be in the build that becomes the first production deploy, or the owner installs an unnamed twin.                                          |
| **3**   | **KOK-182 rehearsal** — a throwaway D1, migrations, secrets, login | Find the release's problems on a database nobody cares about. This is the step people skip.                                                     |
| **4**   | Owner re-runs §6 B-1/B-2 on staging; fix anything it surfaces      | Her re-test, not ours, closes F-46/F-47/F-31.                                                                                                  |
| **5**   | **KOK-182 for real**: deploy, onboard, §6 Section D smoke          | Onboarding on real data is the owner's work and needs her time booked in advance.                                                              |


**Three traps worth naming before anyone picks up a task:**

- **KOK-178 will tempt someone to write `T04:00:00.000Z`.** It is the correct number today and the
  wrong code — `dates.ts` resolves the offset through Intl on purpose, and Doc 02 §5 makes the
  timezone a setting. Add the helper there; do not inline an offset.
- **KOK-179 will tempt someone to "just re-seed the form on save".** The bug is a key mismatch and a
  ref set to the wrong value. Fix those two things; do not restructure the form's state model in
  release week.
- **KOK-182 is not a deploy button.** Its deliverable is a written, rehearsed procedure plus the run.
  If it is treated as "click deploy", the missing-secret 500 will be discovered by the owner.

---

### 4.3 P0 — detail cards

#### 4.3.1 · KOK-177 · An order may be promised for a future date

**Area** shared · **Size** S · **🧠** 3 · **Closes** F-46 · **Depends on** — · **Blocks** the whole Pedidos vertical

**Why.** Owner, Issue #44 §B-1, marked blocking: *"El formulario de nuevo pedido no acepta fechas de
entrega futuras. Un pedido siempre tendrá una fecha futura."*
`quoteOrderCommandSchema` declares `deliveryDate: businessDateSchema.optional()`
(`packages/shared/src/orders.ts:120`), and `businessDateSchema` (`dates.ts:124-134`) rejects anything
after today in La Paz. That refinement implements agreements §A-6, whose stated reason is that
"transactions post immediately and affect today's balance". A delivery date moves no money, writes no
kardex row and posts nothing — it is a **promise**, and O-5 even sorts the board by it. KOK-138's own
scope list ("purchases, sales, production, assemblies, exits and order payments") never included it;
it was caught by schema reuse.

**What to build.**

1. Replace `businessDateSchema` on `quoteOrderCommandSchema.deliveryDate` with a date schema that
   keeps the **format** validation and drops the **future** refinement. Export it from `dates.ts`
   (e.g. `calendarDateSchema`) so the split is explicit and reusable, and so `businessDateSchema` can
   be documented as "business/transaction dates only".
2. Leave every other field alone. `confirmOrderCommandSchema.businessDate`,
   `deliverOrderCommonFields.businessDate` and `cancelOrderCommandSchema.businessDate` are all real
   transaction dates and **must keep** the refinement (`orders.ts:141,154,218`).
3. Check the form for a mirror of the rule: `QuoteOrderForm.tsx:195` renders a plain `type="date"`
   input — confirm no `max` attribute or client-side guard reproduces the block.
4. **KB amendment in the same PR (D-1/D-6).** Doc 03's order rules and `acuerdos-prueba-usuario-1.md`
   §A-6 must state that the no-future-dates rule covers **transaction** dates and explicitly exempts
   `custom_orders.delivery_date`. Otherwise the next person re-applies it.

**Acceptance.** An order can be quoted with a delivery date weeks ahead and appears on the board with
it. Confirming, delivering or cancelling that order with a **future** `businessDate` is still
rejected with the existing `message_es`. A regression test in `packages/shared` asserts both halves —
future `deliveryDate` accepted, future `businessDate` rejected — in the same file, so the distinction
is documented in code.

**Files.** `packages/shared/src/orders.ts:120` · `packages/shared/src/dates.ts:118-134` ·
`packages/shared/src/dates.test.ts` · `apps/web/src/components/orders/QuoteOrderForm.tsx:190-200` ·
`docs/system-design-knowledge-base/03-domain-model.md` (order rules) ·
`docs/development/acuerdos-prueba-usuario-1.md` §A-6.

**Rules.** D-1, D-4 (one schema for route, form and future AI tool), D-6.

---

#### 4.3.2 · KOK-178 · The orders board must filter by business date

**Area** backend · **Size** S · **🧠** 4 · **Closes** F-47 · **Depends on** —

**Why.** Owner, Issue #44 §B-1, marked blocking: *"Después de registrar el pedido, el formulario se
cierra pero nada aparece en la columna cotizando ni en ninguna otra columna."*
`listOrders` (`core/orders/index.ts:1305-1308`) bounds a UTC `created_at` with
`` `${fromDate}T00:00:00.000Z` `` and `` `${toDate}T23:59:59.999Z` ``, while `fromDate`/`toDate` come from
`getDefaultDateRange()` as **La Paz** calendar dates. From 20:00 La Paz onwards, `created_at` lands on
the next UTC day and the order falls out of its own default filter. She reported it at 00:01 La Paz.

This is the only place in `apps/worker/src` that does this — `grep` for `T23:59:59.999Z` returns
exactly these two lines — because `custom_orders` is the one listed entity with **no `business_date`
column** (it is not a kardex event, so INV-3 never gave it one).

**What to build.**

1. **A shared helper in `packages/shared/src/dates.ts`**, e.g.
   `businessDateRangeToUtcWindow(fromDate, toDate, timezone = DEFAULT_TIMEZONE)`, returning the
   `{ startInclusive, endExclusive }` UTC instants that bound those local days. Build it from the
   existing `fromDatetimeLocal`/`toDatetimeLocal` Intl machinery — **no hardcoded offset**, per
   `dates.ts`'s own docstring and Doc 02 §5's configurable timezone.
2. Use it in `listOrders`, with a **half-open** upper bound (`< endExclusive`) rather than
   `23:59:59.999`, so no millisecond can fall between the two clauses.
3. A unit test for the helper covering the La Paz evening case explicitly (an instant at 20:30 local
   must be inside *that* local day's window), plus a `listOrders` test that creates an order with a
   `created_at` in the 20:00–23:59 La Paz band and asserts the default range still returns it.

**Do not** add a `business_date` column to `custom_orders` for this. It would be a migration in
release week to solve a query bug, and the derived value would then need backfilling and keeping
consistent with `created_at` forever.

**Acceptance.** With the system clock at 22:00 La Paz, quoting an order makes it appear on the board
under the default range immediately. The same order still appears the next morning. Existing
`orders.test.ts` cases stay green. No literal `-4`, `04:00` or `23:59:59.999` remains in
`core/orders`.

**Files.** `apps/worker/src/core/orders/index.ts:1300-1315` · `packages/shared/src/dates.ts` (new
helper) + its test · `apps/worker/test/orders.test.ts` ·
`apps/web/src/components/common/DateRangeFilter.tsx:21-24` (context — the caller, unchanged).

**Rules.** D-2, D-10 (Intl, no dependency), INV-3.

---

#### 4.3.3 · KOK-179 · Production edit mode must recompute like create mode

**Area** web · **Size** S · **🧠** 3 · **Closes** F-31 · **Depends on** —

**Why.** Owner, Issue #44 §B-2: *"En modo edición, si cambio las tandas, la cantidad de salida y los
ingredientes no modificados no se actualizan como deberían, F-31 es real."* This is the only finding
in this revision that can persist a wrong number: change 1 tanda to 3, nothing moves, save, and the
run records 3 batches against one batch of consumption — feeding C-4, WAC and every margin above it.

**The two causes, both in `ProductionRunForm.tsx`:**

1. **Key mismatch.** Edit seeding builds `lineKey: `saved-production-line-${index}`` (`:116`). The
   recompute path looks lines up in `recipeLinesById`, keyed by `recipe.lines[].id` (`:263`) — the
   same key create mode assigns at `:255`. `recipeLinesById.get(line.lineKey)` therefore always
   misses, the `if (!recipeLine || …) return line` guard at `:287-290` returns every line untouched,
   and no ingredient is ever recomputed.
2. **Output quantity force-marked dirty.** `:220` sets `actualOutputQtyDirtyRef.current = true` during
   edit seeding; `:278` treats that as "the owner typed this" and refuses to update it.

**What to build.**

1. **Key saved lines by their recipe line id** when the saved consumption corresponds to one, falling
   back to a synthetic key only for lines that genuinely have no recipe counterpart (an ingredient
   she added by hand, or a line whose recipe row was since removed). The synthetic fallback must be
   stable across renders and must never collide with a real id.
2. **Seed the dirty refs from reality, not from a constant.** On edit, a line is "dirty" if the saved
   quantity differs from what the recipe would produce at the saved `batches` — same for
   `actualOutputQty` against `expectedYieldQty × batches`. Then a saved run that was never hand-edited
   behaves like a fresh one, and a hand-edited value is still protected.
3. Preserve the existing create-mode contract exactly: a value the owner typed is never overwritten
   (`actualOutputQtyAutoRef`/`lineAutoQtyRef` already encode this; reuse them, do not replace them).

**Acceptance.** Open a saved production run whose quantities match its recipe, change `batches` from
1 to 3: the output quantity and every untouched ingredient line triple. Change one ingredient by
hand, then change `batches` again: that line keeps the hand-entered value and the rest still
recompute. A run edited only in its notes submits byte-identical consumption quantities. Unit tests
cover the edit-mode recompute and the hand-edited-line exception — `ProductionRunForm` has none
today, so these are the first.

**Files.** `apps/web/src/components/production/ProductionRunForm.tsx:105-125, 207-300` · a new
`ProductionRunForm.test.ts` (`PurchaseForm.test.ts` is the in-repo precedent for testing form logic
without a DOM).

**Rules.** D-5 (quantities stay integer milli-units through `qty.ts`), zero new suppressions.

---

#### 4.3.4 · KOK-180 · Give the quantity input room back

**Area** web · **Size** S · **🧠** 2 · **Closes** F-54, F-55 · **Depends on** —

**Why.** Owner, Issue #44 §B-4: *"el campo numérico para cantidad es tan estrecho que no se ve el
número que uno escribe y parece vacío"*, and *"El formulario nuevo envasado no necesita selectores
para unidades."*
`LineEditor.tsx:110-115` fixes the quantity column at `9rem`. When `unitSelector` is passed, that
column must hold an `<Input>` **and** a `<Select className="h-9 w-24 shrink-0 … sm:w-28">`
(`:200-213`) — 112 px of 144 px, before the `gap-1.5`. The input gets the remainder. This is a
regression from KOK-172, which promoted the selector out of `RecipeForm` without widening the column
it moved into.

**What to build.**

1. **Make the quantity column's width depend on whether a unit selector is present.** The grid
   template is already computed per-configuration at `:109-115` — add `unitSelector` to that
   decision rather than hardcoding a single width. Target a number field that comfortably shows five
   significant digits plus a decimal separator at every breakpoint from 390 px up.
2. **Drop `unitSelector` from the Envasado form** (`routes/assemblies.tsx:538-548`). `LineEditor`
   already falls back to displaying the component's canonical unit as a suffix when no selector is
   passed (`:190-197`), which is what that form needs. Keep the selector in `PurchaseForm.tsx:525`,
   `RecipeForm.tsx:452` and `packing-definitions.tsx:292` — the owner asked for it there, in KOK-101.
3. Re-check the mobile stacked layout while you are in the file: below `sm:` the row is
   `flex flex-col` and the selector sits inline with the input on one line — confirm at 390 px that
   the number is still readable there.

**Acceptance.** At 1280 px and 390 px, in both themes, with a unit selector present: typing `1234,567`
into a quantity field shows the whole value. The Envasado form shows each component's unit as text and
no dropdown. Purchases still lets the owner enter Harina as `500 g` or `0,5 kg`, both persisting to
the same canonical milli-unit value. No horizontal scrollbar appears on any of the four forms.
`verify-ui` screenshots attached for purchases and Envasado.

**Files.** `apps/web/src/components/line-editor/LineEditor.tsx:109-115, 177-215` ·
`routes/assemblies.tsx:538-548` · `components/purchases/PurchaseForm.tsx:525` ·
`components/recipes/RecipeForm.tsx:452` · `routes/packing-definitions.tsx:292`.

---

#### 4.3.5 · KOK-182 · Production release readiness and first deploy

**Area** infra · **Size** M · **🧠** 3 · **Closes** F-66 · **Depends on** every other §4.1 task

**Why.** `[env.prod]` (`apps/worker/wrangler.toml`) and `deploy.yml:118-151` describe a production
environment that has never been exercised. The from-scratch migration path is well tested and the
deploy workflow is written — but "written" and "run once successfully" are different states, and the
gap between them is where the owner's first login fails.

**What to build — a rehearsal, then the run.**

1. **Rehearse on a throwaway D1.** Create a scratch database, apply all 23 migrations with
   `wrangler d1 migrations apply --remote`, point a scratch Worker at it, set the two secrets, and log
   in. Record the exact command sequence and every surprise. Delete the scratch resources afterwards.
2. **Set the production secrets** (`wrangler secret put --env prod`): `SESSION_SECRET` and
   `OWNER_PASSWORD_HASH` (`apps/worker/src/env.ts:17-24`; consumed at `api/auth.ts:39` and
   `middleware/auth.ts:40`). Generate the hash with the project's own helper
   (`apps/worker/src/auth/password.ts:52`), never by hand. The Phase 4 secrets
   (`TELEGRAM_*`, `OPENAI_API_KEY`) are **not** needed for this release — confirm that no startup path
   dereferences them, and if one does, that is a bug to fix here.
3. **Confirm the `production` GitHub Environment has its required reviewer configured.** The workflow
   comment at `deploy.yml:122-124` asserts it; verify it in repo settings rather than trusting the
   comment.
4. **Guarantee production is never seeded from the fixture.** `seed-fixtures.sql` is dev/staging demo
   data — including the Kéfir and Desayuno Kokoro examples. Verify no prod script or workflow step
   can reach it, and if `db:reset:staging` can be pointed at prod by an env var, close that door.
5. **Deploy**, then walk **§6 Section D** end to end with the owner: onboarding wizard on her real
   catalog, opening balances, initial counts, then one real purchase, one real production run, one
   real sale.
6. **Write the rollback down before you need it.** `wrangler rollback --env prod` reverts the Worker;
   it does **not** revert a migration. Record what "undo" means for each of the two, and where the
   first backup lands.

**Acceptance.** The owner logs in to the production URL with her own password, completes onboarding on
her own data, and records one purchase, one production run and one sale that appear correctly in
Finanzas and Inventario. The rehearsal notes and the release procedure are committed under
`docs/development/`. Staging remains independently usable — the release must not take it down.

**Rules.** D-6 (the procedure is documentation and ships with the change). **Guardrail:** applied
migrations are frozen; if one fails against prod, fix forward with a new migration, never by editing
`0001`…`0023`.

---

#### 4.3.6 · KOK-183 · Per-environment PWA identity, and hide the controls that do nothing

**Area** web · **Size** S · **🧠** 2 · **Closes** F-61, F-67 · **Depends on** —

**Why.** Owner, Issue #44 §C-7: *"el nombre es Kokoro tanto para el ambiente staging como para
producción, debería diferenciarse con QA-Kokoro para staging."*
`apps/web/public/manifest.webmanifest` is a static file with a single `name`/`short_name`. Today that
is harmless because only staging exists. The moment production ships, she has two identical icons on
one phone, one of which holds her real money. This is cheap now and irreversible-feeling later —
renaming an installed PWA does not reliably update the icon a user has already placed on a home
screen.

**What to build.**

1. **Template the manifest at build time** from the deploy environment: production stays "Kokoro
   Management" / "Kokoro"; staging becomes "QA-Kokoro". Vite's `import.meta.env` / a define is the
   natural mechanism and adds no dependency (D-10). Include the `<title>` and the theme colour in the
   same treatment if it is free to do so — a visibly different chrome on staging is worth more than
   the name alone.
2. **Confirm `sw.js`'s cache name does not collide across environments.** KOK-162 made it
   build-derived; verify two environments cannot share a cache key, since they are served from
   different origins but installed side by side.
3. **Hide the alerts bell** (`Topbar.tsx:46-55`) — a permanently `disabled` button with no behaviour,
   shipping to a real user. The search box next to it was already hidden for exactly this reason
   (commit `78bb461`); do the same, and leave a comment pointing at KOK-046, which will bring it back.

**Acceptance.** Installing from staging yields "QA-Kokoro"; installing from production yields
"Kokoro". Both can be installed on one device and are visually distinguishable. No disabled,
no-op control remains in the topbar. The PWA still survives a redeploy (do not regress the behaviour
the owner confirmed in §C-7).

**Files.** `apps/web/public/manifest.webmanifest` · `apps/web/vite.config.ts` · `apps/web/index.html` ·
`apps/web/public/sw.js` · `apps/web/src/components/layout/Topbar.tsx:46-55`.

---

### 4.4 P1 — the week after the release, before returning to the backlog


| ID      | Task                                                | Area   | Size | 🧠  | Status   | Description                                                                                                                                                                                                     |
| ------- | --------------------------------------------------- | ------ | ---- | --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KOK-184 | Turn sorting on everywhere, and persist it in the URL | web    | M    | 2   | 📋 To Do | KOK-115's engine is correct and reachable in 2 of 10 tables. Declare `sortable`/`sortValue` across the eight that lack it, move sort state into the URL like KOK-114 did for filters. Closes F-51, F-52, F-21. → §4.6.1 |
| KOK-188 | Sessions UX pass                                    | web    | M    | 2   | 📋 To Do | Five owner findings in one surface: multi-session close menu, calendar as the default view, readable time fields on mobile, a session card that isn't the same colour as the calendar, "registrar sesión pasada" as the default mode. Closes F-60, F-62, F-63, F-64, F-65. → §4.6.4 |
| KOK-185 | Human-readable event codes                          | full   | L    | 4   | 📋 To Do | Per-type dated sequences for session, production, sale, packing, purchase and order, backfilled from `created_at`, surfaced in tables, drawers and pickers. **Reverses KOK-147's recorded decision — amend the KB in the same PR.** Closes F-57. → §4.6.5 |
| KOK-187 | Numeric input constraints + an error that names the field | web | M | 3   | 📋 To Do | The two cheap slices of KOK-143: stop numeric fields accepting letters, and make the submit error identify the line and field it is rejecting. Explicitly **not** the full live-validation task. Closes F-50. → §4.6.6 |
| KOK-189 | Exit form kind filter + Costo invisible placement    | web    | S    | 2   | 📋 To Do | Pick the item kind first, defaulting to producto final, so the picker is searchable; and stop the waste summary card expanding to fill the filter row. Closes F-58, F-59. → §4.6.7                            |
| KOK-190 | Make it visible that a table row opens something     | web    | S    | 2   | 📋 To Do | Every list wires `onRowClick` and none of them says so. Apply KOK-110's pencil/underline affordance at the `EventTable` level so every list inherits it. Closes F-53. → §4.6.8                                 |


---

### 4.5 P2 / P3 — test and documentation integrity, then polish

Unchanged from the previous revision except where noted. **KOK-167 is the one to schedule first**: the
team returns to `10-implementation-backlog.md` straight after this batch, and that file currently
disagrees with reality about eighteen delivered tasks.


| ID      | Task                                        | Area   | Size | 🧠  | Status   | Description                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------- | ------ | ---- | --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KOK-167 | Reconcile status records — **partly done, now narrowed** | docs | S | 2 | 📋 To Do | ✅ **Already done (2026-08-18):** KOK-132 restored to ✅ and KOK-140/142 corrected in the backlog; KOK-138/141/143/144/147 amended in place; Phase 3.2's go-live paragraph updated. **Remaining:** drop "implementation pending" from O-6 and S-5 in Doc 03; regenerate Drizzle `_journal.json` for 0017–0023; correct §A-1 point 15 to KOK-050/Phase 5. **Explicitly out of scope:** adding KOK-155…190 to the backlog — that file is the plan, this one is the pre-MVP fix list. Closes F-15, F-16, F-23, §3.7. |
| KOK-165 | e2e for the three new verticals + PR gate   | web    | M    | 3   | 📋 To Do | Session start/close from the header, record an Envasado, order confirm → deliver → undo. **Run Playwright in the PR gate**, not only post-deploy. Add F-46, F-47 and F-31 as regression specs — all three were reachable by a browser test and none existed. Closes F-14. |
| KOK-166 | Close the service/UI test gap               | full   | M    | 3   | 📋 To Do | Route tests for `api/assemblies.ts` and `api/assembly-definitions.ts`; a test driving `assertOrderLinkable` through the production/assembly commands; pure-logic tests for `OrderPicker`, `WeeklyCalendar` and the assembly cost math. Closes F-14. |
| KOK-168 | Make `dates.ts` genuinely the single source | shared | S    | 3   | 📋 To Do | `finance.ts`, `sessions.ts`, `counts.ts` and `inventory-views.ts` redeclare the date schemas **without** the future-date refinement. **Fold KOK-177's `calendarDateSchema` split into this** so the module ends with one documented vocabulary. Closes F-17. |
| KOK-169 | Copy and consistency batch                  | full   | M    | 2   | 📋 To Do | F-18, F-24, F-26, F-27, F-28, F-29 — one PR, no behaviour change. **Plus (§3.5):** one line above the exit form's packaging section explaining why it appeared — this item leaves unpackaged, so add the packaging actually used. The gate is correct; only its silence confused the owner. |
| KOK-170 | `window.confirm` → app `Dialog`             | web    | S    | 2   | 📋 To Do | Three native pop-ups in `OrderDetailDrawer.tsx:202,214,235,260`. Closes F-19.                                                                                                                                                                  |
| KOK-171 | One product call to make with the owner — **narrowed** | — | S | 1  | 📋 To Do | Only F-22 remains: offline notice as toast vs. dialog (A-9 says dialog). **F-30 is answered — she does not want Sesiones as a mobile tab.**                                                                                                     |


---

### 4.6 P1 — detail cards

#### 4.6.1 · KOK-184 · Turn sorting on everywhere, and persist it

**Area** web · **Size** M · **🧠** 2 · **Closes** F-51, F-52, F-21 · **Depends on** —

**Why.** Owner, Issue #44 §B-4, listing table by table: Ventas, Producción, Compras, Inventario,
Salidas, Conteos, Finanzas and Catálogo have no sorting; Envasado does and it works. She is describing
an opt-in that was opted into twice. `EventTable` requires `sortable: true` **and** a `sortValue`
accessor per column (`:47-49`); a repo-wide grep finds them in `routes/packing.tsx` and
`routes/packing-definitions.tsx` only — both written for KOK-156, after KOK-115 shipped the engine.
She also noticed the sort resets on reload, while KOK-114 deliberately put date range, filters and
active tab in the URL.

**What to build.**

1. **Declare `sortable` + `sortValue` on the columns that deserve them** in every list: Ventas,
   Producción, Compras, Salidas, Conteos, Finanzas, Catálogo and the Inventario stock table. Sort on
   the underlying value, never the formatted string — dates as ISO strings, money and quantities as
   their integer scale, so `numeric: true` compares numbers rather than "Bs 1.234,50".
   **Pedidos is deliberately excluded**: it is a status board, and the owner said so herself.
2. **Lift sort state into the URL**, alongside KOK-114's existing search params, so a reload or a
   shared link restores it. Keep the agreed cycle (asc → desc → natural) and the one-active-column
   rule; this is where they live, not a new behaviour.
3. **Add the sorting-scope copy A-10 asked for** (F-21): sorting orders the rows already loaded
   (200–500), not the whole table. One short line near the table, not a tooltip on every header.

**Acceptance.** Every list except Pedidos sorts on at least its date, its main text column and its
principal numeric column. Sorting Ventas by total puts Bs 1.234,50 above Bs 999,00. Reloading the page
keeps the sort. Sorting a second column clears the first. Keyboard operation (Tab + Enter) works on
every newly sortable header, with `aria-sort` correct.

**Files.** `apps/web/src/components/data-table/EventTable.tsx:69-107` · `components/sales/SalesTable.tsx` ·
`components/production/ProductionRunsTable.tsx` · `components/purchases/PurchasesTable.tsx` ·
`routes/inventory.tsx` · `routes/finance.tsx` · `routes/settings-catalog.tsx` ·
`routes/packing.tsx` (the reference implementation) · the route search-param schemas in `router.tsx`.

---

#### 4.6.2 · KOK-181 · Envasado should ask for real output, not planned

**Area** web · **Size** S · **🧠** 3 · **Closes** F-56 · **Depends on** —

**Why.** Owner, Issue #44 §B-4: *"El campo salida planificada es inútil, solo debería existir salida
real y pre-llenarse con el dato de salida planificada por defecto."*
`routes/assemblies.tsx:479-493` shows a `plannedOutputQty` input, prefilled from `definition.outputQty`
(`:187`), while `actualOutputQty` (`:495-513`) starts empty. She is shown the number she did not
choose and asked for the one she must type.

**What to build.** Remove the planned-output **input**, keep submitting `plannedOutputQty` from the
selected definition, and prefill `actualOutputQty` with the same value so the common case is a
confirmation and the exception is one edit. Show the planned figure as read-only context next to the
actual field so a discrepancy is visible.

**Do not delete `plannedOutputQty` from the command or the schema.** Planned-vs-actual is the
breakage/spillage signal C-10 depends on — Doc 03's own example is "9 usable bottles out of 10
planned absorb 100% of the cost". Removing the data would remove the yield metric, not just a field.

**Acceptance.** Selecting a definition prefills the real-output field; saving without touching it
records planned == actual. Typing a smaller real output records the difference and the unit cost rises
accordingly (assert the existing golden number still holds). Manual mode, with no definition, is
unchanged. Editing a saved Envasado still shows both stored values.

**Files.** `apps/web/src/routes/assemblies.tsx:150-190, 300-350, 479-513` · `lib/i18n-assemblies.ts`.

---

#### 4.6.3 · KOK-186 · OrderPicker must show the order description

**Area** web · **Size** S · **🧠** 1 · **Closes** F-48 · **Depends on** —

**Why.** Owner, Issue #44 §B-2: *"si hay dos pedidos del mismo cliente y la misma fecha, no se sabe
cómo diferenciarlos. Mejor agregar también la descripción del pedido."*
`OrderPicker.tsx:87-95` renders customer name over delivery date. `description` is already on the DTO
and is already matched by the search filter (`:45-49`) — it is only missing from the render, in both
the option list and the collapsed selected value (`:52-54`).

**What to build.** Add the description to each option (truncated, one line, below or beside the
delivery date) and to the collapsed value, so the selected order stays identifiable after the list
closes. Once KOK-185 lands, show the order's code here too — leave the layout able to take it.

**Acceptance.** Two orders from the same customer with the same delivery date are distinguishable in
the list and after selection. Long descriptions truncate rather than widening the control. The
existing `useOrder(id)` resolution of an out-of-list selection still works.

**Files.** `apps/web/src/components/orders/OrderPicker.tsx:44-56, 84-98` · `lib/i18n-orders.ts`.

---

#### 4.6.4 · KOK-188 · Sessions UX pass

**Area** web · **Size** M · **🧠** 2 · **Closes** F-60, F-62, F-63, F-64, F-65 · **Depends on** —

**Why.** Five separate observations from Issue #44 §C-0 and §C-8, all in one surface, all cheap
individually and coherent together: sessions are what she touches first every day, from her phone.

**What to build.**

1. **Close any open session from the chip** (F-60). `SessionChip` already has the right popover for
   the single-session case (`:103-136`); the multi-session branch (`:84-96`) just navigates. Extend
   the existing popover to list every open session — type, elapsed time, close action — instead of
   adding a second control. Keep the single-session behaviour identical.
2. **Default `/sessions` to the calendar** (F-62). `routes/sessions.tsx:50` — change the fallback, not
   the mechanism; the toggle and the `view` search param already exist and must keep working.
3. **Differentiate the session card** (F-63). `WeeklyCalendar.tsx:145` is `bg-card` on `bg-card` cells
   (`:262`). Give the card its own surface — a filled tint, ideally keyed to session type so the week
   is readable at a glance — and verify contrast in **both** themes against KOK-151's tokens rather
   than picking a colour by eye. Do not reintroduce shadow as the depth cue in dark mode; KOK-151
   established that it cannot carry it.
4. **Default the create form to "registrar sesión pasada"** (F-64). `SessionForm.tsx:185`. Starting a
   session is now a header action, so the full form is mostly used for the past. Edit mode is
   unaffected.
5. **Stack the time fields on mobile** (F-65). `SessionForm.tsx:429` is an unconditional
   `grid grid-cols-2 gap-3` around two `datetime-local` inputs; make it stack below `sm:` and stay
   side by side above, matching the pattern already used at `:531` and `:548`.

**Acceptance.** With two sessions open, tapping the chip lists both and closes either in one further
tap. `/sessions` opens on the week. A session card is clearly distinguishable from the calendar in
both themes (contrast checked, not eyeballed). Opening "Nueva sesión" lands on the past-session mode.
At 390 px both time fields are fully readable and editable. `verify-ui` pass at 390 px and 1280 px in
both themes.

**Files.** `apps/web/src/components/sessions/SessionChip.tsx:84-136` ·
`components/sessions/WeeklyCalendar.tsx:145-165, 260-265` ·
`components/sessions/SessionForm.tsx:185, 425-470` · `routes/sessions.tsx:50` ·
`lib/i18n-sessions.ts` · `apps/web/src/styles/globals.css` (tokens, if a new surface is needed).

---

#### 4.6.5 · KOK-185 · Human-readable event codes

**Area** full · **Size** L · **🧠** 4 · **Closes** F-57 · **Depends on** — · **Reverses** KOK-147's recorded decision

**Why.** Owner, Issue #44 §B-4: *"Creo que será de mucha utilidad crear un código identificador
humanamente comprensible de cada sesión, producción, venta, envasado, compra y pedido."*
She reached this after seeing `routes/packing.tsx:101-106` render every session as the bare word
"Producción". The backlog currently records the opposite decision, in KOK-147: *"no internal IDs are
exposed — events have no short human code and the internal ones are unreadable UUIDs, and inventing a
code system was rejected as unnecessary."* That was decided before she used the app. **She is right
and the earlier call was wrong** — a person cannot refer to, search for, or talk about an event that
has no name.

**Why it is P1 and not P0.** A per-type dated sequence backfills deterministically from `created_at`,
so waiting a week costs a slightly longer backfill script, not correctness. But it gets more expensive
every week, so it should be the first substantial task after the release.

**What to build.**

1. **Decide the format once and write it into the KB** (D-1/D-6): a short type prefix plus a
   year-scoped sequence — `VTA-2026-0912`, `PRD-2026-0184`, `CMP-`, `ENV-`, `PED-`, `SES-`. Spanish
   prefixes, because the code is user-facing (D-9), while column and type names stay English.
2. **Migration + generation.** A `code` column per event table, unique per type, assigned **inside the
   existing atomic batch** (D-3) so an event can never exist without one. Sequence allocation must be
   safe under D1's execution model — settle this explicitly rather than assuming, and write the
   reasoning into the migration's header comment.
3. **Backfill** existing rows deterministically ordered by `created_at`, so dev, staging and
   production all produce the same codes from the same data.
4. **Surface it**: the code column in every `EventTable`, the code in every detail drawer's header,
   the code in `OrderPicker` and the session pickers, and the code as a search term wherever a picker
   already searches. Fix `routes/packing.tsx:101-106`'s session cell as part of this — a session shows
   its code and its type, not the type alone.
5. **Amend KOK-147 and Doc 07** in the same PR. KOK-147's premise ("no short human code exists") stops
   being true; its own deliverable — a readable source-event label in Finanzas — gets easier, and its
   row must say so instead of contradicting this one.

**Acceptance.** Every session, production run, sale, packing, purchase and order created after this
task carries a unique, stable, human-pronounceable code, visible in its list and its drawer.
Pre-existing rows have codes after the backfill, identical across a re-run. The owner can find an event
by typing its code into the relevant picker. No UUID becomes newly visible anywhere. The KB records
both the format and the reversal, with a pointer to Issue #44.

**Rules.** D-1, D-2, D-3, D-4, D-6, D-8, D-9.

---

#### 4.6.6 · KOK-187 · Numeric input constraints and an error that names the field

**Area** web · **Size** M · **🧠** 3 · **Closes** F-50 · **Depends on** — · **Feeds** KOK-143

**Why.** Owner, Issue #44 §B-3: *"Si escribo letras dentro del campo numérico cantidad, nada pasa, no
aparece ninguna advertencia… Solo al hacer submit me aparece el mensaje 'Cada línea necesita un ítem,
una cantidad y un precio unitario válidos.' Cuando los datos de los ítems de venta están correctos
pero el campo notas tiene demasiados caracteres, aún así se muestra el mismo mensaje."*
`LineEditor.tsx:181-188` uses `inputMode="decimal"` — a keyboard hint, not a constraint — so letters
enter state and fail silently at parse time. `SaleForm.tsx:379-383` then returns one generic
`invalidLine` message for any unparseable row and stops, so a left-over blank line produces a
complaint about "cada línea" that names neither the line nor the field.

**Scope discipline.** This is **not** KOK-143. KOK-143 is the 9–14 day live-validation task (validate
on blur, revalidate after first error, required-field marks, focus the first bad field) and it keeps
its place in Block D. This task takes the two slices that are small, independent and worth having now.

**What to build.**

1. **Constrain numeric entry at the source.** In `LineEditor` and the other decimal inputs
   (quantities, amounts, batches, output quantities), reject characters that cannot form a decimal as
   they are typed — accepting both comma and point as the separator, per the app's existing
   convention. Do this in one shared input primitive, not per form, so KOK-143 inherits it rather than
   redoing it.
2. **Make the submit error identify its target.** Report which line number and which field failed, and
   distinguish "this row is incomplete" from "this row has an invalid value". Where a trailing row is
   entirely empty, treat it as absent rather than invalid — it is the row the owner never intended to
   fill, and rejecting the whole form over it is the behaviour she called *"un horror"* in the
   previous test.
3. **Show remaining characters on capped free-text fields** once they approach the limit. KOK-159
   already derives `maxLength` from the shared `safeText(N)` bound; this only surfaces it.

**Acceptance.** Typing letters into any quantity or amount field produces nothing in the field.
Submitting a sale with a valid line and a stray blank row succeeds. Submitting with a genuinely bad
value names the line and the field. Pasting a long note shows how much room is left. No shared Zod
schema changes (D-4) — this is a UI layer over the same contract.

**Files.** `apps/web/src/components/ui/input.tsx` (or a new numeric input primitive) ·
`components/line-editor/LineEditor.tsx:177-215` · `components/sales/SaleForm.tsx:370-395` ·
`components/purchases/PurchaseForm.tsx` · `lib/i18n-sales.ts:96`, `lib/i18n-purchases.ts:73`.

---

#### 4.6.7 · KOK-189 · Exit form kind filter, and the Costo invisible card

**Area** web · **Size** S · **🧠** 2 · **Closes** F-58, F-59 · **Depends on** —

**Why.** Two independent Issue #44 §B-5 observations in the same screen.
*"Sería más útil seleccionar primero el tipo del ítem (por defecto en producto final) y así facilitar
la búsqueda en el select."* — `ExitForm.tsx:367-373` passes only `eligibility={{ isUnmetered: false }}`,
so every metered item in the catalog is in one list.
*"El costo invisible del periodo está en línea con los filtros de fecha y el botón, pero al ser un card
muy grande se ve muy feo."* — `routes/inventory.tsx:225-227` puts `DateRangeFilter` and
`WasteSummaryCard` in one `justify-between` row, and the card declares `flex-1`
(`WasteSummaryCard.tsx:25`), so a summary expands to the width of a toolbar and sits at a control's
level.

**What to build.**

1. A kind selector in front of the exit item picker, defaulting to `FINISHED`, passed through as
   `kindFilter` alongside the existing eligibility. Keep the "todos" option — she gifts raw materials
   too. Do **not** touch the server guards (D-2): this is a search aid.
2. Move the waste summary out of the filter row and give it its own width. Drop `flex-1`, place it
   where a summary belongs relative to the table, and check the other `flex-1` cards in the same
   screen for the same mistake.

**Acceptance.** Recording an exit of a finished product takes fewer keystrokes than today and Agua is
still unselectable. The waste card no longer stretches to fill the filter row, and the Salidas tab
reads as a coherent screen at 1280 px and 390 px in both themes.

**Files.** `apps/web/src/components/inventory/ExitForm.tsx:360-380` ·
`components/inventory/WasteSummaryCard.tsx:25` · `routes/inventory.tsx:224-230` ·
`lib/i18n-inventory.ts`.

---

#### 4.6.8 · KOK-190 · Make it visible that a table row opens something

**Area** web · **Size** S · **🧠** 2 · **Closes** F-53 · **Depends on** —

**Why.** Owner, Issue #44 §B-4, on Producción: *"también debería mostrar un lápiz y un subrayado en el
nombre de la receta para mostrar que así se entra al modo editar."*
`EventTable` accepts `onRowClick` (`:56`) and every list route passes one, but nothing in the row says
so. KOK-110 already introduced exactly this affordance — pencil icon plus an explicit title — in the
catalog drawer, so the pattern is established and is hers.

**What to build.** Add the affordance at the `EventTable` level so every list inherits it rather than
each route reinventing it: mark one column per table as the identifying column, underline it, show a
pencil on hover/focus, and set the row's cursor. Keep the whole row clickable — do not shrink the hit
target to the icon. Preserve keyboard access and make sure the affordance does not read as a link to
somewhere else.

**Acceptance.** Every list makes it obvious which cell opens the record, at desktop and at 390 px
(where hover does not exist — the affordance must be visible without it). Keyboard focus reaches the
row and Enter opens it. No route declares its own version of this.

**Files.** `apps/web/src/components/data-table/EventTable.tsx` and every consumer that passes
`onRowClick` · `components/catalog/` (KOK-110's precedent).

---

## 5. Process observations

These caused more of the findings above than any individual coding mistake.

1. **Work is being marked Done without the "Done" definition being met.** ✅ **Largely answered.**
   Definition-of-Done item 5 (deployed to staging, smoke-tested) is now routinely met — the P0/P1
   batch shipped through staging and the owner tested it there. Keep it.
2. **`full`-area tasks were shipping backend-only.** ✅ **Answered by KOK-156.** The guard proposed in
   the last revision held: a `full` task is not Done until a named screen is reachable from the
   navigation by someone who was not told the URL.
3. **The agreements doc and the backlog have drifted — and the gap has grown.** The backlog now
   disagrees with reality about eighteen delivered tasks and does not contain KOK-155…190 at all.
   Because the team returns to that file immediately after this batch, KOK-167 is no longer
   housekeeping — it is a prerequisite for the next phase being planned against true information.
4. **Long-lived local work is a real risk.** ✅ **Answered.** Push per task, not per block.
5. **Self-reports are optimistic in a specific, predictable way.** Still true. Ask each block report
   to state explicitly what it **did not** verify.
6. **Source review cannot substitute for the owner using the app.** ✅ **Re-confirmed, twice over.**
   Section A found fourteen defects a thorough source review had missed. Sections B and C found
   twenty more — including two blockers whose causes (a schema reused one field too far, and a UTC
   instant compared against a local calendar date) are invisible in any single file and only appear
   when a real person uses the app at 20:00 on a Tuesday. **The owner-led pass is a standing gate at
   the end of every block, not a favour she does us.**
7. **We specified the fix before we built the problem.** ✅ **Answered for forms** (KOK-140 landed).
   Worth keeping as a check: when the KB already answers a design question, building the other thing
   first is the same work done twice.
8. **New: a capability with no consumers is not delivered.** KOK-115 built a correct, well-tested,
   accessible sorting engine and two of ten tables switched it on — for six weeks, while the owner
   asked for sorting. KOK-135 shipped a correct interval-union primitive with zero call sites. The
   pattern is the same both times: the hard part was built, the last cheap step was left to a caller
   who never came. **A task that adds an opt-in capability must name and convert its consumers in the
   same PR, or explicitly ticket them.**
9. **New: shared refinements travel further than the rule that justified them.** F-46 is a correct
   business rule applied to a field it was never meant for, purely because the schema was the
   convenient one to import. When a Zod refinement encodes a *domain* rule rather than a *format*
   rule, name it for the rule (`businessDateSchema`) and give the plain format its own export — so
   reaching for the wrong one is visible at the call site. KOK-168 should finish this vocabulary.
10. **New: environment-dependent values must be environment-dependent from the first one.** The PWA
    manifest was correct for as long as one environment existed, and became wrong the moment a second
    one did — discovered by the owner, not by us. Same shape as F-47: both are "correct until the
    world has two of something".

---

## 6. Manual UI verification

**Sections A, B and C are complete.** Section A was run by the owner on 2026-08-16 (Issue #30);
Sections B and C on 2026-08-18 (Issue #44). All results are folded into §2 and §3. Section D below is
new and is the only outstanding pass.

### Confirmed working (do not re-test)

- **By the reviewer (2026-08-14):** starting a session from the header; closing the previous session
  and starting a new one of the same type in one step; concurrent sessions of different types.
- **By the owner (2026-08-16, Issue #30):** all of §6 Section A. Also: the close-session form and the
  count form both **preserve** input across a drawer close; sticky headers work in the weekly calendar.
- **By the owner (2026-08-18, Issue #44):** dark mode and calendar icons in both themes; the installed
  PWA surviving a redeploy; every copy check; the per-ingredient stock indicator; create-mode batch
  recompute; Envasado's column sorting; stock exits refusing Agua; the order picker rendering and
  resolving its selection.

### D. Production release verification — to run with the owner, on production

Run once, on the real environment, with real data. Stop at the first failure and fix forward.

1. **First login.** Reach the production URL, log in with the owner's real password. A 500 here means
   a missing secret (KOK-182 step 2), not a code bug.
2. **Onboarding on real data.** Complete the wizard with her actual catalog, opening balances and
   initial counts. Confirm no fixture item ("Desayuno Kokoro", "Kéfir natural 1 L", Agua at the demo
   price) is present anywhere.
3. **One real purchase**, in a real session, with a real supplier and real amounts. Confirm the
   account balance moves by exactly the pinned-footer total, and the kardex shows `PURCHASE_IN`.
4. **One real production run**, then **edit it and change the batches** — the F-31 regression check, on
   production, once.
5. **One real order, end to end:** quote with a **future delivery date** (F-46), confirm it appears on
   the board **the same evening** (F-47), then confirm → en producción → listo → entregar.
6. **One real sale** and one collection. Confirm Finanzas and the receivable agree.
7. **Install the PWA from production** alongside the staging one and confirm they are distinguishable
   (F-61).
8. **Backups.** Confirm the first scheduled backup lands in the prod R2 bucket, and that restoring it
   is a procedure someone has actually read.

### Deferred to the next owner session

- **F-22** — offline notice as toast vs. dialog (A-9 says dialog). Not exercised in any pass. This is
  now the **only** open item from the three owner-led passes.

---

## 7. Method and coverage


| Area                                          | How verified                                                                                | Confidence                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Costing, replay, WAC, cycle detection, C-3d   | Source read + test read + golden-number assertions                                          | High                                         |
| Sessions domain (KOK-130…135)                 | Source + migration + tests                                                                  | High                                         |
| Orders domain (KOK-136…139)                   | Source + full state-machine matrix test                                                     | High                                         |
| Orders **list/filter** layer                  | Source read this revision — **found F-47, which no test covered**                            | High (now)                                   |
| Block A/B/C items                             | Source read, item by item                                                                   | High                                         |
| Repo health (2026-08-18, `f273f54`)           | `pnpm run test` — **1021/1021 passing** (worker 773/59 files, shared 158/15, web 90/15)     | High                                         |
| Every finding F-46…F-67                       | Reproduced in the source before being written down; file and line cited on each             | High                                         |
| Fixtures                                      | Source read + independent re-verification                                                   | High                                         |
| Docs/KB/backlog consistency                   | Source + `git log`/`git show` — **backlog is known stale, see §3.7**                          | High                                         |
| Pipeline state, staging                       | `git rev-list`, `gh pr list`, `deploy.yml`, PRs #31–#45                                     | High                                         |
| Migration safety on non-empty DBs             | PR #25–#27 narratives + a real staging run                                                  | Medium — verified once, against one database |
| **Browser behaviour, Sections A, B and C**    | **Owner-led passes, 2026-08-16 and 2026-08-18 (Issues #30, #44)**                            | **High**                                     |
| **Production environment**                    | **Never exercised — no deploy, no migration run, no login**                                  | **None — see KOK-182 and §6 D**              |
| Pixel-level alignment                         | Not verifiable statically                                                                   | None                                         |


**Commands run for this revision (read-only):** `pnpm run test` (1021/1021 green across three
packages), `gh issue view 44`, `gh issue list`, `gh pr list --state all`, `git log`,
`git rev-list --left-right --count origin/main...origin/develop`, and targeted `grep`/source reads
across `apps/web`, `apps/worker`, `packages/shared`, `.github/workflows` and the KB. No source file
was modified during this review.

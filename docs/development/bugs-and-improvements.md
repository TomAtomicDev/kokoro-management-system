# Bugs & Improvements — Onboarding (GH #4)

Triage of [GitHub issue #4 — "Problemas y mejoras durante el onboarding"](https://github.com/TomAtomicDev/kokoro-management-system/issues/4),
reported by the owner after walking the first-run wizard end to end.

This document is a **triage register**, not a backlog. Items here are findings with a verified root
cause and a proposed fix; once accepted they get promoted to a `KOK-xxx` row in
[Doc 10 — Implementation Backlog](../system-design-knowledge-base/10-implementation-backlog.md) and
this file records the mapping.

**Source scope:** `apps/web/src/routes/onboarding.tsx`, `apps/web/src/components/onboarding/*`,
`apps/web/src/features/onboarding/api.ts`, `apps/web/src/lib/i18n-onboarding.ts`,
`apps/worker/src/api/onboarding.ts`, `packages/shared/src/onboarding.ts` (~1,070 LOC total,
shipped under KOK-020).

---

## Legend

**Type**

| Type            | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| 🐞 Bug          | Behaves incorrectly against a stated rule or produces wrong data     |
| 🧭 UX           | Works as coded, but misleads or obstructs the owner                  |
| ✨ Enhancement  | New capability the wizard does not have                              |

**Feasibility** — how much is already decided before code can start.

| Feasibility     | Meaning                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| 🟢 Direct       | Self-contained; no KB amendment, no schema change. Spec is complete as written.               |
| 🟢 Decided      | Needed a product call; the call has been made (see [Resolved decisions](#resolved-decisions)). Ready to build, KB amendment included in the task. |
| 🟡 Needs a call | Requires a product decision or a KB amendment (D-1/D-6) shipped in the same PR.               |
| 🔴 Design first | Business rule does not exist yet; needs a written design/KB section before any code.          |

**Refactor size** — blast radius, not just typing time. Follows Doc 10's sizing (S ≤ half day ·
M ≤ 1.5 days · L ≤ 3 days), plus XS for a contained one-file edit.

| Size | Meaning                                                                             |
| ---- | ------------------------------------------------------------------------------------ |
| XS   | One file, no contract change                                                        |
| S    | One layer (web **or** worker), no migration                                         |
| M    | Crosses `packages/shared` → worker → web, or adds a migration                       |
| L    | New table/contract, touches costing or the kardex, or restructures the whole wizard |

**Importance**

| Level | Meaning                                                                                      |
| ----- | ---------------------------------------------------------------------------------------------- |
| P0    | Corrupts data or violates an invariant. Fix before the wizard is used on real data.           |
| P1    | Blocks the owner from completing onboarding correctly, or forces a wrong entry.               |
| P2    | Real friction; the owner can work around it but shouldn't have to.                             |
| P3    | Polish.                                                                                       |

**🧠** — required intelligence tier, same 1–5 scale as Doc 10.

**Status** — 📋 To Do · 🔨 In Progress · 👀 In Review · ✅ Done · 🚫 Blocked · ⏭️ Deferred

---

## Register

Feasibility reflects the decisions recorded in [Resolved decisions](#resolved-decisions) (2026-08-02).

| ID     | Finding                                                   | Area     | Type | Feasibility     | Size | 🧠  | Importance | Status  | KOK  |
| ------ | ---------------------------------------------------------- | -------- | ---- | --------------- | ---- | --- | ---------- | ------- | ---- |
| BI-01  | Opening count writes stock in at unit cost 0               | count    | 🐞   | 🟢 Decided      | M    | 5   | **P0**     | ✅ Done | KOK-084 |
| BI-02  | No initial unit cost captured for opening stock            | count    | ✨   | 🟢 Decided      | M    | 5   | **P0**     | ✅ Done | KOK-084 |
| BI-03  | Money field rejects 3 decimals with a misleading message   | balances | 🐞   | 🟢 Decided      | S    | 3   | P1         | 📋 To Do | KOK-094 |
| BI-04  | Catalog row errors always report "monto inválido"          | catalog  | 🐞   | 🟢 Direct       | S    | 3   | P1         | 📋 To Do | KOK-095 |
| BI-05  | No way to add a row to the initial catalog                 | catalog  | 🐞   | 🟢 Direct       | XS   | 2   | P1         | ✅ Done | KOK-089 |
| BI-06  | Catalog validation ignores kind-conditional required rules | catalog  | 🧭   | 🟢 Decided      | M    | 4   | P1         | 📋 To Do | KOK-096 |
| BI-07  | No way to go back a step                                   | flow     | 🧭   | 🟢 Direct       | S    | 3   | P1         | ✅ Done | KOK-093 |
| BI-08  | Re-entering `/onboarding` after completion is unguarded    | flow     | 🐞   | 🟢 Direct       | S    | 2   | P1         | ✅ Done | KOK-091 |
| BI-09  | Missing `PASTRY` category                                  | catalog  | ✨   | 🟢 Decided      | M    | 3   | P2         | 📋 To Do | KOK-097 |
| BI-10  | Missing `M` unit                                           | catalog  | ✨   | 🟢 Decided      | M    | 3   | P2         | 📋 To Do | KOK-097 |
| BI-11  | Owner-managed (create/archive) categories                  | catalog  | ✨   | 🔴 Design first | L    | 4   | P2         | 📋 To Do | —    |
| BI-12  | Seed the three starter recipes                             | recipes  | ✨   | 🟢 Decided      | M    | 3   | P2         | 📋 To Do | KOK-098 |
| BI-15  | "Unmetered" items (Agua) — perpetual negative stock        | catalog  | ✨   | 🔴 Design first | L    | 4   | P2         | 📋 To Do | —    |
| BI-13  | Count table: group rows by item kind                       | count    | 🧭   | 🟢 Direct       | S    | 2   | P2         | 📋 To Do | KOK-092 |
| BI-14  | Count table: drop "Esperado"/"Variación", show the unit    | count    | 🧭   | 🟢 Direct       | XS   | 2   | P2         | 📋 To Do | KOK-088 |
| BI-16  | Catalog table forces horizontal scroll                     | catalog  | 🧭   | 🟢 Direct       | XS   | 2   | P2         | ✅ Done | KOK-087 |
| BI-17  | Catalog header columns misaligned with body columns        | catalog  | 🐞   | 🟢 Direct       | XS   | 1   | P2         | ✅ Done | KOK-085 |
| BI-18  | Decimal separator convention never stated to the owner     | flow     | 🧭   | 🟢 Direct       | XS   | 2   | P2         | ✅ Done | KOK-090 |
| BI-19  | Explain *why* the opening count matters                    | count    | 🧭   | 🟢 Direct       | XS   | 2   | P2         | 📋 To Do | —    |
| BI-20  | Defer all writes to a single "creating your data" commit   | flow     | 🧭   | 🟡 Needs a call | L    | 4   | P3         | 📋 To Do | —    |
| BI-21  | Litre abbreviation "l" reads as digit 1                    | catalog  | 🧭   | 🟢 Direct       | XS   | 1   | P3         | ✅ Done | KOK-086 |
| BI-22  | Magnitude-scaled display units (`0,58 kg` → `580 g`)        | inventory| ✨   | 🔴 Design first | L    | 4   | P2         | 📋 To Do | —    |

> **BI-12 ↔ BI-15 interaction, resolved.** BI-06b makes `minStockQty` mandatory for every
> `RAW_MATERIAL` and BI-12's fixture adds `Agua` as one, which briefly looked unsatisfiable. The
> rule that `0` is a valid minimum settles it: Agua seeds with `minStockQty: 0`. BI-15 therefore
> does **not** block BI-12 and stays P2 — but its underlying problem is unchanged, and it gets
> worse the longer Agua is in the catalog. See BI-15.

---

## Findings

### BI-01 · Opening count writes stock in at unit cost 0 — 🐞 P0

**Reported:** *"Si es que su stock inicial es diferente a 0, será necesario ingresar el costo
unitario inicial obligatoriamente, para que las primeras producciones tengan sumatorias de costos
unitarios correctos."*

**Verified root cause.** The wizard's step 5 reuses the KOK-019 count flow
(`apps/web/src/components/onboarding/StepCount.tsx:44`). On commit,
`apps/worker/src/core/inventory/counts.ts:269` stamps each `ADJUST` movement with
`snapshotUnitCost(currentWac)`. For an item created moments earlier in step 3, `wac_mc` is still its
column default — `apps/worker/src/db/schema.ts:39` (`.notNull().default(0)`). So **every unit of
opening stock enters the kardex valued at zero.**

The owner's phrasing frames this as a missing input. It is worse than that: it is silent cost
corruption that propagates. Zero-cost raw material flows into the first production runs' consumed
cost, into the produced item's WAC, into sale margins, and into the price-health screen. Nothing
surfaces an error — the numbers are simply wrong and look plausible.

**Why this is 🔴, not a quick fix.** There is no business rule in Doc 03 for "opening inventory
valuation". The count flow is specified as a *reconciliation* of quantity against an existing
costed history; it was never meant to be the entry point that establishes cost basis. Options —
seeding cost via the count, via a dedicated opening-balance movement type, or via a synthetic
opening purchase — have materially different consequences for the kardex, for
`core/costing/replay.ts`, and for what a later backdated purchase does. That choice belongs in the
KB before code (D-1).

**Recommended next step:** write the KB amendment (Doc 03 costing rules + Doc 04 §3.3) proposing an
opening-valuation mechanism, and land BI-01/BI-02 together as one task. Property-based test required
(CLAUDE.md, money math).

> ✅ **Decided (Q9, 2026-08-03): a dedicated `OPENING_IN` movement type.** Landed as
> [Doc 03 C-8](../system-design-knowledge-base/03-domain-model.md#4-costing-rules-normative) and the
> `stock_movements` CHECK constraint in
> [Doc 04 §3.4](../system-design-knowledge-base/04-data-model.md). `OPENING_IN` is a WAC entry type
> like `PURCHASE_IN`/`PRODUCTION_IN` — it folds into C-1 and R-2 replay directly, so it doesn't need
> the special-casing an ADJUST-based fix would (rejected: blurs C-6's "values at current WAC"
> semantic) and doesn't pollute C-3's replacement-cost signal the way a synthetic purchase would
> (rejected: conflates an administrative entry with a real supplier transaction). Tracked as
> [KOK-084](../system-design-knowledge-base/10-implementation-backlog.md#phase-65--onboarding-hardening-gh-4).

> ✅ **Data exposure resolved (Q1).** Production has not launched; only staging completed onboarding
> with real opening stock. Staging is disposable, so this needs **no backfill migration and no
> retro-correction path** — a forward fix plus a staging reseed is sufficient. Sized down L → M
> accordingly. This is the cheapest this fix will ever be; the window closes the day prod launches.

---

### BI-02 · No initial unit cost captured for opening stock — ✨ P0

**Reported:** *"Los costos unitarios iniciales deben soportar varios decimales, pero nunca ser 0 y
mostrar sus unidades."*

The UI counterpart of BI-01: step 5 has no unit-cost column at all
(`StepCount.tsx:192-197` renders Ítem / Esperado / Contado / Variación).

Requirements as stated by the owner:

- Required whenever the counted opening qty is `> 0`.
- Must never be `0`.
- Must accept several decimal places — note the codebase's money scale is centavos (scale 2) via
  `parseDecimalToInt(raw, 2)`, while unit costs are stored as **milli-centavos per whole unit**
  (`wac_mc`, ADR-017), which is exactly the extra precision being asked for. The input scale needs
  to be chosen deliberately, not inherited from the balances field.
- Must display the unit it is priced per (Bs/kg, Bs/L, …), derived from the item's `unit`.

Blocked on the same design decision as BI-01; ship together.

---

### BI-03 · Money field rejects 3 decimals with a misleading message — 🐞 P1

**Reported:** *"al intentar poner una cifra con tres decimales (200.050) … aparece 'Ingresa un monto
válido (0 o mayor)'. Ese monto sí es mayor a 0."*

The owner is right that the message is wrong, and right that a trailing zero carries no value.

**Verified root cause.** `apps/web/src/lib/decimal.ts:17` — `if (fracPart.length > scale) return null`.
Money parses at scale 2, so `"200.050"` (3 fractional digits) returns `null`, and
`StepBalances.tsx:39-41` maps *every* `null` to `onboardingLabels.errors.invalidAmount`
("Ingresa un monto válido (0 o mayor)") — a message about sign and magnitude, describing a failure
about precision.

**✅ Decided (Q2): fix the message *and* accept valueless trailing zeros.**

```
parseDecimalToInt("200.05",  2) → 20005   (unchanged)
parseDecimalToInt("200.050", 2) → 20005   (was null)
parseDecimalToInt("200.055", 2) → null    (unchanged) → "Usa como máximo 2 decimales (centavos)."
```

The widening rule: digits beyond `scale` are stripped when they are **all zeros**, and rejected when
any carries value. This is a strict widening — every input that parses today parses to the identical
integer, and only previously-rejected inputs start working — so no existing call site changes
behaviour. That property is what makes it safe to do in the shared layer, and it is what the tests
must pin down.

Scope: `packages/shared` numeric layer, so it applies to **every money and qty field app-wide**, not
just onboarding. Sized XS → S for the test coverage that earns the blast radius. A clear message is
still required for the genuinely-invalid case, so BI-03 ships both halves.

**Explicitly out of scope (Q2, option 3 declined):** thousands-separator inference. `decimal.ts:12`
uses `.replace(",", ".")`, which replaces only the *first* comma, so a pasted `1,234,56` still fails.
Left as-is deliberately: in es-BO, `"1.234"` is ambiguous between 1234 and 1.234, and guessing wrong
misparses by 1000×. Rejecting it with a clear message beats silently mis-reading it.

---

### BI-04 · Catalog row errors always report "monto inválido" — 🐞 P1

**Verified root cause.** `parseItemFormValues` (`apps/web/src/components/catalog/ItemForm.tsx:85-112`)
returns a bare `null` for three distinct failures: empty name (`:87`), unparseable sale price
(`:92`), unparseable min stock (`:99`). `StepCatalog.tsx:176-179` renders all of them as
`` `"${row.name}": ${onboardingLabels.errors.invalidAmount}` ``.

So clearing a row's **name** produces the error *"Ingresa un monto válido (0 o mayor)"* — attached to
a row label that is now empty, pointing at a field that is fine. The owner's request for better
catalog validation starts here.

**Fix:** have the parser return a discriminated result (`{ ok: true, value }` / `{ ok: false, field,
code }`) instead of `null`, and render the error against the offending cell rather than as one
banner for the whole table. Contained to web; `ItemForm.tsx` is the shared consumer and must be
updated with it.

Prerequisite for BI-06 — do this first.

---

### BI-05 · No way to add a row to the initial catalog — 🐞 P1

**Reported:** *"hay boton eliminar en cada fila, pero no hay forma de agregar una nueva fila."*

Confirmed: `StepCatalog.tsx` defines `removeRow` (`:166`) with no counterpart. Rows are seeded once
from `FIXTURE_ITEMS` (`:156`) and can only shrink. An owner whose real catalog differs from the
fixture must finish the wizard and then re-enter every missing item through Settings → Catálogo.

**Fix:** an "Agregar ítem" button appending a blank `CatalogRow` with a fresh id (the current
`fixture-${index}` id scheme will collide after removals — use `generateUuidV7()` from
`packages/shared/src/uuid.ts`, already a dependency). XS, no contract change.

---

### BI-06 · Catalog validation ignores kind-conditional required rules — 🧭 P1

**Reported:** *"El precio de venta es solo para el tipo Producto final y es obligatorio. El stock
mínimo es solo para tipo Materia prima … también obligatorio."*

Today both fields are optional for every kind (`packages/shared/src/catalog.ts` —
`salePriceMcSchema` and `minStockQtySchema` are both `.nullable().optional()`), and the wizard
renders both inputs on every row regardless of kind.

**✅ Decided (Q3a): a hard rule in the shared schema, no grandfathering.** `superRefine` on
`createItemCommandSchema` and `updateItemCommandSchema` in `packages/shared/src/catalog.ts`, so the
wizard, the catalog form, the API, and any future assistant draft tool are bound by one contract —
which is precisely what D-4 exists to guarantee. No backfill migration: prod is unlaunched (Q1) and
staging gets reseeded. Ships with the Doc 03 rule + Doc 04 §3.1 update in the same PR (D-1/D-6).

**✅ Decided (Q3b): exclusivity, not just requirement.** The inapplicable field must be `null`, and
the wizard hides the cell entirely so there is nothing to mis-enter.

| kind            | `salePriceMc` | `minStockQty`      |
| --------------- | ------------- | ------------------ |
| `RAW_MATERIAL`  | forbidden     | **required, ≥ 0**  |
| `SEMI_FINISHED` | forbidden     | forbidden          |
| `FINISHED`      | **required**  | forbidden          |

**`0` is an explicitly valid `minStockQty`** — "required" means non-null, not non-zero. It reads as
*"track this material, but never alert me about it"*, which is exactly right for something like
Agua. `minStockQtySchema` is already `.int().nonnegative()`, so no numeric change is needed; the
`superRefine` only has to reject `null`/`undefined` for `RAW_MATERIAL`. Do **not** tighten this to
`.positive()`.

**The current fixture list violates this in six of eleven rows** and must be corrected in the same
PR (`StepCatalog.tsx:42-131`):

| Fixture row          | kind            | Offending field       | Fix    |
| -------------------- | --------------- | --------------------- | ------ |
| `Masa madre`         | `SEMI_FINISHED` | `minStockQty: 200000` | → null |
| `Pan de masa madre`  | `FINISHED`      | `minStockQty: 5000`   | → null |
| `Rollos de canela`   | `FINISHED`      | `minStockQty: 5000`   | → null |
| `Cuñapés`            | `FINISHED`      | `minStockQty: 5000`   | → null |
| `Queso crema de kéfir` | `FINISHED`    | `minStockQty: 3000`   | → null |
| `Ghee`               | `FINISHED`      | `minStockQty: 3000`   | → null |

> ⚠️ **Consequence worth accepting deliberately:** exclusivity permanently rules out a low-stock
> alert on a finished good ("keep 5 loaves on hand"). That is a coherent thing to want and it is
> being traded away for a simpler, unambiguous matrix. If it is ever needed, it will require
> amending this rule rather than just filling in a field.

Also in scope per the report: name is already `.max(200)` server-side but the wizard input has no
`maxLength` and no counter, so the owner discovers the limit only on submit.

Depends on BI-04 (per-field error plumbing). Interacts with BI-12/BI-15 — see the ⚠️ note under
BI-15.

---

### BI-07 · No way to go back a step — 🧭 P1

**Reported:** *"no existe boton para volver en caso de querer corregir algo."*

Confirmed. `routes/onboarding.tsx:37-39` only has `goToStep`, clamped forward via `Math.min`, and no
step component renders a back control. The stepper (`Stepper.tsx`) is display-only.

This is the narrow, high-value half of the owner's larger request (BI-20). Navigation backwards is
cheap; **the honest caveat is that steps 2 and 3 already committed their writes** by the time you
can go back, so "back" is currently *review*, not *edit* — returning to step 2 and saving again hits
`setOpeningBalances`, which the service rejects once onboarding is complete, and returning to step 3
would create duplicate items.

So BI-07 should ship as: back navigation enabled, and already-committed steps render in a read-only
"ya guardado" state with a pointer to where it can be changed later. Full editability is BI-20.

---

### BI-08 · Re-entering `/onboarding` after completion is unguarded — 🐞 P1

**Reported:** *"Cuando ya se haya pasado el onboarding, al volver a entrar a la URL se debería
mostrar un mensaje de Onboarding finalizado."*

Confirmed asymmetry: `routes/panel.tsx:38-43` redirects **to** `/onboarding` while incomplete, but
`router.tsx:181-183` registers `/onboarding` with no guard in the other direction. Navigating there
after completion re-mounts the full wizard — including `StepCount`'s mount effect
(`StepCount.tsx:71-85`), which **starts a fresh DRAFT inventory count on every visit**, silently
accumulating orphan draft counts.

**Fix:** guard the route on `useOnboardingStatus()`; when `completed`, render a terminal "Configuración
inicial completada" card with a link to the panel instead of the stepper. `GET /onboarding/status`
already exists (`apps/worker/src/api/onboarding.ts:28`) — no backend work.

---

### BI-09 · Missing `PASTRY` category — ✨ P2

`ITEM_CATEGORIES` (`packages/shared/src/enums.ts`) has no pastry value; the owner needs one.

**Not a one-line change.** The value set is triple-encoded by design: the shared enum, the Drizzle
column enum (`apps/worker/src/db/schema.ts:35`), and a SQL `CHECK` constraint
(`schema.ts:54-57`, `items_category_check`). SQLite cannot alter a `CHECK` in place, so this needs a
table-rebuild migration (12-step `ALTER TABLE` dance), plus the Spanish label in
`i18n-onboarding.ts` and `i18n-catalog.ts`, plus a Doc 04 update in the same commit (D-6). The
enums file says so explicitly: *"Do not reorder or rename without updating Doc 04 in the same PR."*

**✅ Bundled with BI-10 (Q4/Q8).** `PASTRY` and `M` ship as a single table-rebuild migration touching
both `items_category_check` and `items_unit_check`, with one Doc 04 update covering both. Splitting
them means paying the rebuild twice.

```
ITEM_CATEGORIES = [...existing, "PASTRY"]   label: "Pastelería"
UNITS           = [...existing, "M"]        label: "Metros (m)"
```

---

### BI-10 · Missing `M` unit — ✨ P2

**Reported:** for *"Cordel o cinta de empaquetado"*.

Same mechanism and same cost as BI-09 (`UNITS` in `enums.ts`, `schema.ts:38`, `items_unit_check` at
`schema.ts:58`). **Ship as one migration with BI-09.**

**Convertibility was not actually an open question.** `qty.ts:5-9` states the rule outright:
*"We do NOT auto-convert between units (e.g. never silently promote G → KG): a value is always
displayed in the item's stored unit."* Making `M`/`CM` a convertible pair would break INV-6 /
ADR-017 across the entire numeric foundation. Length units are therefore independent, exactly like
`G`/`KG` and `ML`/`L`.

> ~~**Decided (Q4): add `CM` only, not `M`.**~~ **Superseded by Q8**, once Q7a established that the
> large family member is canonical. Adding `CM` would have left one unit family canonicalised the
> opposite way from `KG`/`G` and `L`/`ML` — the kind of exception that later reads as a bug.

**✅ Decided (Q8): add `M` only, not `CM`.** Cordel and cinta store metres; BI-22's auto-scaling
renders centimetres for anything under a metre, which delivers the centimetre reading that motivated
Q4 without the inconsistency.

```
UNITS = ["G","KG","ML","L","UNIT","M"]

stored 2500 milli-m  → "2,5 m"     (≥ 1 whole unit)
stored  500 milli-m  → "50 cm"     (< 1 whole unit → small member)
```

Label `"Metros (m)"` in `i18n-onboarding.ts` / `i18n-catalog.ts`, plus `UNIT_LABELS` in `qty.ts:30`.

Consistent with Q7a on both axes: milli-unit granularity is 1 mm (ample for cordel and cinta), and
cost resolution at ~2 Bs/m is `200000` mc/m rather than `2000` mc/cm — a 1000× improvement on a
figure that is rounded to an integer.

> Until BI-22 lands, a sub-metre length renders as `"0,5 m"` rather than `"50 cm"`. Correct, just
> not yet ergonomic — the same interim state BI-12's recipe lines are in.

---

### BI-11 · Owner-managed (create/archive) categories — ✨ P2

**Reported:** *"Debería ser posible crear/archivar otras categorías."*

Distinct from BI-09 and much larger. Categories are a compile-time enum backed by a SQL `CHECK`
constraint; user-managed categories means a real `item_categories` table, an FK from `items`,
dropping the check, an archive flag, CRUD service + route + screen, and a decision about what
archiving does to items already in that category.

This also removes a guarantee the codebase currently leans on: `categoryLabels` is
`satisfies Record<ItemCategory, string>` (`i18n-onboarding.ts`), i.e. exhaustive Spanish labels are
type-enforced today. With owner-created categories the label becomes owner-supplied free text.

**Recommendation:** ship BI-09/BI-10 now (they unblock the owner immediately), and treat BI-11 as a
separate design task. Do not attempt them together.

---

### BI-12 · Seed the three starter recipes — ✨ P2

**Reported:** *"¿Por qué no crear recetas iniciales? siempre y cuando los insumos involucrados sean
parte del catálogo inicial."*

The premise has changed in the owner's favour: `StepRecipes.tsx` is a static pointer card whose
comment reads *"Recipes (KOK-025) doesn't exist yet"* — **that comment is now stale.** Recipes
shipped; `recordRecipeCommandSchema` exists in `packages/shared/src/recipes.ts:44` and
`apps/worker/src/core/recipes/recipes.ts` is live. Seeding is feasible.

**✅ Decided (Q5a): recipe 3 outputs a new `FINISHED` item `Pan blanco pequeño`, unit `UNIT`, yield 4.**
Kept distinct from the fixture's existing `Pan de masa madre`, which is a different product at a
different price — conflating them would merge their costs and margins.

**✅ Decided (Q5b): grow the fixture so every input exists, and seed all three recipes.** The generic
`Masa madre` splits into its two states, since the recipes consume them as distinct stock.

| New fixture item      | kind            | unit   | `minStockQty` (BI-06b) | `salePrice`      |
| --------------------- | --------------- | ------ | ---------------------- | ---------------- |
| `Agua`                | `RAW_MATERIAL`  | `ML`   | `0` — tracked, never alerted | forbidden  |
| `Sal`                 | `RAW_MATERIAL`  | `G`    | `0` (suggested, editable) | forbidden     |
| `Masa madre refrigerada` | `SEMI_FINISHED` | `G` | forbidden              | forbidden        |
| `Masa madre activada` | `SEMI_FINISHED` | `G`    | forbidden              | forbidden        |
| `Pan blanco pequeño`  | `FINISHED`      | `UNIT` | forbidden              | `1500` (15 Bs)   |

The two `Masa madre` states replace the generic `Masa madre` fixture row.

**✅ Decided (Q6c): `Sal` seeds with `minStockQty: 0`, editable.** Every fixture value is already a
pre-filled suggestion in an editable cell (`StepCatalog.tsx:214-265`), so this needs no new
mechanism — `0` is simply the seeded default, and it is valid per Q3c.

**✅ Decided (Q6a): `Pan blanco pequeño` sells at 15 Bs → `salePrice: 1500`** (centavos, matching the
other `FINISHED` fixture rows, which `fixtureToRow` renders via `formatIntAsDecimalInput(_, 2)`).

The three seeded recipes, in milli-units of each item's own stored unit:

```
Alimentar masa madre    → Masa madre refrigerada, yield 200 g
  Harina 100 g · Agua 100 ml

Activar masa madre      → Masa madre activada, yield 700 g
  Masa madre refrigerada 150 g · Harina 300 g · Agua 300 ml
  (750 g in → 700 g out; ~7% loss, plausible for discard/evaporation)

4x Pan blanco pequeño   → Pan blanco pequeño, yield 4 u (expectedYieldQty 4000)
  Harina 580 g · Masa madre activada 150 g · Agua 345 ml · Sal 2 g
```

Seeding must still resolve item ids from what step 3 actually created — the step can be skipped and
rows can be deleted — so it cannot assume the fixture landed intact.

> ~~**Decided (Q6b): `Harina` `KG` → `G`.**~~ **Superseded by Q7a** — see BI-22. Harina **stays
> `KG`**, `minStockQty` stays `10000`, and no fixture unit changes at all. Recipes read in grams via
> the display layer instead of by changing what is stored.

**✅ Decided (Q7a): the canonical (stored) unit is the LARGE one — `KG`, `L`.** Recipes render the
small unit for display only. This keeps every fixture row exactly as it is today and reverses the
purchase-ergonomics problem Q6b would have introduced.

| Item     | Stored unit | Recipe line       | Renders as | Purchase entry     |
| -------- | ----------- | ----------------- | ---------- | ------------------ |
| `Harina` | `KG`        | `580` milli-kg    | `"580 g"`  | `25` kg — native   |
| `Agua`   | `L`         | `345` milli-L     | `"345 ml"` | n/a (see BI-15)    |
| `Sal`    | `G`         | `2000` milli-g    | `"2 g"`    | `500` g — native   |

**The deciding factor was cost precision, not ergonomics.** `wac_mc` is an *integer* of
milli-centavos per whole stored unit (`schema.ts:39`, ADR-017), so the canonical unit permanently
fixes cost resolution:

| Item                  | Canonical small        | Canonical large        |
| --------------------- | ---------------------- | ---------------------- |
| Agua @ ~0.005 Bs/L    | `0.5` mc/ml → **rounds to 0 or 1** | `500` mc/L — exact |
| Harina @ 4.30 Bs/kg   | `430` mc/g (±0.12%)    | `430000` mc/kg (±0.0001%) |

Storing cheap items in small units destroys their cost basis outright — water would cost either
nothing or double, which would then feed BI-01/BI-02's opening-cost work and every recipe that uses
it. The large unit wins on precision *and* on purchase ergonomics simultaneously.

**Accepted limit:** recipe quantities cannot go below 1 g / 1 ml (one milli-unit of the stored
unit). Every starter recipe clears this — the smallest line is `Sal 2 g` — but a future 0.5 g yeast
or spice line would not be expressible without changing that item's stored unit to `G`.

> ✅ **Previously blocked on BI-15, now unblocked.** BI-06b makes `minStockQty` mandatory for every
> `RAW_MATERIAL`, and this fixture adds `Agua` as one — which looked unsatisfiable for an item with
> no stock level. Resolved by the rule that `0` is a valid minimum: Agua seeds with `minStockQty: 0`.
> BI-15's *remaining* problem is consumption, not the minimum — see BI-15.

---

### BI-13 · Count table: group rows by item kind — 🧭 P2

**Reported:** *"Separar la tabla por tipos: materias primas, semielaborados y productos finales."*

`StepCount.tsx:198` maps `count.lines` flat, in server order. The `kind` needed to group is not in
the lookup the route builds — `routes/onboarding.tsx:27-33` projects only `{ name, unit }`. Widen
that projection to include `kind` and render three labelled sections in `ITEM_KINDS` order. Web-only.

---

### BI-14 · Count table: drop "Esperado"/"Variación", show the unit — 🧭 P2

**Reported:** *"Las columnas 'esperado' y 'variación' son inútiles acá. Es mejor mostrar la unidad."*

The owner is correct and the code confirms why: at onboarding, `expectedQty` is `0` for every item
(no stock movements exist yet), so "Esperado" is a column of zeros and "Variación" merely restates
"Contado". Both are meaningful on the Inventory screen and meaningless here.

Replace with the item's unit next to the input. `formatQty(qty, unit)` already exists. XS.

---

### BI-15 · "Unmetered" items (Agua) — perpetual negative stock — ✨ P2

**Reported:** *"Se debería soportar un insumo con stock 'infinito' como 'Agua' … pero que sí tiene un
costo unitario … Tal vez no necesita ser realmente infinito en la DB sino solo de vista al usuario."*

A genuine modelling gap: water is consumed by recipes and carries a real cost, but is never
purchased as stock — it is a monthly utility expense.

The owner's own suggestion (a very large number rendered as "Infinito") is a workaround worth
naming as such. It would keep the kardex arithmetic untouched, but it puts a fake quantity into
`stock_movements`, which then flows into inventory valuation, the consistency check (INV-5), and
every stock report — a number that is *wrong on purpose* and must be special-cased everywhere it
surfaces.

The cleaner model is an item flag (e.g. `is_unmetered`) that exempts the item from stock tracking
while keeping its unit cost available to recipe costing. That is a real design task touching Doc 03
and the costing engine — hence 🔴.

**Recommendation:** do not implement the large-number workaround. Write the design first.

**What actually happens once BI-12 seeds Agua (verified).** Production will *not* fail —
`movements.ts:142` is explicit: *"INV-8 is explicit that stock MAY go negative: this function never
rejects a negative result."* So the seeded recipes run fine, and instead:

- Agua's `qty_on_hand` drifts negative on the first production run and never recovers, because
  nothing ever purchases water.
- `negative_since` is set on that first crossing (`movements.ts:138`) and, per the transition rule,
  **never clears** while the balance stays negative. Agua becomes a permanently-flagged item in
  every view that surfaces negative stock, and permanent warnings are warnings people stop reading.
- Agua's WAC stays `0` (never purchased), so water contributes **zero cost** to every recipe that
  uses it — including two of the three starter recipes. BI-02's opening unit cost can seed a value,
  but with consumption and no replenishment the WAC replay over a negative balance is not a
  meaningful cost basis.

None of this blocks anything, which is exactly why it is easy to leave sitting. It is a slow leak in
the numbers rather than a failure.

---

### BI-16 · Catalog table forces horizontal scroll — 🧭 P2

**Reported:** *"La tabla de catálogo inicial es muy angosta, se genera scroll horizontal."*

**Verified root cause.** The wizard shell is `max-w-2xl` (672px, `routes/onboarding.tsx:42`) while
the catalog grid declares `min-w-[860px]` (`StepCatalog.tsx:199`). Horizontal scroll is guaranteed
at every viewport — it is not a narrow-window edge case.

**Fix:** let the catalog step break out of the 2xl shell (a wider container for step 3 only), and/or
collapse the 7-column grid to a stacked card-per-item layout on narrow viewports. Either is XS-to-S
and web-only.

---

### BI-17 · Catalog header columns misaligned with body columns — 🐞 P2

**Reported:** *"El título de columna 'Precio de venta' está desfasado de su columna."*

**Verified root cause — and it affects every column, not just that one.** The header
(`StepCatalog.tsx:200`) and each body row (`:212`) declare the *same* template
`grid-cols-[2fr_1.2fr_1.2fr_0.8fr_1fr_1fr_auto]` but are **separate grid containers**. The final
`auto` track resolves independently per container: in the header it holds an empty `<span />`
(`:207`) and collapses to 0px; in each row it holds the "Quitar" `<Button>`. Different leftover
width ⇒ different `fr` distribution ⇒ every header label drifts against its column, most visibly at
the right-hand end where "Precio de venta" sits.

**Fix:** one grid container for the whole table (`display: grid` on the wrapper with
`grid-template-columns` declared once), or give the header's spacer an explicit width matching the
button. Trivial once the cause is understood — this is the cheapest item on the list.

---

### BI-18 · Decimal separator convention never stated to the owner — 🧭 P2

**Reported:** *"No se sabe qué usar para los decimales, o punto o coma. Es algo importante que
informar al usuario desde el inicio."*

Good news worth telling the owner directly: **both already work.** `decimal.ts:12` normalizes `","`
to `"."` before parsing. The defect is purely that nothing says so — every money input shows
`placeholder="0.00"` and no helper text.

**Fix:** helper text on the first money field the owner meets (step 2), e.g. *"Puedes usar coma o
punto para los decimales (máx. 2)."* Pairs naturally with BI-03's corrected message. See also the
multi-comma caveat noted in BI-03.

---

### BI-19 · Explain *why* the opening count matters — 🧭 P2

**Reported:** *"En lo posible dar instrucciones al usuario sobre qué tiene que hacer para obtener
estos datos y porqué esta etapa es muy importante."*

Current copy is one line: *"Cuenta el stock real de cada ítem para dejar tu inventario al día antes
de empezar a operar"* (`i18n-onboarding.ts`, `countBody`). It says what to do, never what it costs to
do it carelessly — that every later cost and margin figure is anchored to these numbers.

Copy-only change, but it should land **with** BI-01/BI-02, since the strongest reason to be careful
here is the unit-cost capture those introduce. Spanish tone review per Definition of Done §4.

---

### BI-20 · Defer all writes to a single "creating your data" commit — 🧭 P3

**Reported:** *"Se debería guardar los datos en los estados react y solo al final mandar todo al
backend y en la pantalla mostrar un 'Creando el estado inicial de la DB'."*

This is the owner's structural proposal, and it correctly diagnoses the real problem: the wizard
commits step-by-step (`POST /onboarding/opening-balances` at step 2, `POST /onboarding/catalog` at
step 3, count start on step 5 mount), so a half-finished wizard leaves half-written state and steps
cannot be revisited.

**Ranked P3 despite being the largest item, deliberately.** BI-07 and BI-08 deliver most of the
felt benefit (go back; don't re-enter a completed wizard) for a fraction of the cost. Full deferral
is a rewrite of all five steps plus a new bulk endpoint, and it collides with two constraints:

- **INV-1 / D-3 — one atomic batch per command.** A single "commit everything" endpoint spanning
  balances + items + recipes + a committed count is not one command; it is several. Whether it can
  be one `db.batch()` — and whether it *should* be — needs deciding before design.
- Step 5's count is inherently server-backed: `startCount` computes `expectedQty` from items that
  must already exist. Holding it purely client-side means rethinking that step, not just deferring
  its POST.

**Recommendation:** ship BI-07 + BI-08 first, then re-evaluate. The remaining pain may not justify
an L.

---

### BI-21 · Litre abbreviation "l" reads as digit 1 — 🧭 P3

**Reported:** *"La abreviación de litros (l) se podría confundir con 1."*

Label-only. `unitLabels.L` is `"Litros (l)"` (`i18n-onboarding.ts`); `formatQty` renders the short
form in tables. Use the uppercase `L` (the SI-sanctioned alternative, adopted precisely because
lowercase `l` and `1` collide) — `"Litros (L)"`. No enum or data change; the stored value is already
`"L"`.

There is a second hardcoded copy: `UNIT_LABELS.L` is also `"l"` at `packages/shared/src/qty.ts:34`,
which is what `formatQty` renders in every table. Fix both.

---

### BI-22 · Magnitude-scaled display units — ✨ P2

**Requested:** *"en el catálogo inicial el usuario debería elegir la unidad útil para recetas, pero
para compras y lecturas de stock, poder insertar/leer kg o Lt ergonómicamente."*

With Q7a settling the stored unit as the large one, the remaining need is the reverse direction:
`580` milli-kg of flour in a recipe must not read as `"0,58 kg"`.

**✅ Decided (Q7b): auto-scale by magnitude.** `formatQty` chooses the unit from the value's size
rather than from a stored preference — no per-item configuration, no migration.

```
formatQty(580,    KG) → "580 g"     (< 1 whole unit → small unit of the family)
formatQty(25000,  KG) → "25 kg"
formatQty(345,    L)  → "345 ml"
formatQty(12000,  L)  → "12 L"
```

**This contradicts a documented invariant and needs a KB amendment (D-1).** `qty.ts:5-9` currently
states the opposite outright: *"We do NOT auto-convert between units (e.g. never silently promote
G → KG): a value is always displayed in the item's stored unit… This is the spec-faithful choice."*
That paragraph, and the corresponding Doc 04 §2 / INV-6 text, must be amended in the same PR. Note
this is a **display-layer** conversion only — storage stays milli-units of one canonical unit, so
INV-6's integer invariant itself is untouched.

**Blast radius is the reason this is L.** `formatQty` is the single rendering path for every
quantity in the product: stock tables, the kardex, movements, counts, inventory views, Telegram
cards, and assistant output. Changing what it returns changes all of them at once.

**Design work still required before coding:**

1. **A unit-family map.** After Q8 all three families canonicalise the same way — the large member
   is stored, the small member is display-only, factor 1000×. `UNIT` has no family and never scales.

   | Canonical (stored) | Display below 1 whole unit |
   | ------------------ | -------------------------- |
   | `KG`               | `g`                        |
   | `L`                | `ml`                       |
   | `M`                | `cm`                       |

   `G` and `ML` remain valid *stored* units for items genuinely counted that way (`Sal`, the two
   `Masa madre` states) — they simply have no smaller member to scale down to.
2. **The threshold rule.** "Below one whole unit, drop to the small unit" is the obvious rule and
   handles every case here, but it needs to be written down and tested at the boundary
   (`999` milli-kg → `"999 g"`, `1000` → `"1 kg"`).
3. **Input, which auto-scaling does not solve.** Q7a makes purchase entry native (`25` kg), so the
   originally-reported problem is gone. But *recipe* entry is now the awkward side: typing `0.58`
   to mean 580 g. A bare number in an input is ambiguous — `580` could be kg or g — so recipe forms
   need an explicit unit selector next to the quantity, defaulting to the small unit. This is the
   one piece of BI-22 that is genuinely new UI rather than a formatting change.
4. **Do not auto-scale unit costs.** A cost column must stay in one unit to be comparable down the
   page; `"4,30 Bs/kg"` next to `"0,43 Bs/g"` is unreadable. BI-02's opening-cost input and every
   WAC display should render per *canonical* unit regardless of the quantity's magnitude.

> ⚠️ **Accepted cost:** a stock column will mix units row to row — `Harina 25 kg` above
> `Sal 500 g` — so the column can no longer be eyeball-summed or sorted by the rendered text. This
> was chosen knowingly over a per-item display unit, which would have kept columns homogeneous at
> the price of a migration and an extra catalog field.

---

## Suggested sequencing

**1 — Correctness gate (do before prod launches).**
BI-01 + BI-02 as one KB-amendment-plus-code task. Everything else is cosmetic next to opening stock
valued at zero, and Q1 confirmed this is the cheapest it will ever be to fix — no backfill, no
retro-correction, just a staging reseed. That advantage disappears on launch day.

**2 — Cheap, self-contained wins (all 🟢, no KB changes).**
BI-17, BI-21, BI-16, BI-14, BI-05, BI-18, BI-08, BI-13, BI-07. Roughly one to two days total, and
they resolve most of the reported friction.

**3 — Validation pass.**
BI-04 first (unblocks precise per-field errors), then BI-03 (shared numeric layer + tests), then
BI-06 with its KB amendment and the six fixture-row corrections.

**4 — Catalog vocabulary.**
BI-09 + BI-10 as a single table-rebuild migration (`PASTRY` + `M`) with one Doc 04 update.

**5 — Starter recipes.**
BI-12, after BI-06 and BI-09/BI-10 have landed — it depends on the corrected fixture and on the
kind-conditional matrix being settled. Fully specified now (Q5a/Q5b/Q6a/Q6c/Q7a). It ships
*correctly* without BI-22; recipe lines just read `"0,58 kg"` until the display layer lands.

**6 — Design tasks, each needing a written proposal before an estimate is trusted.**
BI-11, BI-15, BI-20, BI-22. Two notes on ordering:

- **BI-22 should settle before BI-02 builds its unit-cost input**, since point 4 of its design (cost
  columns must *not* auto-scale) is a constraint on that input's rendering. It does not block
  BI-01/BI-02 — Q7a already gives them a sane canonical unit — but a late reversal would mean
  reworking the cost display.
- **BI-15** rises in priority the longer Agua sits in the catalog accumulating negative stock.

---

## Resolved decisions

Recorded 2026-08-02 with the owner. These are inputs to the tasks above, not the tasks themselves.

| #   | Question                                            | Decision                                                                                                                    |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Q1  | BI-01 — which environments hold affected data?      | **Staging only; prod not launched.** Staging is disposable ⇒ no backfill, no retro-correction. BI-01/02 sized L → M.        |
| Q2  | BI-03 — message-only, or widen the parser?          | **Both.** Fix the message *and* strip valueless trailing zeros in `parseDecimalToInt`. Thousands separators declined.        |
| Q3a | BI-06 — where is the kind-conditional rule enforced? | **Hard rule in the shared schema**, `superRefine` on create + update, no grandfathering. Reseed staging.                     |
| Q3b | BI-06 — required-only, or forbidden elsewhere?      | **Forbidden.** Full exclusivity matrix; six fixture rows corrected. Rules out low-stock alerts on finished goods.            |
| Q3c | BI-06 — is `minStockQty: 0` valid?                  | **Yes.** "Required" means non-null, not non-zero. Keep `.nonnegative()`; never tighten to `.positive()`.                     |
| ~~Q4~~ | ~~BI-10 — which length units?~~                  | ~~`CM` only.~~ **Superseded by Q8.**                                                                                        |
| Q5a | BI-12 — what does recipe 3 output?                  | **New `FINISHED` item `Pan blanco pequeño`**, unit `UNIT`, yield 4 (`expectedYieldQty: 4000`). Distinct from `Pan de masa madre`. |
| Q5b | BI-12 — how to handle missing items?                | **Grow the fixture**, split `Masa madre` into refrigerada/activada, seed all three recipes resolving ids from what exists.   |
| Q6a | BI-12 — sale price for `Pan blanco pequeño`?        | **15 Bs** ⇒ `salePrice: 1500` centavos.                                                                                     |
| ~~Q6b~~ | ~~BI-12 — `Harina` in `KG` or `G`?~~            | ~~`G`, `minStockQty` → `10000000`.~~ **Superseded by Q7a** — Harina stays `KG`, no fixture unit changes.                     |
| Q6c | BI-12 — `minStockQty` for `Sal`?                    | **`0`**, seeded as an editable suggestion like every other fixture value.                                                    |
| Q7a | BI-22 — which unit is canonical (stored)?           | **The large one (`KG`, `L`).** Decided on cost precision: small units round cheap items' `wac_mc` to 0. Supersedes Q6b.      |
| Q7b | BI-22 — how is the display unit chosen?             | **Auto-scale by magnitude**, no per-item config. Accepts mixed units within a column; needs a KB amendment to `qty.ts`/Doc 04. |
| Q8  | BI-10 — `M` or `CM`, given Q7a?                     | **`M` only.** Restores one rule across all three families: large member stored, small member display-only. Supersedes Q4.   |
| Q9  | BI-01/02 — opening-valuation mechanism?             | **Dedicated `OPENING_IN` movement type** (Doc 03 C-8), a WAC entry type like `PURCHASE_IN`. Rejected: cost-stamped `ADJUST` (blurs C-6, needs replay special-casing) and synthetic opening `PURCHASE_IN` (pollutes C-3's replacement-cost signal). Tracked as KOK-084. |

**No open questions remain.** Every unit family now canonicalises identically, and the one exception
that Q4 would have created is gone:

| Family    | Stored | Display below 1 unit | Decided by |
| --------- | ------ | -------------------- | ---------- |
| mass      | `KG`   | `g`                  | Q7a        |
| volume    | `L`    | `ml`                 | Q7a        |
| length    | `M`    | `cm`                 | Q8         |

Remaining work is either ready to build or is a 🔴 design task (BI-11, BI-15, BI-20, BI-22) whose
next step is a written proposal rather than an answer from the owner.

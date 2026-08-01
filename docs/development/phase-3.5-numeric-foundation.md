# Phase 3.5 — Numeric Foundation

Condensed record of the phase that established the system's numeric representation, executed
2026-07-27/28 between Phase 3 and Phase 4. It replaces the per-task backlog rows (KOK-070,
KOK-071, KOK-072, KOK-083), which have been retired now that the work is complete and the
result is simply how the system works.

The rule itself is law, not history: see
[ADR-017](../system-design-knowledge-base/12-architecture-decision-records.md#adr-017) and
Doc 04 §2. This file exists for the *reasoning* — why the representation is what it is, and
what generalizes to the next SQLite schema.

## 1. The problem

The schema had **two different denominators for the same-sounding concept**, with nothing to
tell them apart:

- `sale_price`, `sale_lines.unit_price` — centavos per **whole** unit
- `items.wac`, `items.replacement_cost`, and every `*_unit_cost_snapshot` — centavos per
  **milli**-unit, stored as `REAL`

Not the column type, not the column name, not the TypeScript type (both were bare `number`)
distinguished them. So `sale_price − wac` compiled, ran, and was wrong by ~1000× while looking
entirely plausible.

This was not a theoretical risk. It shipped twice: `v_price_health`'s three margin columns were
wrong by 1000× from migration 0001 until KOK-069 removed them, and roughly 25 further ad-hoc
`× 1000` / `÷ 1000` sites were scattered across `core/costing`, `core/production`,
`core/recipes` and eight web components — each an independent chance to get the direction wrong.

## 2. The decision

Four scales, one per concept, each a distinct nominal brand in `packages/shared`. No concept has
two scales.

| Concept                                                     | Scale                                       | Brand                  | Suffix |
| ----------------------------------------------------------- | ------------------------------------------- | ---------------------- | ------ |
| Money amount (total, balance, line total)                   | integer **centavos**                        | `Centavos`             | —      |
| **Any per-unit rate** (price, WAC, replacement, snapshot)   | integer **milli-centavos per WHOLE unit**   | `MilliCentavosPerUnit` | `_mc`  |
| Quantity                                                    | integer **milli-units** of the item's unit  | `MilliUnits`           | —      |
| Percent / rate                                              | integer **basis points**                    | `BasisPoints`          | —      |

Bs 8.00/u is `800_000` mc. `REAL` is gone from the schema entirely. Exactly two conversion
helpers exist repo-wide — `totalCentavos(rate, qty)` and `rateFromTotal(total, qty)`, both
half-up, both in `shared/money.ts` — and they are the only place a scale factor appears. A bare
`1000` or `1e6` anywhere else fails CI (`scripts/check-scale-literals.mjs`), with a
`// scale-factor-ok:` comment as the documented escape hatch for the rare legitimate case.

## 3. What shipped

| Task    | Delivered                                                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KOK-070 | The brands in `packages/shared` (nominal, zero-runtime, explicit constructors keeping the `assertSafeInteger` guards) plus the two conversion helpers, property-tested including the `10¹³` overflow bound (Doc 11 §2).                |
| KOK-071 | Forward migrations 0007–0010 and the whole rename, executed as four **vertical** slices (schema → `db/schema.ts` → shared Zod DTO → every `core/` service → web → tests), each independently merged and green.                        |
| KOK-072 | The CI guardrail banning bare scale literals, a final sweep confirming no ad-hoc conversion sites survive outside `money.ts`/`qty.ts`, and a doc consistency pass.                                                                     |
| KOK-083 | Repo-wide adoption of the `Centavos`/`MilliCentavosPerUnit` brands at the ~50 remaining call sites (`core/finance`, `core/orders`, `core/sales` standalone-tx paths, ~40 web components) that KOK-070 had left on bare `number`.        |

The four KOK-071 slices, in execution order:

- **0007 — the WAC family** (`items.wac`, `stock_movements.unit_cost`, and the `sale_lines` /
  `stock_exits` / `production_consumptions` cost snapshots), rescaled `× 1_000_000`.
- **0008 — `items.replacement_cost`**, rescaled `× 1_000_000`.
- **0009 — `items.sale_price` + `sale_lines.unit_price`**, rescaled `× 1000`.
- **0010 — `price_history.price`**, rescaled `× 1000`.

## 4. What to carry into the next SQLite schema

**SQLite's type affinity will not protect you.** A `REAL` column silently accepts and
accumulates float error that no constraint catches. Money and quantity are integer-only by
decision, enforced in application code and property tests — the database will not enforce it.

**Fix the numeric representation before anything is built on top of it.** This phase was
deliberately inserted early for three reasons, in order of weight: Phase 4 freezes field names
into AI prompts and golden eval fixtures (which the guardrails make expensive to re-bless);
there was no production data yet, so a rescaling migration was free and would never be cheaper;
and everything in Phase 5/5.5 is price-vs-cost arithmetic that would otherwise be written twice.
A representation migration is a one-way door the moment real data exists.

**Encode the unit *and* the scale in the type system, not in a comment.** The entire 1000× bug
class became a compile error the moment the brands existed. `money.ts`'s header had previously
recorded the opposite decision — not to brand, "to keep every call site ergonomic" — and the two
shipped bugs are what that ergonomics saved cost. A comment asserting "this column is
per-milli-unit" is precisely the mechanism that failed.

**Views are code, and they hide bugs longest.** `v_price_health` was wrong from day one and
stayed wrong for months because nothing read it and nothing tested it. Either property-test the
views or compute in application code, where the tests live.

**Slice a schema migration by shared computation and shared atomic batch — never by layer or by
table.** This is the sharpest lesson of the phase. Splitting the rename by layer (schema+core in
one PR, DTO+UI in the next) produces a merged state where a field's TypeScript type compiles but
its runtime value is off by 1000× — reintroducing the exact bug class the phase existed to
remove. Splitting by table is just as bad: `items.wac` and `stock_movements.unit_cost` are not
independent data, they are *the same number*, produced once by `core/costing` and written in the
same `db.batch()` per event (D-3). Group columns by what computes them together, and a vertical
cut gives the same small-PR benefit with no half-renamed boundary at any point.

**Pick a grid fine enough that real divisions are exact.** Milli-centavos sits three decimal
digits below the centavo the value is ever displayed at, so Bs 1.00 across three units is exactly
`33_333 mc/unit`. That precision also resolved the one genuine objection to integers: C-3's
replacement cost is read back recursively as an ingredient cost in a multi-level BOM, and
rounding a cached value compounds per level. Measured against an exact rational reference, the
per-level contribution is 0.0004–0.016 centavos against a leaf-quantization term 100–1700×
larger that is unavoidable either way — so the integer wins with no carve-out, and "round only at
display time" is preserved rather than violated (milli-centavos is not a display scale).

**Determinism is a feature, not a side effect.** Replacing float with integers made WAC replay
(ADR-016) reproducible bit-for-bit. The golden replay tests were re-blessed once during 0007,
reviewing each last-digit diff, and have been stable since.

**Check illustrative numbers against the formula.** Twice during this phase — once in KOK-070,
once in KOK-071 vertical 2 — a worked example was copy-pasted between three documents with a
wrong factor (`8_000_000` for Bs 8.00/u; `× 1000` where costs needed `× 1_000_000`). The formulas
were always right and the shipped migrations were always right; only the prose was wrong, and the
second instance would have under-scaled migration 0008 by 1000× if followed literally. Worked
examples in docs are untested code.

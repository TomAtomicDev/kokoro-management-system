// Money primitives — the foundation of INV-6 (Doc 04 §2, ADR-017).
//
// Representation: money is an INTEGER number of BOB centavos (Bs 12.50 → 1250).
// Money/rate/quantity types below are NOMINAL BRANDS (`number & { readonly
// __brand }`), not bare `number`. ADR-011 originally chose a bare `number`,
// reasoning that `assertSafeInteger` at each function boundary was safety
// enough and a brand would only cost ergonomics. ADR-017 overturns that
// decision: it shipped two real 1000×-scale bugs — `v_price_health`'s margin
// columns were wrong by 1000× from migration 0001 until KOK-069, and
// `SaleForm.tsx` still carries a hand-written `unitPrice / 1000` workaround —
// because nothing (not the column, not the name, not the TypeScript type)
// distinguished a centavos-per-WHOLE-unit amount from a centavos-per-MILLI-unit
// one. Brands make that class of bug a compile error: a bare number literal no
// longer satisfies `Centavos`/`BasisPoints`/`MilliCentavosPerUnit`, and mixing
// scales requires going through the explicit conversion helpers below.
// Runtime `assertSafeInteger` guards remain at every constructor and function
// boundary — brands catch developer error, assertions catch bad input.
//
// All arithmetic stays on integers; the only place a fraction appears is
// inside a division that is immediately fed to `roundHalfUpToInt` to produce
// a final amount.

import { assertSafeInteger, groupThousands } from "./numeric";
import type { MilliUnits } from "./qty";

/** An integer number of BOB centavos — a total, balance, or line amount. */
export type Centavos = number & { readonly __brand: "Centavos" };
/** An integer number of basis points (100% = 10000). */
export type BasisPoints = number & { readonly __brand: "BasisPoints" };
/**
 * An integer number of milli-centavos per WHOLE unit (Doc 04 §2, ADR-017) —
 * the single scale for every per-unit rate: sale price, WAC, replacement
 * cost, a cost snapshot, theoretical unit cost. Bs 8.00/unit → `800_000`.
 */
export type MilliCentavosPerUnit = number & { readonly __brand: "MilliCentavosPerUnit" };

/** Constructs a `Centavos` value, asserting it is a safe integer (INV-6). */
export function toCentavos(value: number): Centavos {
  assertSafeInteger(value, "centavos");
  return value as Centavos;
}

/** Constructs a `BasisPoints` value, asserting it is a safe integer (INV-6). */
export function toBasisPoints(value: number): BasisPoints {
  assertSafeInteger(value, "basisPoints");
  return value as BasisPoints;
}

/**
 * Constructs a `MilliCentavosPerUnit` value, asserting it is a safe integer
 * (INV-6).
 */
export function toMilliCentavosPerUnit(value: number): MilliCentavosPerUnit {
  assertSafeInteger(value, "milliCentavosPerUnit");
  return value as MilliCentavosPerUnit;
}

/**
 * The single half-up rounding primitive used "when producing a final money
 * amount" (Doc 04 §2).
 *
 * Semantic choice: **round half AWAY FROM ZERO** (a.k.a. commercial rounding).
 * The task spec explicitly equates "half up" in the accounting sense with
 * "half away from zero", which differs from `Math.round`'s behaviour on
 * negatives (`Math.round(-0.5) === -0`, i.e. toward +∞). Here:
 *   0.5 → 1,  1.5 → 2,  2.5 → 3,  -0.5 → -1,  -2.5 → -3.
 * This keeps rounding symmetric so that rounding an amount and its negation
 * always give equal-and-opposite results (important for transfers/refunds).
 *
 * Only NaN/Infinity are rejected; a non-integer input is expected here (that
 * is the whole point of rounding).
 */
export function roundHalfUpToInt(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`roundHalfUpToInt: expected a finite number, received ${String(value)}`);
  }
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded === 0 ? 0 : rounded; // normalise -0 → 0
}

/** Sum any number of centavos amounts. Every input must be a safe integer. */
export function addMoney(...amounts: Centavos[]): Centavos {
  let sum = 0;
  for (const amount of amounts) {
    assertSafeInteger(amount, "amount");
    sum += amount;
  }
  assertSafeInteger(sum, "sum");
  return sum as Centavos;
}

/** Subtract `b` centavos from `a` centavos. */
export function subMoney(a: Centavos, b: Centavos): Centavos {
  assertSafeInteger(a, "a");
  assertSafeInteger(b, "b");
  const result = a - b;
  assertSafeInteger(result, "result");
  return result as Centavos;
}

/**
 * Apply a basis-point rate to a centavos amount, rounding half-up to whole
 * centavos. e.g. 30% of Bs 12.55 → mulMoneyByBasisPoints(1255, 3000) → 377
 * (376.5 rounds up).
 */
export function mulMoneyByBasisPoints(amount: Centavos, basisPoints: BasisPoints): Centavos {
  assertSafeInteger(amount, "amount");
  assertSafeInteger(basisPoints, "basisPoints");
  return roundHalfUpToInt((amount * basisPoints) / 10000) as Centavos;
}

/**
 * Multiply a per-unit price (centavos per whole unit) by a quantity expressed
 * in milli-units (see qty.ts), rounding half-up to whole centavos. e.g. a
 * price of Bs 8.00/unit for 1.5 units → mulMoneyByQty(800, 1500) → 1200.
 */
export function mulMoneyByQty(unitPrice: Centavos, milliUnits: number): Centavos {
  assertSafeInteger(unitPrice, "unitPrice");
  assertSafeInteger(milliUnits, "milliUnits");
  return roundHalfUpToInt((unitPrice * milliUnits) / 1000) as Centavos;
}

/**
 * The only two scale-conversion helpers in the repo (Doc 04 §2, ADR-017): the
 * sole place either a `/ 1_000_000` or `× 1_000_000` scale factor may appear
 * in a cost or price expression. A bare `1000` / `1e6` anywhere else in such
 * an expression is a review failure (D-5) — go through these instead.
 */

/**
 * Converts a per-WHOLE-unit rate (milli-centavos) and a quantity
 * (milli-units) into a total money amount (centavos), rounding half-up to
 * the whole centavo. e.g. a rate of Bs 8.00/unit (`800_000` mc) for 1.5
 * units (`1500` mu) → `totalCentavos(800_000, 1500)` → `1200` (Bs 12.00).
 */
export function totalCentavos(rate: MilliCentavosPerUnit, qty: MilliUnits): Centavos {
  assertSafeInteger(rate, "rate");
  assertSafeInteger(qty, "qty");
  return roundHalfUpToInt((rate * qty) / 1_000_000) as Centavos;
}

/**
 * Derives the per-WHOLE-unit rate (milli-centavos) that a total money amount
 * (centavos) over a quantity (milli-units) implies, rounding half-up — the
 * inverse of `totalCentavos`. e.g. `rateFromTotal(1200, 1500)` → `800_000`
 * (Bs 8.00/unit, recovered from Bs 12.00 over 1.5 units).
 */
export function rateFromTotal(total: Centavos, qty: MilliUnits): MilliCentavosPerUnit {
  assertSafeInteger(total, "total");
  assertSafeInteger(qty, "qty");
  return roundHalfUpToInt((total * 1_000_000) / qty) as MilliCentavosPerUnit;
}

/**
 * Proportional integer allocation via the **largest-remainder method**
 * (ADR-011, Doc 11 §2). Splits `total` centavos across `weights` so that the
 * result sums to `total` EXACTLY — no centavo is ever lost or invented.
 *
 * Algorithm: base_i = floor(total × w_i / Σw); the leftover
 * `total − Σbase` centavos are handed out one-by-one to the entries with the
 * largest fractional remainder, ties broken by lowest original index (fully
 * deterministic). Remainders are compared as exact integer numerators
 * (`total×w_i mod Σw`) so there is no floating-point tie ambiguity.
 *
 * Edge cases:
 *  - empty `weights` → `[]`.
 *  - all weights zero → falls back to EQUAL shares (there is no proportional
 *    basis); still sums to `total` exactly.
 *  - more allocatees than centavos → the excess entries receive 0.
 *  - `total` must be a non-negative safe integer; negative totals throw
 *    (allocations are always non-negative in this domain).
 *  - every weight must be a non-negative safe integer.
 */
export function allocateLargestRemainder(total: Centavos, weights: readonly number[]): Centavos[] {
  assertSafeInteger(total, "total");
  if (total < 0) {
    throw new RangeError(`allocateLargestRemainder: total must be non-negative, received ${total}`);
  }
  for (const w of weights) {
    assertSafeInteger(w, "weight");
    if (w < 0) {
      throw new RangeError(`allocateLargestRemainder: weights must be non-negative, received ${w}`);
    }
  }

  const n = weights.length;
  if (n === 0) return [];

  let sumWeights = 0;
  for (const w of weights) sumWeights += w;

  // No proportional basis when all weights are zero → distribute equally.
  const useEqual = sumWeights === 0;
  const denom = useEqual ? n : sumWeights;

  const result: number[] = new Array<number>(n).fill(0);
  const remainderNum: number[] = new Array<number>(n).fill(0);
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const w = useEqual ? 1 : (weights[i] ?? 0);
    const scaled = total * w; // exact for safe-integer domain inputs
    const base = Math.floor(scaled / denom);
    result[i] = base;
    remainderNum[i] = scaled - base * denom; // 0 .. denom-1, exact integer
    allocated += base;
  }

  let leftover = total - allocated; // 0 .. n-1
  const order = Array.from({ length: n }, (_v, i) => i).sort((a, b) => {
    const ra = remainderNum[a] ?? 0;
    const rb = remainderNum[b] ?? 0;
    if (rb !== ra) return rb - ra; // larger remainder first
    return a - b; // tie-break: lowest original index
  });
  for (let k = 0; k < order.length && leftover > 0; k++) {
    const idx = order[k] ?? 0;
    result[idx] = (result[idx] ?? 0) + 1;
    leftover--;
  }

  return result.map(toCentavos);
}

/**
 * Format centavos as an es-BO currency string: `Bs 1.234,50`
 * (Bolivian convention: `.` thousands separator, `,` decimal separator,
 * literal `Bs` prefix followed by a single space).
 *
 * Negative amounts are rendered with the sign BEFORE the currency prefix:
 * `-Bs 1.234,50` (the doc does not spell this out; the minus-first form reads
 * naturally and matches how the MoneyText component will colour by sign).
 * With `{ signed: true }` a positive amount gets a leading `+` (`+Bs 5,00`);
 * zero is never signed (`Bs 0,00`).
 */
export function formatMoney(centavos: Centavos, opts?: { signed?: boolean }): string {
  assertSafeInteger(centavos, "centavos");
  const negative = centavos < 0;
  const abs = Math.abs(centavos);
  const intPart = Math.floor(abs / 100);
  const decPart = abs % 100;
  const body = `${groupThousands(intPart)},${decPart.toString().padStart(2, "0")}`;

  let sign = "";
  if (centavos !== 0) {
    if (negative) sign = "-";
    else if (opts?.signed) sign = "+";
  }
  return `${sign}Bs ${body}`;
}

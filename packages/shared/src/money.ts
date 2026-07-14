// Money primitives — the foundation of INV-6 (Doc 04 §2, ADR-011).
//
// Representation: money is an INTEGER number of BOB centavos (Bs 12.50 → 1250).
// We use a plain `number` (documented as centavos) rather than a nominal brand:
// per the task's guidance this keeps every call site ergonomic, and the safety
// that a brand would buy is instead enforced at runtime by `assertSafeInteger`
// at each function boundary — non-integers, NaN and Infinity are rejected so a
// stray float can never silently corrupt the books. Percentages are integer
// basis points (30% → 3000). All arithmetic stays on integers; the only place
// a fraction appears is inside a division that is immediately fed to
// `roundHalfUpToInt` to produce a final centavos amount.

import { assertSafeInteger, groupThousands } from "./numeric";

/** Documentation alias: an integer number of BOB centavos. */
export type Centavos = number;
/** Documentation alias: an integer number of basis points (100% = 10000). */
export type BasisPoints = number;

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
  return sum;
}

/** Subtract `b` centavos from `a` centavos. */
export function subMoney(a: Centavos, b: Centavos): Centavos {
  assertSafeInteger(a, "a");
  assertSafeInteger(b, "b");
  const result = a - b;
  assertSafeInteger(result, "result");
  return result;
}

/**
 * Apply a basis-point rate to a centavos amount, rounding half-up to whole
 * centavos. e.g. 30% of Bs 12.55 → mulMoneyByBasisPoints(1255, 3000) → 377
 * (376.5 rounds up).
 */
export function mulMoneyByBasisPoints(amount: Centavos, basisPoints: BasisPoints): Centavos {
  assertSafeInteger(amount, "amount");
  assertSafeInteger(basisPoints, "basisPoints");
  return roundHalfUpToInt((amount * basisPoints) / 10000);
}

/**
 * Multiply a per-unit price (centavos per whole unit) by a quantity expressed
 * in milli-units (see qty.ts), rounding half-up to whole centavos. e.g. a
 * price of Bs 8.00/unit for 1.5 units → mulMoneyByQty(800, 1500) → 1200.
 */
export function mulMoneyByQty(unitPrice: Centavos, milliUnits: number): Centavos {
  assertSafeInteger(unitPrice, "unitPrice");
  assertSafeInteger(milliUnits, "milliUnits");
  return roundHalfUpToInt((unitPrice * milliUnits) / 1000);
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

  return result;
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

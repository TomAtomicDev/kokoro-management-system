// Internal numeric helpers shared by money.ts and qty.ts.
// NOT re-exported from the package barrel — these are the trusted-boundary
// primitives that enforce INV-6 (integer-only money/qty arithmetic).

/**
 * Throws unless `value` is a safe integer (rejects non-integers, NaN, Infinity,
 * and magnitudes beyond Number.MAX_SAFE_INTEGER where integer arithmetic stops
 * being exact). This is the guard that makes money.ts / qty.ts the trusted
 * boundary demanded by golden rule D-5: any amount that reaches these modules
 * must already be an exact integer of the base unit (centavos / milli-units /
 * basis points).
 */
export function assertSafeInteger(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label}: expected a safe integer, received ${String(value)}`);
  }
}

/**
 * Groups the integer part of a non-negative number with `.` as the thousands
 * separator (Bolivian convention), e.g. 1234567 → "1.234.567".
 * Implemented manually rather than via Intl.NumberFormat so the grouping and
 * separator characters are deterministic across Node / Cloudflare Workers ICU
 * builds (some ship reduced locale data). Input must be a non-negative integer.
 */
export function groupThousands(intValue: number): string {
  const digits = Math.trunc(Math.abs(intValue)).toString();
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ".";
    out += digits.charAt(i);
  }
  return out;
}

import { type MilliCentavosPerUnit, toMilliCentavosPerUnit } from "@kokoro/shared";

import { exceedsScale, formatIntAsDecimalInput, parseDecimalToInt } from "./decimal";

export type CostRateParseResult =
  | { ok: true; value: MilliCentavosPerUnit }
  | { ok: false; reason: "empty" | "invalid" | "tooManyDecimals" | "notPositive" };

/** Parses a Bs-per-unit cost rate directly at ADR-017's five-decimal storage scale. */
export function parseCostRateInput(
  input: string,
  options?: { allowZero?: boolean },
): CostRateParseResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (exceedsScale(trimmed, 5)) return { ok: false, reason: "tooManyDecimals" };

  if (/^-\d+(?:[.,]\d+)?$/.test(trimmed)) {
    return { ok: false, reason: "notPositive" };
  }

  const parsed = parseDecimalToInt(trimmed, 5);
  if (parsed === null) return { ok: false, reason: "invalid" };
  if (parsed === 0 && !options?.allowZero) return { ok: false, reason: "notPositive" };

  return { ok: true, value: toMilliCentavosPerUnit(parsed) };
}

/** Formats a stored milli-centavo rate without converting through whole centavos. */
export function formatCostRateInput(value: MilliCentavosPerUnit): string {
  return formatIntAsDecimalInput(value, 5);
}

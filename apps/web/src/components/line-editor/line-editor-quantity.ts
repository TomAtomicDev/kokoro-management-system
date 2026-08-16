import { convertDisplayValueToMilliUnits, type QtyDisplayUnit, type Unit } from "@kokoro/shared";

import { parseDecimalToNumber } from "@/lib/decimal";

/**
 * Converts a line's user-facing quantity into the item's canonical milli-unit integer.
 * The display unit is optional so callers that do not opt into a selector retain the original
 * canonical-unit input behavior. Invalid, incompatible, zero, and non-positive quantities return
 * null so forms can keep their existing validation path.
 */
export function parseLineQuantityToMilliUnits(
  value: string,
  displayUnit: QtyDisplayUnit | null | undefined,
  canonicalUnit: Unit,
): number | null {
  const displayValue = parseDecimalToNumber(value);
  if (displayValue === null || displayValue <= 0) return null;

  try {
    return convertDisplayValueToMilliUnits(
      displayValue,
      displayUnit ?? canonicalUnit,
      canonicalUnit,
    );
  } catch {
    return null;
  }
}

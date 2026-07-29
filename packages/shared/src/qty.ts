// Quantity primitives — INV-6 (Doc 04 §2).
//
// Representation: quantity is an INTEGER number of MILLI-UNITS of the item's
// own stored unit (1.5 kg for a KG item → 1500; 12 units for a UNIT item →
// 12000). We do NOT auto-convert between units (e.g. never silently promote G
// → KG): a value is always displayed in the item's stored unit, converting
// only milli-units → the natural decimal of that same unit. This is the
// spec-faithful choice — the DDL stores one `unit` per item and reports are
// expected in that unit.

import { UNITS, type Unit } from "./enums";
import { assertSafeInteger, groupThousands } from "./numeric";

/**
 * An integer number of milli-units of the item's own stored unit (INV-6,
 * ADR-017): 1.5 kg (unit=KG) → `1500`; 12 units (unit=UNIT) → `12000`.
 */
export type MilliUnits = number & { readonly __brand: "MilliUnits" };

/** One whole stored unit, expressed in milli-units. Keep the scale literal in this module. */
export const WHOLE_UNIT_MILLI_UNITS = 1000 as MilliUnits;

/** Constructs a `MilliUnits` value, asserting it is a safe integer (INV-6). */
export function toMilliUnits(value: number): MilliUnits {
  assertSafeInteger(value, "milliUnits");
  return value as MilliUnits;
}

/** Display abbreviation per stored unit. `UNIT` shows as lowercase `u`. */
const UNIT_LABELS: Record<Unit, string> = {
  G: "g",
  KG: "kg",
  ML: "ml",
  L: "l",
  UNIT: "u",
};

/**
 * Format milli-units as an es-BO quantity string in the item's own unit:
 *   1500  KG   → "1,5 kg"
 *   12000 UNIT → "12 u"
 *   250   G    → "0,25 g"   (250 milli-grams of a gram-based item)
 *   -1500 KG   → "-1,5 kg"  (movements may be negative)
 *
 * Decimal separator is `,`, thousands separator `.` (Bolivian convention).
 * Up to 3 decimal places (milli precision) with trailing zeros trimmed, so
 * `1,5 kg` not `1,500 kg`, and `12 u` not `12,0 u`.
 */
export function formatQty(milliUnits: number, unit: Unit): string {
  assertSafeInteger(milliUnits, "milliUnits");
  if (!UNITS.includes(unit)) {
    throw new RangeError(`formatQty: unknown unit ${String(unit)}`);
  }

  const negative = milliUnits < 0;
  const abs = Math.abs(milliUnits);
  // scale-factor-ok: formatQty intentionally separates whole and fractional milli-units
  const intPart = Math.floor(abs / 1000);
  // scale-factor-ok: formatQty intentionally isolates the fractional milli-unit remainder
  const milliRemainder = abs % 1000; // 0 .. 999

  const decimals = milliRemainder.toString().padStart(3, "0").replace(/0+$/, ""); // trim trailing zeros → "5", "25", "" ...
  const numberStr =
    decimals.length > 0 ? `${groupThousands(intPart)},${decimals}` : groupThousands(intPart);

  const sign = negative && milliUnits !== 0 ? "-" : "";
  return `${sign}${numberStr} ${UNIT_LABELS[unit]}`;
}

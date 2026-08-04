// Quantity primitives — INV-6 (Doc 04 §2).
//
// Representation: quantity is an INTEGER number of MILLI-UNITS of the item's
// canonical stored unit (1.5 kg for a KG item → 1500; 12 units for a UNIT item
// → 12000). Small family members are input/display-only and are converted here.

import { UNITS, type Unit } from "./enums";
import { assertSafeInteger, groupThousands } from "./numeric";

/**
 * An integer number of milli-units of the item's canonical stored unit (INV-6,
 * ADR-017): 1.5 kg (unit=KG) → `1500`; 12 units (unit=UNIT) → `12000`.
 */
export type MilliUnits = number & { readonly __brand: "MilliUnits" };

/** One whole canonical unit, expressed in milli-units. */
export const WHOLE_UNIT_MILLI_UNITS = 1000 as MilliUnits;

export const SMALL_DISPLAY_UNITS = ["G", "ML", "CM"] as const;
export type SmallDisplayUnit = (typeof SMALL_DISPLAY_UNITS)[number];
export type QtyDisplayUnit = Unit | SmallDisplayUnit;

export const MASS_SMALL_UNIT_MILLI_UNITS = 1;
export const VOLUME_SMALL_UNIT_MILLI_UNITS = 1;
export const LENGTH_SMALL_UNIT_MILLI_UNITS = 10;
const FLOATING_POINT_TOLERANCE_MULTIPLIER = 4;

const SMALL_DISPLAY_UNIT_BY_CANONICAL: Readonly<Record<Unit, SmallDisplayUnit | undefined>> = {
  KG: "G",
  L: "ML",
  M: "CM",
  UNIT: undefined,
};

const MILLI_UNITS_PER_DISPLAY_UNIT: Readonly<Record<QtyDisplayUnit, number>> = {
  KG: WHOLE_UNIT_MILLI_UNITS,
  G: MASS_SMALL_UNIT_MILLI_UNITS,
  L: WHOLE_UNIT_MILLI_UNITS,
  ML: VOLUME_SMALL_UNIT_MILLI_UNITS,
  M: WHOLE_UNIT_MILLI_UNITS,
  CM: LENGTH_SMALL_UNIT_MILLI_UNITS,
  UNIT: WHOLE_UNIT_MILLI_UNITS,
};

/** Constructs a `MilliUnits` value, asserting it is a safe integer (INV-6). */
export function toMilliUnits(value: number): MilliUnits {
  assertSafeInteger(value, "milliUnits");
  return value as MilliUnits;
}

/** Display abbreviation per canonical and small display unit. */
const UNIT_LABELS: Readonly<Record<QtyDisplayUnit, string>> = {
  G: "g",
  KG: "kg",
  ML: "ml",
  L: "L",
  M: "m",
  CM: "cm",
  UNIT: "u",
};

export function compatibleUnitsFor(canonical: Unit): readonly QtyDisplayUnit[] {
  const small = SMALL_DISPLAY_UNIT_BY_CANONICAL[canonical];
  return small === undefined ? [canonical] : [small, canonical];
}

export function defaultDisplayUnitFor(canonical: Unit): QtyDisplayUnit {
  return SMALL_DISPLAY_UNIT_BY_CANONICAL[canonical] ?? canonical;
}

export function inferDisplayUnitFromMilliUnits(
  milliUnits: number,
  canonical: Unit,
): QtyDisplayUnit {
  assertSafeInteger(milliUnits, "milliUnits");
  if (milliUnits === 0 || Math.abs(milliUnits) >= WHOLE_UNIT_MILLI_UNITS) {
    return canonical;
  }
  return defaultDisplayUnitFor(canonical);
}

function assertCompatibleDisplayUnit(displayUnit: QtyDisplayUnit, canonical: Unit): void {
  if (!compatibleUnitsFor(canonical).includes(displayUnit)) {
    throw new RangeError(`${displayUnit} is not compatible with canonical unit ${canonical}`);
  }
}

export function convertDisplayValueToMilliUnits(
  displayValue: number,
  displayUnit: QtyDisplayUnit,
  canonical: Unit,
): MilliUnits {
  assertCompatibleDisplayUnit(displayUnit, canonical);
  const scaledValue = displayValue * MILLI_UNITS_PER_DISPLAY_UNIT[displayUnit];
  const nearestInteger = Math.round(scaledValue);
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(scaledValue)) * FLOATING_POINT_TOLERANCE_MULTIPLIER;
  if (Math.abs(scaledValue - nearestInteger) > tolerance) {
    throw new RangeError(`${displayValue} ${displayUnit} cannot be represented in milli-units`);
  }
  return toMilliUnits(nearestInteger);
}

export function convertMilliUnitsToDisplayValue(
  milliUnits: number,
  displayUnit: QtyDisplayUnit,
  canonical: Unit,
): number {
  assertSafeInteger(milliUnits, "milliUnits");
  assertCompatibleDisplayUnit(displayUnit, canonical);
  return milliUnits / MILLI_UNITS_PER_DISPLAY_UNIT[displayUnit];
}

function formatDisplayValue(displayValue: number): string {
  const negative = displayValue < 0;
  const [whole = "0", decimals] = Math.abs(displayValue).toString().split(".");
  const numberString = decimals
    ? `${groupThousands(Number(whole))},${decimals}`
    : groupThousands(Number(whole));
  return `${negative ? "-" : ""}${numberString}`;
}

/**
 * Format canonical milli-units as an es-BO quantity string, selecting a small
 * display unit for non-zero magnitudes below one canonical unit.
 */
export function formatQty(milliUnits: number, unit: Unit): string {
  assertSafeInteger(milliUnits, "milliUnits");
  if (!UNITS.includes(unit)) {
    throw new RangeError(`formatQty: unknown unit ${String(unit)}`);
  }

  const displayUnit = inferDisplayUnitFromMilliUnits(milliUnits, unit);
  const displayValue = convertMilliUnitsToDisplayValue(milliUnits, displayUnit, unit);
  return `${formatDisplayValue(displayValue)} ${UNIT_LABELS[displayUnit]}`;
}

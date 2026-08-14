import {
  type MilliCentavosPerUnit,
  roundHalfUpToInt,
  subMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";

import { validationError } from "../errors.js";

function assertSafeIntegerInput(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationError(`${label} debe ser un entero seguro.`, { [label]: value });
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw validationError(`${label} debe ser un número finito no negativo.`, { [label]: value });
  }
}

export interface AssemblyCostLine {
  /** Milli-units; must be a positive safe integer. */
  qty: number;
  /** Integer milli-centavos per whole unit; must be non-negative. */
  unitCost: MilliCentavosPerUnit;
}

/** C-3d live preview: Σ(component qty × unit cost) / output qty, rounded half-up once. */
export function computeAssemblyCostPerOutputUnit(
  lines: readonly AssemblyCostLine[],
  outputQty: number,
): number {
  assertSafeIntegerInput(outputQty, "outputQty");
  if (outputQty <= 0) {
    throw validationError("La cantidad de salida debe ser un entero positivo.", { outputQty });
  }

  let totalMcMilliUnits = 0;
  for (const line of lines) {
    assertSafeIntegerInput(line.qty, "qty");
    if (line.qty <= 0) {
      throw validationError("La cantidad de la línea debe ser un entero positivo.", {
        qty: line.qty,
      });
    }
    assertFiniteNonNegative(line.unitCost, "unitCost");
    assertSafeIntegerInput(line.unitCost, "unitCost");
    if (line.unitCost < 0) {
      throw validationError("El costo unitario debe ser un entero no negativo.", {
        unitCost: line.unitCost,
      });
    }
    totalMcMilliUnits += line.qty * line.unitCost;
  }

  return totalCentavos(
    toMilliCentavosPerUnit(roundHalfUpToInt(totalMcMilliUnits / outputQty)),
    WHOLE_UNIT_MILLI_UNITS,
  );
}

export interface AssemblyMargin {
  amount: number;
  pctBasisPoints: number;
}

export function computeAssemblyMargin(
  salePriceMc: MilliCentavosPerUnit | null,
  costPerOutputUnit: number,
): AssemblyMargin | null {
  if (salePriceMc === null || salePriceMc === 0) return null;
  assertSafeIntegerInput(salePriceMc, "salePriceMc");
  assertSafeIntegerInput(costPerOutputUnit, "costPerOutputUnit");

  const salePrice = totalCentavos(salePriceMc, WHOLE_UNIT_MILLI_UNITS);
  const amount = subMoney(salePrice, toCentavos(costPerOutputUnit));
  const pctBasisPoints = roundHalfUpToInt((amount * 10000) / salePrice);
  return { amount, pctBasisPoints };
}

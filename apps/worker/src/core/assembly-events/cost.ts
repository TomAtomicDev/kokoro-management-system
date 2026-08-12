import type { Centavos, MilliCentavosPerUnit } from "@kokoro/shared";
import { addMoney, rateFromTotal, toCentavos, toMilliUnits, totalCentavos } from "@kokoro/shared";

/** C-10: transfer the complete snapshotted component value into the actual assembly output. */
export function computeAssemblyCost(
  consumptions: readonly { qty: number; unitCostSnapshotMc: MilliCentavosPerUnit }[],
  actualOutputQty: number,
): { directCost: Centavos; outputUnitCostMc: MilliCentavosPerUnit } {
  const directCost: Centavos =
    consumptions.length === 0
      ? toCentavos(0)
      : addMoney(
          ...consumptions.map((consumption) =>
            totalCentavos(consumption.unitCostSnapshotMc, toMilliUnits(consumption.qty)),
          ),
        );
  const outputUnitCostMc = rateFromTotal(directCost, toMilliUnits(actualOutputQty));
  return { directCost, outputUnitCostMc };
}

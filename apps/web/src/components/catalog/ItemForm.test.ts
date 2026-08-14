import { toMilliCentavosPerUnit } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatCostRateInput } from "@/lib/cost-rate";
import { type ItemFormValues, itemFormValuesFromDto, parseItemFormValues } from "./ItemForm";

describe("parseItemFormValues replacement cost", () => {
  it("property: an unmetered replacement cost preserves every raw rate exactly", () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000_000 }), (rawRate) => {
        const values: ItemFormValues = {
          name: "Agua",
          kind: "RAW_MATERIAL",
          category: "INGREDIENT",
          unit: "L",
          salePrice: "",
          minStockQty: "0",
          replacementCostMc: formatCostRateInput(toMilliCentavosPerUnit(rawRate)),
          isUnmetered: true,
          notes: "",
        };

        const parsed = parseItemFormValues(values);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value.replacementCostMc).not.toBeNull();
          if (parsed.value.replacementCostMc !== null) {
            expect(parsed.value.replacementCostMc).toBe(rawRate);
          }
        }
      }),
    );
  });

  it("reports excess replacement-cost precision specifically", () => {
    const values: ItemFormValues = {
      name: "Agua",
      kind: "RAW_MATERIAL",
      category: "INGREDIENT",
      unit: "L",
      salePrice: "",
      minStockQty: "0",
      replacementCostMc: "0.002307",
      isUnmetered: true,
      notes: "",
    };

    expect(parseItemFormValues(values)).toEqual({
      ok: false,
      field: "replacementCostMc",
      code: "replacementCostMcTooManyDecimals",
    });
  });

  it("formats precise replacement costs without changing two-decimal sale prices", () => {
    const values = itemFormValuesFromDto({
      name: "Agua",
      kind: "FINISHED",
      category: "INGREDIENT",
      unit: "L",
      salePriceMc: toMilliCentavosPerUnit(1_250_000),
      minStockQty: null,
      replacementCostMc: toMilliCentavosPerUnit(231),
      isUnmetered: false,
      notes: null,
    });

    expect(values.salePrice).toBe("12.5");
    expect(values.replacementCostMc).toBe("0.00231");
  });
});

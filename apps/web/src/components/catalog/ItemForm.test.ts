import { totalCentavos, WHOLE_UNIT_MILLI_UNITS } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatIntAsDecimalInput } from "@/lib/decimal";
import { type ItemFormValues, parseItemFormValues } from "./ItemForm";

describe("parseItemFormValues replacement cost", () => {
  it("property: an unmetered replacement cost stays in the integer money domain", () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000_000 }), (centavos) => {
        const values: ItemFormValues = {
          name: "Agua",
          kind: "RAW_MATERIAL",
          category: "INGREDIENT",
          unit: "L",
          salePrice: "",
          minStockQty: "0",
          replacementCostMc: formatIntAsDecimalInput(centavos, 2),
          isUnmetered: true,
          notes: "",
        };

        const parsed = parseItemFormValues(values);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value.replacementCostMc).not.toBeNull();
          if (parsed.value.replacementCostMc !== null) {
            expect(totalCentavos(parsed.value.replacementCostMc, WHOLE_UNIT_MILLI_UNITS)).toBe(
              centavos,
            );
          }
        }
      }),
    );
  });
});

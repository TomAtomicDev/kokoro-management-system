import { toMilliCentavosPerUnit } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatCostRateInput } from "@/lib/cost-rate";
import {
  type ItemFormValues,
  itemFormValuesFromDto,
  parseItemFormValues,
  validateItemFormFields,
} from "./ItemForm";

describe("parseItemFormValues semi-finished stock threshold", () => {
  const baseValues: ItemFormValues = {
    name: "Masa madre activada",
    kind: "SEMI_FINISHED",
    category: "BAKERY",
    unit: "KG",
    salePrice: "",
    minStockQty: "",
    replacementCostMc: "",
    isUnmetered: false,
    notes: "",
  };

  it("accepts an optional low-stock threshold", () => {
    const result = parseItemFormValues({ ...baseValues, minStockQty: "1.5" });

    expect(result).toMatchObject({ ok: true, value: { minStockQty: 1500 } });
  });

  it("accepts no low-stock threshold", () => {
    const result = parseItemFormValues(baseValues);

    expect(result).toMatchObject({ ok: true, value: { minStockQty: null } });
  });
});

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

describe("validateItemFormFields (KOK-143 live validation)", () => {
  const baseValues: ItemFormValues = {
    name: "Masa madre activada",
    kind: "SEMI_FINISHED",
    category: "BAKERY",
    unit: "KG",
    salePrice: "",
    minStockQty: "",
    replacementCostMc: "",
    isUnmetered: false,
    notes: "",
  };

  it("returns no errors for a valid semi-finished item", () => {
    expect(validateItemFormFields(baseValues)).toEqual({});
  });

  it("reports several simultaneous field errors, not just the first", () => {
    const errors = validateItemFormFields({
      ...baseValues,
      name: "",
      kind: "RAW_MATERIAL",
      minStockQty: "",
    });

    expect(errors).toEqual({
      name: "nameRequired",
      minStockQty: "minStockQtyRequired",
    });
  });

  it("requires a sale price for FINISHED items", () => {
    const errors = validateItemFormFields({ ...baseValues, kind: "FINISHED" });
    expect(errors.salePrice).toBe("salePriceRequired");
  });

  it("forbids a sale price outside FINISHED", () => {
    const errors = validateItemFormFields({
      ...baseValues,
      kind: "RAW_MATERIAL",
      salePrice: "12.50",
      minStockQty: "0",
    });
    expect(errors.salePrice).toBe("salePriceForbidden");
  });

  it("flags an unparseable value over the required/forbidden rule", () => {
    const errors = validateItemFormFields({ ...baseValues, kind: "FINISHED", salePrice: "abc" });
    expect(errors.salePrice).toBe("salePriceInvalid");
  });

  it("agrees with parseItemFormValues on the first error it would report", () => {
    fc.assert(
      fc.property(
        fc.record({
          name: fc.constantFrom("", "Harina"),
          kind: fc.constantFrom("RAW_MATERIAL", "SEMI_FINISHED", "FINISHED", "PACKAGING"),
          salePrice: fc.constantFrom("", "abc", "5.00"),
          minStockQty: fc.constantFrom("", "abc", "1"),
        }),
        ({ name, kind, salePrice, minStockQty }) => {
          const values: ItemFormValues = {
            ...baseValues,
            name,
            kind,
            salePrice,
            minStockQty,
          };
          const parsed = parseItemFormValues(values);
          const fieldErrors = validateItemFormFields(values);
          if (!parsed.ok) {
            expect(fieldErrors[parsed.field]).toBe(parsed.code);
          }
        },
      ),
    );
  });
});

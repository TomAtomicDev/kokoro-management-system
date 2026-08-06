import { describe, expect, it } from "vitest";

import { STARTER_RECIPES } from "./StepRecipes";

describe("starter recipe quantities", () => {
  it("stores mass quantities as milli-KG without an extra 1000x conversion", () => {
    expect(STARTER_RECIPES).toEqual([
      expect.objectContaining({
        name: "Alimentar masa madre",
        expectedYieldQty: 200,
        lines: [
          { itemName: "Harina", qty: 100 },
          { itemName: "Agua", qty: 100 },
        ],
      }),
      expect.objectContaining({
        name: "Activar masa madre",
        expectedYieldQty: 700,
        lines: [
          { itemName: "Masa madre refrigerada", qty: 150 },
          { itemName: "Harina", qty: 300 },
          { itemName: "Agua", qty: 300 },
        ],
      }),
      expect.objectContaining({
        name: "Pan blanco pequeño",
        expectedYieldQty: 4_000,
        lines: [
          { itemName: "Harina", qty: 580 },
          { itemName: "Masa madre activada", qty: 150 },
          { itemName: "Agua", qty: 345 },
          { itemName: "Sal", qty: 2 },
        ],
      }),
    ]);
  });
});

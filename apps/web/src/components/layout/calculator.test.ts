import { describe, expect, it } from "vitest";

import { evaluateExpression, formatCalculatorNumber } from "./calculator-logic";

describe("evaluateExpression", () => {
  it("respects multiplication and division precedence", () => {
    expect(evaluateExpression("2+3×4")).toEqual({ value: 14 });
    expect(evaluateExpression("18÷3-2")).toEqual({ value: 4 });
  });

  it("accepts Spanish comma decimals and unary minus", () => {
    expect(evaluateExpression("-1,5+2")).toEqual({ value: 0.5 });
  });

  it("guards incomplete expressions and division by zero", () => {
    expect(evaluateExpression("12+")).toEqual({ error: "invalidExpression" });
    expect(evaluateExpression("10÷0")).toEqual({ error: "divisionByZero" });
  });
});

describe("formatCalculatorNumber", () => {
  it("uses the Spanish decimal separator without currency decoration", () => {
    expect(formatCalculatorNumber(1234.5)).toBe("1234,5");
  });
});

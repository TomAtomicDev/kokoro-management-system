import { describe, expect, it } from "vitest";

import { sanitizeDecimalInput, sanitizeNumericInput } from "./input";

describe("numeric input sanitizers", () => {
  it("keeps digits and accepts either decimal separator", () => {
    expect(sanitizeDecimalInput("12a,3")).toBe("12,3");
    expect(sanitizeDecimalInput("12.3")).toBe("12.3");
  });

  it("keeps only the first decimal separator", () => {
    expect(sanitizeDecimalInput("1,2.3")).toBe("1,23");
  });

  it("removes letters and separators from integer-only inputs", () => {
    expect(sanitizeNumericInput("1a2,3")).toBe("123");
  });
});

import { describe, expect, it } from "vitest";

import { safeText } from "./text";

describe("safeText", () => {
  it("strips control and invisible formatting characters", () => {
    expect(safeText(100).parse("texto\u0000\u0007\u0085\u200B\u200Elimpio")).toBe("textolimpio");
  });

  it("preserves ordinary whitespace for multi-line text", () => {
    expect(safeText(100).parse("línea 1\t\nlínea 2")).toBe("línea 1\t\nlínea 2");
  });

  it("enforces the maximum length after sanitizing", () => {
    expect(safeText(5).parse("ab\u0000cde")).toBe("abcde");
    expect(safeText(5).safeParse("abcdef").success).toBe(false);
  });

  it("preserves accented Spanish text", () => {
    expect(safeText(200).parse("Ñandú, acción, ¿Qué tal?")).toBe("Ñandú, acción, ¿Qué tal?");
  });
});

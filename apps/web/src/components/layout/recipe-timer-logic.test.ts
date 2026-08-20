import { describe, expect, it } from "vitest";

import {
  formatRecipeTimerDuration,
  formatSuggestedRecipeTimer,
  parseRecipeTimerDuration,
} from "./recipe-timer-logic";

describe("recipe timer duration", () => {
  it("parses minutes and seconds from the start", () => {
    expect(parseRecipeTimerDuration("12:30")).toBe(750);
    expect(parseRecipeTimerDuration("0:05")).toBe(5);
    expect(parseRecipeTimerDuration(" 01:09 ")).toBe(69);
  });

  it("rejects whole-minute input and invalid seconds", () => {
    expect(parseRecipeTimerDuration("12")).toBeNull();
    expect(parseRecipeTimerDuration("12:60")).toBeNull();
    expect(parseRecipeTimerDuration("0:00")).toBeNull();
    expect(parseRecipeTimerDuration("1:5")).toBeNull();
  });

  it("formats timer values with a two-digit seconds field", () => {
    expect(formatRecipeTimerDuration(5)).toBe("00:05");
    expect(formatRecipeTimerDuration(750)).toBe("12:30");
    expect(formatSuggestedRecipeTimer(8)).toBe("08:00");
    expect(formatSuggestedRecipeTimer(null)).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import { getRecipeTimerRemainingSeconds, type RecipeTimerState } from "./recipe-timer-context";

const timer: RecipeTimerState = {
  recipeId: "recipe-1",
  recipeName: "Receta de prueba",
  durationSeconds: 90,
  startedAt: 1_000,
  status: "running",
};

describe("recipe timer timestamps", () => {
  it("derives remaining time from the wall-clock timestamp", () => {
    expect(getRecipeTimerRemainingSeconds(timer, 1_000)).toBe(90);
    expect(getRecipeTimerRemainingSeconds(timer, 1_001 + 30_000)).toBe(60);
    expect(getRecipeTimerRemainingSeconds(timer, 91_001)).toBe(0);
  });

  it("keeps a completed timer at zero", () => {
    expect(getRecipeTimerRemainingSeconds({ ...timer, status: "completed" }, 1_000)).toBe(0);
  });
});

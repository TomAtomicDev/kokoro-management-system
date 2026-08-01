export { getRecipeSettingsDto, toRecipeDto } from "./dto.js";
export {
  getRecipe,
  listRecipes,
  recordRecipe,
  setRecipeActive,
  updateRecipe,
} from "./recipes.js";
// theoretical-cost.ts's pure math (computeTheoreticalCostPerOutputUnit, computeRecipeMargin) is
// deliberately NOT re-exported here (per the KOK-025 task spec) — it is imported directly by dto.ts
// (its one call site) and by its own test file, never through this barrel.

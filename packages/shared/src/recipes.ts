// Recipe command DTOs (KOK-025, Doc 03 §3/§4 C-3b, Doc 04 §3.1, Doc 07 SC-06). Single-contract rule
// (D-4): the API route and any future web form / AI draft tool for recipes import these same
// schemas — never redeclare field validation elsewhere.
//
// Recipes are catalog/config, not a movement-affecting business event (Doc 03 §3's Recipe row):
// no kardex, no financial transaction, no `confirm`/replay dance like purchasing.ts's template.
// "Delete" is a soft deactivate (`is_active = 0`, mirroring `items.is_active` — see the KOK-025 KB
// amendment on Doc 03's Recipe aggregate row), so it reuses catalog.ts's `setItemActiveCommandSchema`
// shape rather than purchasing.ts's soft-delete-with-confirm shape.
//
// Theoretical-cost/margin fields on `RecipeDto` are LIVE, uncached derived values (C-3b) — never
// caller-supplied, never written to `items.wac`/`items.replacement_cost` (that cache is C-3's job,
// KOK-029, and only for the *default* recipe).

import { z } from "zod";
import { safeText } from "./text.js";

const recipeNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre de la receta es obligatorio.")
  .pipe(safeText(200));
const notesSchema = z.string().trim().pipe(safeText(2000)).nullable().optional();
/** Milli-units of the output item's own stored unit (Doc 04 §2), matching qty.ts. Always positive
 * — a recipe with zero expected yield can't price anything (division by zero). */
const expectedYieldQtySchema = z
  .number()
  .int()
  .positive("El rendimiento esperado debe ser un entero positivo (mili-unidades).");
/** Minutes, informative only (C-7) — never enters the theoretical-cost calc. */
const estLaborMinSchema = z.number().int().nonnegative().nullable().optional();
/** Milli-units of the line item's own stored unit. Always positive — a recipe line with zero qty
 * is not a line. */
const lineQtySchema = z
  .number()
  .int()
  .positive("La cantidad de la línea debe ser un entero positivo (mili-unidades).");

export const recipeLineCommandSchema = z.object({
  itemId: z.string().min(1),
  qty: lineQtySchema,
});
export type RecipeLineCommand = z.infer<typeof recipeLineCommandSchema>;

export const recordRecipeCommandSchema = z.object({
  name: recipeNameSchema,
  outputItemId: z.string().min(1),
  expectedYieldQty: expectedYieldQtySchema,
  estLaborMin: estLaborMinSchema,
  isDefault: z.boolean().default(false),
  notes: notesSchema,
  lines: z.array(recipeLineCommandSchema).min(1, "Se requiere al menos un ingrediente."),
});
export type RecordRecipeCommand = z.input<typeof recordRecipeCommandSchema>;

/**
 * Full replacement, same shape as create (mirrors purchasing.ts's `updatePurchaseCommandSchema`
 * precedent: the caller sends the complete edited recipe, not a patch — same lines, same yield,
 * same default flag). `id` travels in the URL, not the body (matches purchasing's PATCH route).
 */
export const updateRecipeCommandSchema = recordRecipeCommandSchema;
export type UpdateRecipeCommand = z.input<typeof updateRecipeCommandSchema>;

/** Deactivate/reactivate (soft delete per the KOK-025 KB amendment) — mirrors catalog.ts's
 * `setItemActiveCommandSchema` shape exactly, since recipes deactivate the same way items do. */
export const setRecipeActiveCommandSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});
export type SetRecipeActiveCommand = z.infer<typeof setRecipeActiveCommandSchema>;

/** GET /recipes query filters. */
export const listRecipesFiltersSchema = z.object({
  outputItemId: z.string().min(1).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});
export type ListRecipesFilters = z.infer<typeof listRecipesFiltersSchema>;

export interface RecipeLineDto {
  id: string;
  itemId: string;
  /** Milli-units (Doc 04 §2). */
  qty: number;
}

/** One theoretical-cost valuation of a recipe, per output unit (C-3b). Never cached, never written
 * to `items.wac`/`items.replacement_cost`. */
export interface RecipeCostDto {
  /** Centavos per WHOLE output unit (INV-6), rounded half-up (final money amount, D-5) — directly
   * comparable to `items.salePrice`. */
  costPerOutputUnit: number;
  /** `price − costPerOutputUnit` and its percentage over price (C-5), `null` when the output item
   * has no `salePrice` set yet (nothing to compare against). */
  margin: { amount: number; pctBasisPoints: number } | null;
}

export interface RecipeDto {
  id: string;
  name: string;
  outputItemId: string;
  /** Milli-units (Doc 04 §2). */
  expectedYieldQty: number;
  estLaborMin: number | null;
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
  lines: RecipeLineDto[];
  /** C-3b, WAC basis — "calculado", never editable. */
  theoreticalCostWac: RecipeCostDto;
  /** C-3b, replacement-cost basis — "calculado", never editable; Doc 06 principle 4: this is the
   * figure the UI must render as the prominent one, amber/red against `settings.min_margin_pct`. */
  theoreticalCostReplacement: RecipeCostDto;
  createdAt: string;
  updatedAt: string;
}

/** `app_settings.min_margin_pct` (C-5, basis points) riding along on every recipe response so the
 * web `MarginBadge` never hardcodes the threshold — a single source of truth shared with the
 * future Price-health screen (KOK-036). Not per-recipe data; repeated on each result shape purely
 * because there is no dedicated settings-read endpoint yet. */
export interface RecipeSettingsDto {
  minMarginPct: number;
}

export interface RecordRecipeResult {
  recipe: RecipeDto;
  settings: RecipeSettingsDto;
}

export interface UpdateRecipeResult {
  recipe: RecipeDto;
  settings: RecipeSettingsDto;
}

export interface SetRecipeActiveResult {
  recipe: RecipeDto;
  settings: RecipeSettingsDto;
}

export interface GetRecipeResult {
  recipe: RecipeDto;
  settings: RecipeSettingsDto;
}

export interface ListRecipesResult {
  recipes: RecipeDto[];
  settings: RecipeSettingsDto;
}

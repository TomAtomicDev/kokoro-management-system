// Catalog command DTOs (KOK-011, Doc 04 Ãƒâ€šÃ‚Â§3.1, Doc 07 SC-15). Single-contract rule (D-4): the
// API route, the web forms, and any future AI draft tool for items/aliases all import these same
// schemas ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â never redeclare field validation elsewhere.
//
// wac / replacementCostUpdatedAt are absent from every command schema below: they are
// system-derived (Doc 03 C-1/C-3) and never user-settable. replacementCostMc is the one
// exception (Doc 03 C-9): owner-editable, but only for an isUnmetered RAW_MATERIAL item, since
// that's the only case where C-3's purchase-driven cost never runs.

import { z } from "zod";

import type { ItemCategory, ItemKind, Unit } from "./enums.js";
import { itemCategorySchema, itemKindSchema, unitSchema } from "./enums.js";
import { type MilliCentavosPerUnit, toMilliCentavosPerUnit } from "./money.js";
import { safeText } from "./text.js";

export const ITEM_NAME_MAX_LENGTH = 200;
export const ITEM_ALIAS_MAX_LENGTH = 200;

const itemNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio.")
  .pipe(safeText(ITEM_NAME_MAX_LENGTH));
const aliasSchema = z
  .string()
  .trim()
  .min(1, "El alias no puede estar vacío.")
  .pipe(safeText(ITEM_ALIAS_MAX_LENGTH));
const notesSchema = z.string().trim().pipe(safeText(2000)).nullable().optional();
/** Centavos, matching money.ts's Centavos representation (INV-6). */
const salePriceMcSchema = z
  .number()
  .int()
  .nonnegative()
  .transform(toMilliCentavosPerUnit)
  .nullable()
  .optional();
/** Milli-units, matching qty.ts's representation (INV-6). */
const minStockQtySchema = z.number().int().nonnegative().nullable().optional();
/** RAW_MATERIAL-only (Doc 03 C-9, KOK-1xx): exempts the item from purchases/exits/kardex. */
const isUnmeteredSchema = z.boolean().optional();
/** Centavos, matching money.ts's Centavos representation (INV-6). Owner-editable only when
 * isUnmetered=true (Doc 03 C-9) — every other kind/flag combination keeps this system-derived. */
const replacementCostMcSchema = z
  .number()
  .int()
  .nonnegative()
  .transform(toMilliCentavosPerUnit)
  .nullable()
  .optional();

const salePriceRequiredMessage = "El precio de venta es obligatorio para productos finales.";
const salePriceForbiddenMessage =
  "El precio de venta no aplica a materias primas, semielaborados ni empaques.";
const minStockQtyRequiredMessage = "Define un stock mínimo para materias primas y empaques.";
const minStockQtyForbiddenMessage = "El stock mínimo no aplica a productos finales.";
const isUnmeteredForbiddenMessage = '"No medido" solo aplica a materias primas.';
const replacementCostMcForbiddenMessage =
  "El costo de reposición solo es editable para materias primas no medidas.";

function addKindExclusiveIssues(
  value: {
    kind?: ItemKind;
    salePriceMc?: MilliCentavosPerUnit | null;
    minStockQty?: number | null;
    isUnmetered?: boolean;
    replacementCostMc?: MilliCentavosPerUnit | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.kind === undefined) return;

  const hasSalePrice = value.salePriceMc !== undefined && value.salePriceMc !== null;
  const hasMinStockQty = value.minStockQty !== undefined && value.minStockQty !== null;
  const requiresMinStockQty = value.kind === "RAW_MATERIAL" || value.kind === "PACKAGING";
  const allowsMinStockQty = requiresMinStockQty || value.kind === "SEMI_FINISHED";

  if (value.kind === "FINISHED" && !hasSalePrice) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: salePriceRequiredMessage,
      path: ["salePriceMc"],
    });
  } else if (value.kind !== "FINISHED" && hasSalePrice) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: salePriceForbiddenMessage,
      path: ["salePriceMc"],
    });
  }

  if (requiresMinStockQty && !hasMinStockQty) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: minStockQtyRequiredMessage,
      path: ["minStockQty"],
    });
  } else if (!allowsMinStockQty && hasMinStockQty) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: minStockQtyForbiddenMessage,
      path: ["minStockQty"],
    });
  }

  if (value.kind !== "RAW_MATERIAL" && value.isUnmetered) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: isUnmeteredForbiddenMessage,
      path: ["isUnmetered"],
    });
  }

  const hasReplacementCostMc =
    value.replacementCostMc !== undefined && value.replacementCostMc !== null;
  if (hasReplacementCostMc && !(value.kind === "RAW_MATERIAL" && value.isUnmetered)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: replacementCostMcForbiddenMessage,
      path: ["replacementCostMc"],
    });
  }
}

export const createItemCommandSchema = z
  .object({
    name: itemNameSchema,
    kind: itemKindSchema,
    category: itemCategorySchema,
    unit: unitSchema,
    salePriceMc: salePriceMcSchema,
    minStockQty: minStockQtySchema,
    isUnmetered: isUnmeteredSchema,
    replacementCostMc: replacementCostMcSchema,
    notes: notesSchema,
  })
  .superRefine((value, ctx) => addKindExclusiveIssues(value, ctx));
export type CreateItemCommand = z.infer<typeof createItemCommandSchema>;

export const updateItemCommandSchema = z
  .object({
    id: z.string().min(1),
    name: itemNameSchema.optional(),
    kind: itemKindSchema.optional(),
    category: itemCategorySchema.optional(),
    unit: unitSchema.optional(),
    salePriceMc: salePriceMcSchema,
    minStockQty: minStockQtySchema,
    isUnmetered: isUnmeteredSchema,
    replacementCostMc: replacementCostMcSchema,
    notes: notesSchema,
  })
  .superRefine((value, ctx) => addKindExclusiveIssues(value, ctx));
export type UpdateItemCommand = z.infer<typeof updateItemCommandSchema>;

export const setItemActiveCommandSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});
export type SetItemActiveCommand = z.infer<typeof setItemActiveCommandSchema>;

export const addItemAliasCommandSchema = z.object({
  itemId: z.string().min(1),
  alias: aliasSchema,
});
export type AddItemAliasCommand = z.infer<typeof addItemAliasCommandSchema>;

export const removeItemAliasCommandSchema = z.object({
  aliasId: z.string().min(1),
});
export type RemoveItemAliasCommand = z.infer<typeof removeItemAliasCommandSchema>;

/** Merges `sourceItemId` (the duplicate) into `targetItemId` (the canonical item), one-way. */
export const mergeItemsCommandSchema = z
  .object({
    sourceItemId: z.string().min(1),
    targetItemId: z.string().min(1),
  })
  .refine((v) => v.sourceItemId !== v.targetItemId, {
    message: "No puedes fusionar un ítem consigo mismo.",
    path: ["targetItemId"],
  });
export type MergeItemsCommand = z.infer<typeof mergeItemsCommandSchema>;

/**
 * GET /items query filters. `isActive` arrives as a query-string literal ("true"/"false") and is
 * transformed to boolean|undefined; omitted means "any status" (SC-15 shows both active and
 * inactive items in one table, with the active column doubling as the reactivate control).
 */
export const listItemsFiltersSchema = z.object({
  kind: itemKindSchema.optional(),
  category: itemCategorySchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  search: z.string().trim().min(1).pipe(safeText(200)).optional(),
});
export type ListItemsFilters = z.infer<typeof listItemsFiltersSchema>;

export interface ItemAliasDto {
  id: string;
  alias: string;
}

export interface ItemDto {
  id: string;
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  /** Derived (C-1), milli-centavos per WHOLE unit (ADR-017) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â read-only, render with a
   * "calculado" affordance, never editable. */
  wacMc: number;
  /** Derived (C-3), integer milli-centavos per WHOLE unit ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â read-only. */
  replacementCostMc: number;
  replacementCostUpdatedAt: string | null;
  salePriceMc: MilliCentavosPerUnit | null;
  minStockQty: number | null;
  isUnmetered: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  aliases: ItemAliasDto[];
}

export interface ListItemsResult {
  items: ItemDto[];
}

export interface MergeItemsResult {
  target: ItemDto;
  source: ItemDto;
}

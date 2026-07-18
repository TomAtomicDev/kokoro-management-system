// Catalog command DTOs (KOK-011, Doc 04 §3.1, Doc 07 SC-15). Single-contract rule (D-4): the
// API route, the web forms, and any future AI draft tool for items/aliases all import these same
// schemas — never redeclare field validation elsewhere.
//
// wac / replacementCost / replacementCostUpdatedAt are deliberately absent from every command
// schema below: they are system-derived (Doc 03 C-1/C-3) and are never user-settable.

import { z } from "zod";

import type { ItemCategory, ItemKind, Unit } from "./enums.js";
import { itemCategorySchema, itemKindSchema, unitSchema } from "./enums.js";

const itemNameSchema = z.string().trim().min(1, "El nombre es obligatorio.").max(200);
const aliasSchema = z.string().trim().min(1, "El alias no puede estar vacío.").max(200);
const notesSchema = z.string().trim().max(2000).nullable().optional();
/** Centavos, matching money.ts's Centavos representation (INV-6). */
const salePriceSchema = z.number().int().nonnegative().nullable().optional();
/** Milli-units, matching qty.ts's representation (INV-6). */
const minStockQtySchema = z.number().int().nonnegative().nullable().optional();

export const createItemCommandSchema = z.object({
  name: itemNameSchema,
  kind: itemKindSchema,
  category: itemCategorySchema,
  unit: unitSchema,
  salePrice: salePriceSchema,
  minStockQty: minStockQtySchema,
  notes: notesSchema,
});
export type CreateItemCommand = z.infer<typeof createItemCommandSchema>;

export const updateItemCommandSchema = z.object({
  id: z.string().min(1),
  name: itemNameSchema.optional(),
  kind: itemKindSchema.optional(),
  category: itemCategorySchema.optional(),
  unit: unitSchema.optional(),
  salePrice: salePriceSchema,
  minStockQty: minStockQtySchema,
  notes: notesSchema,
});
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
  search: z.string().trim().min(1).optional(),
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
  /** Derived (C-1) — read-only, render with a "calculado" affordance, never editable. */
  wac: number;
  /** Derived (C-3) — read-only, render with a "calculado" affordance, never editable. */
  replacementCost: number;
  replacementCostUpdatedAt: string | null;
  salePrice: number | null;
  minStockQty: number | null;
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

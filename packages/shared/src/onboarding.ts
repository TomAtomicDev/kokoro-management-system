// Onboarding wizard command DTOs (KOK-020, Doc 07 steps 1-5). Single-contract rule (D-4):
// `bulkCreateItemsCommandSchema` reuses `createItemCommandSchema` from catalog.ts directly
// (never redeclares its fields) so the wizard's bulk-import step stays in lockstep with the
// regular single-item create form.

import { z } from "zod";
import type { ItemDto } from "./catalog.js";
import { createItemCommandSchema } from "./catalog.js";
import type { FinancialAccountDto } from "./finance.js";

/** Centavos, matching money.ts's Centavos representation (INV-6). Opening balances are always
 * >= 0 — a negative starting balance isn't a real business state for either seeded account. */
export const setOpeningBalancesCommandSchema = z.object({
  bankOpening: z.number().int().nonnegative(),
  cashOpening: z.number().int().nonnegative(),
});
export type SetOpeningBalancesCommand = z.infer<typeof setOpeningBalancesCommandSchema>;

export const bulkCreateItemsCommandSchema = z.object({
  items: z.array(createItemCommandSchema).min(1, "Debes incluir al menos un ítem."),
});
export type BulkCreateItemsCommand = z.infer<typeof bulkCreateItemsCommandSchema>;

export interface SetOpeningBalancesResult {
  bankAccount: FinancialAccountDto;
  cashAccount: FinancialAccountDto;
}

export interface BulkCreateItemsResult {
  items: ItemDto[];
}

export interface OnboardingStatusResult {
  completed: boolean;
}

export interface OnboardingCompleteResult {
  completed: true;
  completedAt: string;
}

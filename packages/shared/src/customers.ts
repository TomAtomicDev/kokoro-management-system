// Customer command DTOs (KOK-032, Doc 04 §3.3, Doc 06 `CustomerPicker`). Single-contract rule
// (D-4): the API route and the web `CustomerPicker`/`CustomerForm` import these same schemas.
// Deliberately minimal (name/phone/notes only, Doc 01 non-goals: "no CRM ambitions") — no status,
// tags, or interaction history. No delete command: `customers` has neither `is_active` nor
// `deleted_at` (Doc 04 §3.3) and `sales`/`custom_orders` reference it with `ON DELETE RESTRICT`,
// so an unused customer can only ever be edited, never removed, until a real need justifies the
// schema change.

import { z } from "zod";

import { safeText } from "./text.js";

const customerNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio.")
  .pipe(safeText(200));
const phoneSchema = z.string().trim().pipe(safeText(50)).nullable().optional();
const notesSchema = z.string().trim().pipe(safeText(2000)).nullable().optional();

export const createCustomerCommandSchema = z.object({
  name: customerNameSchema,
  phone: phoneSchema,
  notes: notesSchema,
});
export type CreateCustomerCommand = z.infer<typeof createCustomerCommandSchema>;

export const updateCustomerCommandSchema = z.object({
  id: z.string().min(1),
  name: customerNameSchema.optional(),
  phone: phoneSchema,
  notes: notesSchema,
});
export type UpdateCustomerCommand = z.infer<typeof updateCustomerCommandSchema>;

/** GET /customers query filter — `search` matches name/phone (see core/customers/customers.ts). */
export const listCustomersFiltersSchema = z.object({
  search: z.string().trim().min(1).pipe(safeText(200)).optional(),
});
export type ListCustomersFilters = z.infer<typeof listCustomersFiltersSchema>;

export interface CustomerDto {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListCustomersResult {
  customers: CustomerDto[];
}

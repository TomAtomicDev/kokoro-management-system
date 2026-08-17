// Customer command DTOs (KOK-032, Doc 04 §3.3, Doc 06 `CustomerPicker`). Single-contract rule
// (D-4): the API route and the web `CustomerPicker`/`CustomerForm` import these same schemas.
// Deliberately minimal (name/phone/notes only, Doc 01 non-goals: "no CRM ambitions") — no status,
// tags, or interaction history. No delete command: `customers` has neither `is_active` nor
// `deleted_at` (Doc 04 §3.3) and `sales`/`custom_orders` reference it with `ON DELETE RESTRICT`,
// so an unused customer can only ever be edited, never removed, until a real need justifies the
// schema change.

import { z } from "zod";

import { safeText } from "./text.js";

export const CUSTOMER_NAME_MAX_LENGTH = 200;
export const CUSTOMER_PHONE_MAX_LENGTH = 50;
export const CUSTOMER_NOTES_MAX_LENGTH = 2000;

const customerNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre es obligatorio.")
  .pipe(safeText(CUSTOMER_NAME_MAX_LENGTH));
const phoneSchema = z
  .string()
  .trim()
  .pipe(safeText(CUSTOMER_PHONE_MAX_LENGTH))
  .nullable()
  .optional();
const notesSchema = z
  .string()
  .trim()
  .pipe(safeText(CUSTOMER_NOTES_MAX_LENGTH))
  .nullable()
  .optional();

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

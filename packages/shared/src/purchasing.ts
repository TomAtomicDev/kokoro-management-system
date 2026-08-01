// Purchasing command DTOs (KOK-016, Doc 03 UC-01, Doc 04 §3.3/§3.4). Single-contract rule (D-4):
// the API route and any future web form / AI draft tool for purchases import these same schemas —
// never redeclare field validation elsewhere.
//
// This is the TEMPLATE event-vertical schema module: future event verticals (production KOK-026,
// sales KOK-030, exits KOK-018, counts KOK-019) mirror this shape (field schemas -> command schema
// -> hand-written DTOs, matching packages/shared/src/finance.ts's precedent).
//
// Scope: CREATE + READ (KOK-016), plus UPDATE + DELETE + the dry-run impact request (KOK-024,
// Doc 03 §7 R-1/R-3/R-5). There is no client-supplied `total` field on ANY of the command schemas —
// Doc 04 §5's integrity rule requires it to be server-recomputed as Σ lineTotal, never trusted from
// the caller (core/purchasing/index.ts enforces this identically on create and on edit).

import { z } from "zod";

import { confirmFlagSchema } from "./costing.js";
import type { FinancialAccountDto } from "./finance.js";

/** Milli-units of the item's own stored unit (Doc 04 §2), matching qty.ts's representation. Always
 * positive — a purchase line adds stock, it never removes it. */
const qtySchema = z
  .number()
  .int()
  .positive("La cantidad debe ser un entero positivo (mili-unidades).");
/** Centavos (INV-6) for the WHOLE line, not a per-unit price. May be zero (e.g. a free
 * promotional line) but never negative. */
const lineTotalSchema = z
  .number()
  .int()
  .nonnegative("El total de línea debe ser un entero no negativo (centavos).");
/** `YYYY-MM-DD`, America/La_Paz local calendar date (Doc 04 §1, INV-3). */
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener el formato AAAA-MM-DD.");
/** UTC ISO-8601 instant (Doc 04 §1). */
const occurredAtSchema = z
  .string()
  .datetime({ offset: true, message: "occurredAt debe ser una fecha ISO-8601." });

export const purchaseLineCommandSchema = z.object({
  itemId: z.string().min(1),
  qty: qtySchema,
  lineTotal: lineTotalSchema,
});
export type PurchaseLineCommand = z.infer<typeof purchaseLineCommandSchema>;

export const recordPurchaseCommandSchema = z.object({
  supplierName: z.string().trim().max(200).optional(),
  accountId: z.string().min(1),
  // Sessions (KOK-0xx) don't exist yet — accepted and passed through, not validated against a
  // sessions table here (no FK check beyond what the DB's own `ON DELETE restrict` FK enforces at
  // write time).
  sessionId: z.string().min(1).optional(),
  receiptPhotoKey: z.string().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  lines: z.array(purchaseLineCommandSchema).min(1, "Se requiere al menos una línea de compra."),
  // R-5 / ADR-016 (KOK-024): a purchase whose `business_date` lands BEFORE the latest already
  // -processed movement of an item it touches re-weights C-1 for every later kardex entry, which
  // can change cost already booked against a recorded sale/exit. When it does, the service refuses
  // with a CONFLICT carrying a ReplayImpactDto until the caller re-sends with `confirm: true`.
  // Shared flag (D-4) — the same one every other replay-triggering command uses.
  confirm: confirmFlagSchema,
});
/**
 * NOTE the deliberate `z.input` (not `z.infer`): `confirm` is the only field with a Zod `.default()`,
 * and the OUTPUT type would make it REQUIRED on every command literal — including the many
 * unrelated call sites (web mutation hooks, tests) that legitimately omit it and mean "false".
 * The input type keeps it optional; the service reads it as `=== true`, so an omitted flag is the
 * safe value with or without a `.parse()` in front (which is exactly `confirmFlagSchema`'s intent).
 * Every other field is identical between input and output — nothing else here defaults, coerces,
 * or transforms.
 */
export type RecordPurchaseCommand = z.input<typeof recordPurchaseCommandSchema>;

/**
 * UC-01 edit (KOK-024, Doc 03 §7 R-1). Deliberately an ALIAS of the create schema rather than a
 * hand-copied twin: an update is a FULL REPLACEMENT of the purchase's post-state (the caller sends
 * the complete edited invoice, not a patch), so its field set is by definition identical to the
 * create's — same lines, same account, same dates, same `confirm` flag, and the same absence of a
 * client-supplied `total` (Doc 04 §5 keeps that server-recomputed on both paths).
 *
 * Aliasing is the D-4-correct expression of that: two separately-declared object schemas would be a
 * second place for a field to be added, and the first time one of them was missed the API route,
 * the web form, and the AI draft tool would silently disagree about what a purchase is. If a future
 * rule genuinely makes edit and create diverge (e.g. an immutable `accountId`), THIS is the line to
 * fork — with the divergence stated in Doc 03, not discovered in a diff.
 */
export const updatePurchaseCommandSchema = recordPurchaseCommandSchema;
/** `z.input` for the same reason `RecordPurchaseCommand` is — see its note above (`confirm`'s
 * `.default()` would otherwise make the field required on every call site that means "false"). */
export type UpdatePurchaseCommand = z.input<typeof updatePurchaseCommandSchema>;

/**
 * UC-01 delete (KOK-024, R-3 soft delete + R-5 confirmation). Carries ONLY the confirm flag: the
 * server already knows everything else about the purchase being deleted, and accepting any part of
 * its state from the caller would invite a delete that reverses something other than what is
 * actually stored.
 */
export const deletePurchaseCommandSchema = z.object({
  confirm: confirmFlagSchema,
});
/** `z.input` — same `confirm` default reasoning as `RecordPurchaseCommand`. */
export type DeletePurchaseCommand = z.input<typeof deletePurchaseCommandSchema>;

/**
 * Body of the DRY-RUN impact endpoint (R-5 / ADR-016): "what would this create/edit/delete do?",
 * answered before anything is written. One request shape covers all three operations because
 * `planCostingReplay` already does — the preview and the mutation it previews must run the exact
 * same planner, or the preview is a lie with a UI around it (see core/costing/replay.ts's header).
 *
 * Discriminated on `op` so `id` is required exactly where it is meaningful: absent for `create`
 * (the row does not exist yet), required for `update`/`delete`. A plain optional `id` would let
 * `{ op: "update" }` with no id typecheck and fail only at runtime.
 */
export const purchaseImpactRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    command: recordPurchaseCommandSchema,
  }),
  z.object({
    op: z.literal("update"),
    id: z.string().min(1),
    command: updatePurchaseCommandSchema,
  }),
  z.object({
    op: z.literal("delete"),
    id: z.string().min(1),
  }),
]);
/** `z.input` — the nested command schemas carry `confirm`'s default (see `RecordPurchaseCommand`).
 * The dry run ignores `confirm` entirely (it never commits), but the field rides along so the UI can
 * send the identical payload to the preview and then to the mutation. */
export type PurchaseImpactRequest = z.input<typeof purchaseImpactRequestSchema>;

/** GET /purchases query filters — mirrors listTransactionsFiltersSchema's shape (finance.ts). */
export const listPurchasesFiltersSchema = z.object({
  accountId: z.string().min(1).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListPurchasesFilters = z.infer<typeof listPurchasesFiltersSchema>;

export interface PurchaseLineDto {
  id: string;
  itemId: string;
  /** Milli-units (Doc 04 §2). */
  qty: number;
  /** Centavos (INV-6). */
  lineTotal: number;
}

export interface PurchaseDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  supplierName: string | null;
  sessionId: string | null;
  accountId: string;
  /** Centavos (INV-6), server-recomputed as Σ lineTotal — never caller-supplied (Doc 04 §5). */
  total: number;
  receiptPhotoKey: string | null;
  notes: string | null;
  lines: PurchaseLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordPurchaseResult {
  purchase: PurchaseDto;
  account: FinancialAccountDto;
}

/** Mirrors `RecordPurchaseResult`: the purchase in its NEW (post-edit) state, plus the account
 * carrying its post-edit balance. When an edit moves the purchase between accounts this is the
 * DESTINATION account — the one the money now comes out of; the old account's reversal is applied
 * in the same batch but is not what the caller asked about. */
export interface UpdatePurchaseResult {
  purchase: PurchaseDto;
  account: FinancialAccountDto;
}

/** Mirrors `RecordPurchaseResult`. `purchase` is the soft-deleted row as it now stands (R-3: the
 * event survives with `deleted_at` set, so it is still returnable and still reversible for 90 days
 * via audit data), and `account` carries the balance with the purchase's cash effect reversed. */
export interface DeletePurchaseResult {
  purchase: PurchaseDto;
  account: FinancialAccountDto;
}

export interface ListPurchasesResult {
  purchases: PurchaseDto[];
}

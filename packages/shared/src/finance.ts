// Finance command DTOs (KOK-014, Doc 03 UC-11/12/13, Doc 04 §3.4). Single-contract rule (D-4):
// the API route and any future web form (KOK-015) / AI draft tool for finance events import
// these same schemas — never redeclare field validation elsewhere.
//
// Scope (Doc 10 KOK-014): CREATE + READ only for standalone (non-system-owned) financial
// transactions. Edit/delete for financial_transactions — including the general derived-row
// regeneration pattern — is KOK-024's job; this module does not build it. See
// apps/worker/src/core/finance/transactions.ts's `assertTransactionEditable` for the hook left
// for that later task (Doc 04 §5: rows with `source_event_id` set are system-owned).

import { z } from "zod";
import { businessDateSchema, calendarDateSchema, occurredAtSchema } from "./dates.js";
import type {
  FinancialAccountType,
  FinancialTransactionCategory,
  FinancialTransactionType,
} from "./enums.js";
import { financialTransactionCategorySchema } from "./enums.js";
import { safeText } from "./text.js";

/** Centavos, matching money.ts's Centavos representation (INV-6). Always positive — direction
 * comes from `type`, never a signed amount (Doc 04 §3.4). */
const amountSchema = z.number().int().positive("El monto debe ser un entero positivo (centavos).");
const descriptionSchema = z.string().trim().pipe(safeText(2000)).optional();

/**
 * Legal `category` values per `type` for `recordTransaction` (UC-11). The rest of
 * `FINANCIAL_TRANSACTION_CATEGORIES` (SALE, ORDER_DEPOSIT, ORDER_BALANCE, DEBT_COLLECTION,
 * SUPPLY_PURCHASE, DEPOSIT_REFUND) belong to future event services (purchases/sales/orders) that
 * create system-owned rows with a `sourceEventId` — never this standalone command.
 * `OWNER_WITHDRAWAL` and `TRANSFER` are excluded too: they are fixed, non-caller-supplied
 * categories that only `withdraw`/`transfer` may write.
 *
 * Exported so the service (apps/worker/src/core/finance/transactions.ts) enforces the exact same
 * rule instead of re-deriving it: the `.superRefine` below gives instant Zod-level feedback for
 * the API route / future web form, but core/ services don't trust that every caller went through
 * this schema first (e.g. integration tests call the service directly), so the service re-checks
 * using this same constant.
 */
export const RECORD_TRANSACTION_CATEGORIES_BY_TYPE: Record<
  "INCOME" | "EXPENSE",
  readonly FinancialTransactionCategory[]
> = {
  INCOME: ["OTHER_INCOME"],
  EXPENSE: ["OPERATING_EXPENSE", "EQUIPMENT", "OTHER_EXPENSE"],
};

export const recordTransactionCommandSchema = z
  .object({
    accountId: z.string().min(1),
    type: z.enum(["INCOME", "EXPENSE"]),
    // Kept as the full category enum here (not narrowed to the legal subset) so a single Zod type
    // covers both branches of `type`; the superRefine below enforces the actual pairing. Narrowing
    // this field itself would require a discriminated union keyed on `type`, which reads worse for
    // a 2-branch rule and would still need the same cross-field message.
    category: financialTransactionCategorySchema,
    amount: amountSchema,
    businessDate: businessDateSchema,
    occurredAt: occurredAtSchema,
    description: descriptionSchema,
  })
  .superRefine((v, ctx) => {
    const allowed = RECORD_TRANSACTION_CATEGORIES_BY_TYPE[v.type];
    if (!allowed.includes(v.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: `Para type=${v.type} la categoría debe ser una de: ${allowed.join(", ")}.`,
      });
    }
  });
export type RecordTransactionCommand = z.infer<typeof recordTransactionCommandSchema>;

export const transferCommandSchema = z
  .object({
    fromAccountId: z.string().min(1),
    toAccountId: z.string().min(1),
    amount: amountSchema,
    businessDate: businessDateSchema,
    occurredAt: occurredAtSchema,
    description: descriptionSchema,
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: "La cuenta de origen y destino no pueden ser la misma.",
    path: ["toAccountId"],
  });
export type TransferCommand = z.infer<typeof transferCommandSchema>;

export const withdrawCommandSchema = z.object({
  accountId: z.string().min(1),
  amount: amountSchema,
  businessDate: businessDateSchema,
  occurredAt: occurredAtSchema,
  description: descriptionSchema,
});
export type WithdrawCommand = z.infer<typeof withdrawCommandSchema>;

/** GET /finance/transactions query filters — kept simple; a later UI task can extend them. Filter
 * boundaries use `calendarDateSchema`, not `businessDateSchema`: a future-dated range is a
 * legitimate (if empty) query, unlike a transaction's own `businessDate` above. */
export const listTransactionsFiltersSchema = z.object({
  accountId: z.string().min(1).optional(),
  category: financialTransactionCategorySchema.optional(),
  fromDate: calendarDateSchema.optional(),
  toDate: calendarDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListTransactionsFilters = z.infer<typeof listTransactionsFiltersSchema>;

export interface FinancialAccountDto {
  id: string;
  name: string;
  type: FinancialAccountType;
  /** Centavos (INV-6). */
  openingBalance: number;
  /** Centavos (INV-6), derived (INV-5). */
  balance: number;
  isActive: boolean;
}

export interface FinancialTransactionDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  accountId: string;
  type: FinancialTransactionType;
  category: FinancialTransactionCategory;
  /** Centavos (INV-6), always positive — direction comes from `type`. */
  amount: number;
  counterpartTxId: string | null;
  sourceEventType: string | null;
  sourceEventId: string | null;
  /** KOK-185: human-readable code (GTO-/ING-/RET-/TRF-NNNN-YYYY) — assigned ONLY for manual rows
   * (`sourceEventId === null`); a system-owned row (SALE, SUPPLY_PURCHASE, DEBT_COLLECTION,
   * ORDER_DEPOSIT, ORDER_BALANCE, DEPOSIT_REFUND) always carries `code: null` here by design — it
   * inherits its source event's own code for display instead (Doc 07). Both legs of a TRANSFER
   * share the same code. */
  code: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordTransactionResult {
  transaction: FinancialTransactionDto;
  account: FinancialAccountDto;
}

export interface TransferResult {
  outTransaction: FinancialTransactionDto;
  inTransaction: FinancialTransactionDto;
  fromAccount: FinancialAccountDto;
  toAccount: FinancialAccountDto;
}

export interface WithdrawResult {
  transaction: FinancialTransactionDto;
  account: FinancialAccountDto;
}

export interface ListTransactionsResult {
  transactions: FinancialTransactionDto[];
}

export interface ListAccountsResult {
  accounts: FinancialAccountDto[];
}

export interface FinanceSummaryDto {
  /** Centavos (INV-6): current customer_deposits from v_liability (ADR-012 — cash the owner
   * holds but doesn't own yet, until delivery/refund/forfeit). */
  liability: number;
  /** Centavos (INV-6): SUM(total) over v_receivables — every ON_CREDIT sale's uncollected
   * remainder. */
  receivablesTotal: number;
}

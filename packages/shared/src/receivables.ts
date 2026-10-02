// Grouped receivables read contract (KOK-197, Doc 04 §4 / Doc 07 SC-21).

import { z } from "zod";

export const RECEIVABLES_DEFAULT_PAGE_SIZE = 20;
export const RECEIVABLES_MAX_PAGE_SIZE = 100;

/** Search and pagination apply to the grouped list only; the response summary is always global. */
export const listReceivablesQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value ? value : undefined)),
    minAgeDays: z.coerce.number().int().nonnegative().refine(Number.isSafeInteger).optional(),
    sortBy: z.enum(["oldest", "highestBalance"]).default("oldest"),
    page: z.coerce.number().int().positive().refine(Number.isSafeInteger).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(RECEIVABLES_MAX_PAGE_SIZE)
      .default(RECEIVABLES_DEFAULT_PAGE_SIZE),
  })
  .superRefine(({ page, pageSize }, ctx) => {
    if (!Number.isSafeInteger((page - 1) * pageSize)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["page"],
        message: "La página solicitada excede el límite permitido.",
      });
    }
  });
export type ListReceivablesQuery = z.infer<typeof listReceivablesQuerySchema>;

/** One catalog sale or delivered order in a customer's debt group. Monetary values are centavos. */
export interface ReceivablesSaleDto {
  /** Identifies which source record the row represents, even though an order has a linked sale. */
  sourceType: "CATALOG_SALE" | "CUSTOM_ORDER";
  saleId: string;
  /** The source record code (VTA for catalog sales, PED for custom orders). */
  code: string | null;
  /** The linked inventory/COGS sale code; differs from `code` for a custom order. */
  saleCode: string | null;
  occurredAt: string;
  businessDate: string;
  channel: "CATALOG" | "CUSTOM_ORDER";
  /** Full sale amount, including any delivery pass-through. */
  saleTotal: number;
  /** Legacy compatibility field; zero for custom orders because receipts are not applied to sale. */
  depositApplied: number;
  /** Customer price (merchandise subtotal + additional charge), in centavos. */
  customerPrice: number;
  /** Active directly linked manual ORDER_DEPOSIT/ORDER_BALANCE receipts. */
  qualifyingReceipts: number;
  /** Receipt excess above the customer price; never a negative receivable. */
  excess: number;
  /** Positive unpaid remainder; catalog sale behavior remains unchanged. */
  outstandingAmount: number;
  /** Days since sale occurredAt for catalog sales, delivered businessDate for orders. */
  ageDays: number;
  /** Non-null only when this receivable represents a delivered custom order. */
  customOrderId: string | null;
}

export interface ReceivablesCustomerGroupDto {
  groupType: "CUSTOMER";
  customerId: string;
  customerName: string | null;
  /** Sum of the listed sales' outstandingAmount values, in integer centavos. */
  outstandingTotal: number;
  pendingSaleCount: number;
  sales: ReceivablesSaleDto[];
}

/** Sales without a customer share this distinct group but remain separate, identified sale rows. */
export interface ReceivablesNoCustomerGroupDto {
  groupType: "NO_CUSTOMER";
  customerId: null;
  customerName: null;
  /** Sum of the listed sales' outstandingAmount values, in integer centavos. */
  outstandingTotal: number;
  pendingSaleCount: number;
  sales: ReceivablesSaleDto[];
}

export type ReceivablesGroupDto = ReceivablesCustomerGroupDto | ReceivablesNoCustomerGroupDto;

export interface ReceivablesGlobalSummaryDto {
  /** Unfiltered, all-dates sum of catalog debt and positive delivered-order debt, in centavos. */
  receivablesTotal: number;
  /** Distinct identified customers with an active receivable; excludes unassigned sources. */
  debtorCount: number;
  /** Active receivable sources (catalog sales + delivered orders), including unassigned rows. */
  pendingSaleCount: number;
}

export interface ReceivablesPaginationDto {
  page: number;
  pageSize: number;
  totalGroups: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface ReceivablesResponseDto {
  globalSummary: ReceivablesGlobalSummaryDto;
  groups: ReceivablesGroupDto[];
  pagination: ReceivablesPaginationDto;
}

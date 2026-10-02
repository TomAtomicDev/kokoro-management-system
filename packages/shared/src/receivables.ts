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

/** Shared identity/date fields for a catalog sale or delivered custom order receivable. */
interface ReceivableSourceBaseDto {
  saleId: string;
  /** Source code: VTA for catalog sales, PED for custom orders. */
  code: string | null;
  /** The linked inventory/COGS sale code; differs from `code` for a custom order. */
  saleCode: string | null;
  occurredAt: string;
  businessDate: string;
  ageDays: number;
}

/** CATALOG sale receivables preserve UC-04's full-balance collection contract. */
export interface CatalogSaleReceivableDto extends ReceivableSourceBaseDto {
  sourceType: "CATALOG_SALE";
  channel: "CATALOG";
  /** Full sale amount, including any delivery pass-through. */
  saleTotal: number;
  /** Catalog debt remains the full ON_CREDIT sale total. */
  outstandingAmount: number;
  customOrderId: null;
}

/** Custom-order receivables are keyed by the order, not by its inventory/COGS sale snapshot. */
export interface CustomOrderReceivableDto extends ReceivableSourceBaseDto {
  sourceType: "CUSTOM_ORDER";
  channel: "CUSTOM_ORDER";
  /** Generated sale total, retained as source-sale context; not the debt oracle. */
  saleTotal: number;
  /** Customer price (merchandise subtotal + additional charge), in centavos. */
  customerPrice: number;
  /** Active directly linked manual ORDER_DEPOSIT/ORDER_BALANCE receipts. */
  qualifyingReceipts: number;
  /** Receipt excess above the customer price; never a negative receivable. */
  excess: number;
  /** Positive delivered-order remainder. Zero-debt orders are not included in this response. */
  outstandingAmount: number;
  customOrderId: string;
}

export type ReceivableSourceDto = CatalogSaleReceivableDto | CustomOrderReceivableDto;

export interface ReceivablesCustomerGroupDto {
  groupType: "CUSTOMER";
  customerId: string;
  customerName: string | null;
  /** Sum of the listed receivables' outstandingAmount values, in integer centavos. */
  outstandingTotal: number;
  receivableCount: number;
  receivables: ReceivableSourceDto[];
}

/** Sources without a customer share this distinct group but remain separate identified rows. */
export interface ReceivablesNoCustomerGroupDto {
  groupType: "NO_CUSTOMER";
  customerId: null;
  customerName: null;
  /** Sum of the listed receivables' outstandingAmount values, in integer centavos. */
  outstandingTotal: number;
  receivableCount: number;
  receivables: ReceivableSourceDto[];
}

export type ReceivablesGroupDto = ReceivablesCustomerGroupDto | ReceivablesNoCustomerGroupDto;

export interface ReceivablesGlobalSummaryDto {
  /** Unfiltered, all-dates sum of catalog debt and positive delivered-order debt, in centavos. */
  receivablesTotal: number;
  /** Distinct identified customers with an active receivable; excludes unassigned sources. */
  debtorCount: number;
  /** Active receivable sources (catalog sales + delivered orders), including unassigned rows. */
  pendingReceivableCount: number;
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

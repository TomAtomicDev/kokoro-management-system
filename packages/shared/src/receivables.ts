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

/** One source sale in a customer's debt group. All monetary values are integer centavos. */
export interface ReceivablesSaleDto {
  saleId: string;
  code: string | null;
  occurredAt: string;
  businessDate: string;
  channel: "CATALOG" | "CUSTOM_ORDER";
  /** Full sale amount, including any delivery pass-through. */
  saleTotal: number;
  /** Custom-order deposit already received and applied to this sale; zero for catalog sales. */
  depositApplied: number;
  /** Uncollected remainder, net of any custom-order deposit. */
  outstandingAmount: number;
  /** Days since occurredAt, as derived by v_receivables. */
  ageDays: number;
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
  /** Unfiltered, all-dates sum of active v_receivables rows, in integer centavos. */
  receivablesTotal: number;
  /** Distinct identified customers with an active receivable; excludes unassigned sales. */
  debtorCount: number;
  /** Active ON_CREDIT sales in v_receivables, including sales without a customer. */
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

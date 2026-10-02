// KOK-197: grouped, all-dates receivables read over v_receivables (Doc 04 §4 / Doc 07 SC-21).

import type {
  ListReceivablesQuery,
  ReceivableSourceDto,
  ReceivablesGroupDto,
  ReceivablesResponseDto,
} from "@kokoro/shared";
import { addMoney, toCentavos } from "@kokoro/shared";
import { sql } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { DomainError } from "../errors.js";
import { getOrderFinanceProjection } from "./order-balances.js";

interface ReceivableQueryRow {
  sale_id: string | null;
  code: string | null;
  occurred_at: string | null;
  business_date: string | null;
  channel: "CATALOG" | null;
  sale_total: number | null;
  view_total: number | null;
  age_days: number | null;
  customer_id: string | null;
  customer_name: string | null;
}

interface ReceivableAmounts {
  saleTotal: number;
  outstandingAmount: number;
}

export interface ReceivableProjectionEntry {
  customerId: string | null;
  customerName: string | null;
  receivable: ReceivableSourceDto;
}

export interface ReceivablesProjection {
  /** Complete, unpaged source for summaries and the future KOK-046 aged-receivable alert. */
  entries: readonly ReceivableProjectionEntry[];
  receivablesTotal: number;
  debtorCount: number;
  pendingReceivableCount: number;
  preDeliveryOrderCashExposure: number;
}

function assertCentavos(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError("INTERNAL", "No se pudo leer el saldo de una deuda.", {
      field: label,
      value,
    });
  }
}

function addCentavos(left: number, right: number): number {
  assertCentavos(left, "groupTotal");
  assertCentavos(right, "outstandingAmount");
  return addMoney(toCentavos(left), toCentavos(right));
}

/**
 * Catalog-sale receivables preserve the existing full-balance collection behavior and are checked
 * against the catalog-only v_receivables view. Custom orders use calculateOrderReceiptBalance.
 */
export function calculateReceivableAmounts(
  saleTotal: number,
  viewOutstanding: number,
): ReceivableAmounts {
  assertCentavos(saleTotal, "saleTotal");
  assertCentavos(viewOutstanding, "viewOutstanding");

  if (saleTotal !== viewOutstanding) {
    throw new DomainError("INTERNAL", "El saldo derivado no coincide con v_receivables.", {
      saleTotal,
      viewOutstanding,
    });
  }

  return { saleTotal, outstandingAmount: saleTotal };
}

/** Groups receivable sources without collapsing unassigned debts into a fictitious customer. */
export function groupReceivableSources(
  rows: readonly ReceivableProjectionEntry[],
): ReceivablesGroupDto[] {
  const groups = new Map<string, ReceivablesGroupDto>();

  for (const row of rows) {
    const key = row.customerId === null ? "no-customer" : `customer:${row.customerId}`;
    let group = groups.get(key);
    if (!group) {
      group =
        row.customerId === null
          ? {
              groupType: "NO_CUSTOMER",
              customerId: null,
              customerName: null,
              outstandingTotal: 0,
              receivableCount: 0,
              receivables: [],
            }
          : {
              groupType: "CUSTOMER",
              customerId: row.customerId,
              customerName: row.customerName,
              outstandingTotal: 0,
              receivableCount: 0,
              receivables: [],
            };
      groups.set(key, group);
    }

    group.outstandingTotal = addCentavos(group.outstandingTotal, row.receivable.outstandingAmount);
    group.receivableCount += 1;
    group.receivables.push(row.receivable);
  }

  return [...groups.values()];
}

function mapReceivableRow(row: ReceivableQueryRow): ReceivableProjectionEntry | null {
  if (
    row.sale_id === null ||
    row.occurred_at === null ||
    row.business_date === null ||
    row.channel !== "CATALOG" ||
    row.sale_total === null ||
    row.view_total === null ||
    row.age_days === null
  ) {
    return null;
  }

  const amounts = calculateReceivableAmounts(row.sale_total, row.view_total);

  return {
    customerId: row.customer_id,
    customerName: row.customer_name,
    receivable: {
      sourceType: "CATALOG_SALE",
      saleId: row.sale_id,
      code: row.code,
      saleCode: row.code,
      occurredAt: row.occurred_at,
      businessDate: row.business_date,
      channel: "CATALOG",
      ...amounts,
      ageDays: row.age_days,
      customOrderId: null,
    },
  };
}

function groupSortValue(
  group: ReceivablesGroupDto,
  sortBy: ListReceivablesQuery["sortBy"],
): number {
  if (sortBy === "highestBalance") return group.outstandingTotal;
  return group.receivables.reduce((oldest, receivable) => Math.max(oldest, receivable.ageDays), 0);
}

const CUSTOMER_COLLATOR = new Intl.Collator("es-BO", { sensitivity: "base" });

/**
 * Canonical unpaged debt/exposure projection for Finance, Dashboard, snapshots, SC-21 and the
 * future KOK-046 aged-receivable alert. Order rows use the shared KOK-205 helper; catalog debt stays
 * on its view. Filters, pagination and board limits never truncate the source set.
 */
export async function getReceivablesProjection(db: Db): Promise<ReceivablesProjection> {
  const [catalogRows, orderProjection] = await Promise.all([
    db.all<ReceivableQueryRow>(sql`
      SELECT
        vr.sale_id,
        vr.code,
        vr.occurred_at,
        vr.business_date,
        vr.channel,
        s.total AS sale_total,
        vr.total AS view_total,
        vr.days_outstanding AS age_days,
        vr.customer_id,
        vr.customer_name
      FROM v_receivables vr
      JOIN sales s ON s.id = vr.sale_id
      ORDER BY vr.days_outstanding DESC, vr.sale_id
    `),
    getOrderFinanceProjection(db),
  ]);

  const allRows = [
    ...catalogRows.flatMap((row) => {
      const mapped = mapReceivableRow(row);
      return mapped === null ? [] : [mapped];
    }),
    ...orderProjection.receivables.map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      receivable: row.receivable,
    })),
  ];

  const receivablesTotal = allRows.reduce(
    (total, row) => addCentavos(total, row.receivable.outstandingAmount),
    0,
  );
  const debtorIds = new Set(allRows.flatMap((row) => (row.customerId ? [row.customerId] : [])));
  const debtorCount = debtorIds.size;
  const pendingReceivableCount = allRows.length;
  assertCentavos(receivablesTotal, "globalReceivablesTotal");
  if (
    !Number.isSafeInteger(debtorCount) ||
    debtorCount < 0 ||
    !Number.isSafeInteger(pendingReceivableCount) ||
    pendingReceivableCount < 0
  ) {
    throw new DomainError("INTERNAL", "No se pudo leer el resumen de deudas.");
  }

  return {
    entries: allRows,
    receivablesTotal,
    debtorCount,
    pendingReceivableCount,
    preDeliveryOrderCashExposure: orderProjection.preDeliveryOrderCashExposure,
  };
}

/** Complete sources are projected before search, age filters, or customer-group pagination. */
export async function listGroupedReceivables(
  db: Db,
  query: ListReceivablesQuery,
): Promise<ReceivablesResponseDto> {
  const projection = await getReceivablesProjection(db);
  const filteredRows = projection.entries.filter((row) => {
    if (query.minAgeDays !== undefined && row.receivable.ageDays < query.minAgeDays) return false;
    if (query.search) {
      const search = query.search.toLocaleLowerCase("es-BO");
      const haystack = [
        row.customerName,
        row.receivable.code,
        row.receivable.saleCode,
        row.receivable.sourceType === "CUSTOM_ORDER" ? row.receivable.customOrderId : null,
      ]
        .filter((value): value is string => value !== null)
        .join("\n")
        .toLocaleLowerCase("es-BO");
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  const groupedRows = filteredRows.map((row) => ({
    customerId: row.customerId,
    customerName: row.customerName,
    receivable: row.receivable,
  }));
  const filteredGroups = groupReceivableSources(groupedRows);
  for (const group of filteredGroups) {
    group.receivables.sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.saleId.localeCompare(right.saleId),
    );
  }
  filteredGroups.sort((left, right) => {
    const leftSortValue = groupSortValue(left, query.sortBy);
    const rightSortValue = groupSortValue(right, query.sortBy);
    if (leftSortValue !== rightSortValue) return leftSortValue > rightSortValue ? -1 : 1;
    if (left.customerId === null) return right.customerId === null ? 0 : 1;
    if (right.customerId === null) return -1;
    return (
      CUSTOMER_COLLATOR.compare(left.customerName ?? "", right.customerName ?? "") ||
      left.customerId.localeCompare(right.customerId)
    );
  });

  const totalGroups = filteredGroups.length;
  const totalPages = Math.ceil(totalGroups / query.pageSize);
  const offset = (query.page - 1) * query.pageSize;
  const groups = filteredGroups.slice(offset, offset + query.pageSize);

  return {
    globalSummary: {
      receivablesTotal: projection.receivablesTotal,
      debtorCount: projection.debtorCount,
      pendingReceivableCount: projection.pendingReceivableCount,
    },
    groups,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalGroups,
      totalPages,
      hasNextPage: query.page < totalPages,
    },
  };
}

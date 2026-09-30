// KOK-197: grouped, all-dates receivables read over v_receivables (Doc 04 §4 / Doc 07 SC-21).

import type {
  ListReceivablesQuery,
  ReceivablesGroupDto,
  ReceivablesResponseDto,
  ReceivablesSaleDto,
} from "@kokoro/shared";
import { addMoney, subMoney, toCentavos } from "@kokoro/shared";
import { type SQL, sql } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { DomainError } from "../errors.js";

interface ReceivableQueryRow {
  global_total: number;
  debtor_count: number;
  global_pending_sale_count: number;
  total_groups: number;
  sale_id: string | null;
  code: string | null;
  occurred_at: string | null;
  business_date: string | null;
  channel: "CATALOG" | "CUSTOM_ORDER" | null;
  sale_total: number | null;
  deposit_applied: number | null;
  view_total: number | null;
  age_days: number | null;
  custom_order_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  page_order: number | null;
}

interface ReceivableAmounts {
  saleTotal: number;
  depositApplied: number;
  outstandingAmount: number;
}

interface ReceivableGroupRow {
  customerId: string | null;
  customerName: string | null;
  sale: ReceivablesSaleDto;
}

function assertCentavos(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError("INTERNAL", "No se pudo leer el saldo de una venta.", {
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
 * O-2 / Doc 11 §2: a custom-order deposit nets against the full sale total; a zero deposit leaves
 * the full total outstanding. The result is checked against v_receivables so the application DTO
 * and the established view cannot silently disagree.
 */
export function calculateReceivableAmounts(
  saleTotal: number,
  depositApplied: number,
  viewOutstanding: number,
): ReceivableAmounts {
  assertCentavos(saleTotal, "saleTotal");
  assertCentavos(depositApplied, "depositApplied");
  assertCentavos(viewOutstanding, "viewOutstanding");

  const remainder = subMoney(toCentavos(saleTotal), toCentavos(depositApplied));
  const outstandingAmount = remainder > 0 ? remainder : toCentavos(0);
  if (outstandingAmount !== viewOutstanding) {
    throw new DomainError("INTERNAL", "El saldo derivado no coincide con v_receivables.", {
      saleTotal,
      depositApplied,
      viewOutstanding,
      outstandingAmount,
    });
  }

  return { saleTotal, depositApplied, outstandingAmount };
}

/** Groups source sales without collapsing unassigned debts into a fictitious customer. */
export function groupReceivableSales(rows: readonly ReceivableGroupRow[]): ReceivablesGroupDto[] {
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
              pendingSaleCount: 0,
              sales: [],
            }
          : {
              groupType: "CUSTOMER",
              customerId: row.customerId,
              customerName: row.customerName,
              outstandingTotal: 0,
              pendingSaleCount: 0,
              sales: [],
            };
      groups.set(key, group);
    }

    group.outstandingTotal = addCentavos(group.outstandingTotal, row.sale.outstandingAmount);
    group.pendingSaleCount += 1;
    group.sales.push(row.sale);
  }

  return [...groups.values()];
}

function receivableWhere(query: ListReceivablesQuery): SQL {
  const conditions: SQL[] = [];

  if (query.search) {
    conditions.push(sql`(
      instr(lower(COALESCE(vr.customer_name, '')), lower(${query.search})) > 0
      OR instr(lower(COALESCE(vr.code, '')), lower(${query.search})) > 0
    )`);
  }
  if (query.minAgeDays !== undefined) {
    conditions.push(sql`vr.days_outstanding >= ${query.minAgeDays}`);
  }

  return conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
}

function mapReceivableRow(row: ReceivableQueryRow): ReceivableGroupRow | null {
  if (
    row.sale_id === null ||
    row.occurred_at === null ||
    row.business_date === null ||
    row.channel === null ||
    row.sale_total === null ||
    row.deposit_applied === null ||
    row.view_total === null ||
    row.age_days === null
  ) {
    return null;
  }

  const amounts = calculateReceivableAmounts(row.sale_total, row.deposit_applied, row.view_total);

  return {
    customerId: row.customer_id,
    customerName: row.customer_name,
    sale: {
      saleId: row.sale_id,
      code: row.code,
      occurredAt: row.occurred_at,
      businessDate: row.business_date,
      channel: row.channel,
      ...amounts,
      ageDays: row.age_days,
      customOrderId: row.custom_order_id,
    },
  };
}

/**
 * The summary is deliberately computed from every row in v_receivables. Search, age and group
 * pagination are applied only to the grouped list. The single SQL statement keeps that summary,
 * filtered groups and their source rows on the same D1 read snapshot.
 */
export async function listGroupedReceivables(
  db: Db,
  query: ListReceivablesQuery,
): Promise<ReceivablesResponseDto> {
  const offset = (query.page - 1) * query.pageSize;
  const where = receivableWhere(query);
  const rows = await db.all<ReceivableQueryRow>(sql`
    WITH global_summary AS (
      SELECT
        COALESCE(SUM(total), 0) AS global_total,
        COUNT(DISTINCT customer_id) AS debtor_count,
        COUNT(*) AS global_pending_sale_count
      FROM v_receivables
    ),
    filtered AS (
      SELECT
        vr.sale_id,
        vr.code,
        vr.occurred_at,
        vr.business_date,
        vr.channel,
        vr.total AS view_total,
        vr.days_outstanding AS age_days,
        vr.custom_order_id,
        vr.customer_id,
        vr.customer_name,
        s.total AS sale_total,
        CASE
          WHEN vr.custom_order_id IS NOT NULL THEN COALESCE(o.deposit_paid, 0)
          ELSE 0
        END AS deposit_applied
      FROM v_receivables vr
      JOIN sales s ON s.id = vr.sale_id
      LEFT JOIN custom_orders o
        ON o.id = vr.custom_order_id AND o.deleted_at IS NULL
      ${where}
    ),
    filtered_groups AS (
      SELECT
        customer_id,
        MIN(customer_name) AS customer_name,
        SUM(view_total) AS group_total,
        MAX(age_days) AS oldest_days
      FROM filtered
      GROUP BY customer_id
    ),
    group_count AS (
      SELECT COUNT(*) AS total_groups FROM filtered_groups
    ),
    page_groups AS (
      SELECT
        customer_id,
        ROW_NUMBER() OVER (
          ORDER BY
            ${query.sortBy === "highestBalance" ? sql`group_total DESC` : sql`oldest_days DESC`},
            CASE WHEN customer_id IS NULL THEN 1 ELSE 0 END,
            customer_name COLLATE NOCASE,
            customer_id
        ) AS page_order
      FROM filtered_groups
      ORDER BY
        ${query.sortBy === "highestBalance" ? sql`group_total DESC` : sql`oldest_days DESC`},
        CASE WHEN customer_id IS NULL THEN 1 ELSE 0 END,
        customer_name COLLATE NOCASE,
        customer_id
      LIMIT ${query.pageSize} OFFSET ${offset}
    ),
    paged_rows AS (
      SELECT pg.page_order, f.*
      FROM page_groups pg
      JOIN filtered f ON f.customer_id IS pg.customer_id
    )
    SELECT
      gs.global_total,
      gs.debtor_count,
      gs.global_pending_sale_count,
      gc.total_groups,
      p.sale_id,
      p.code,
      p.occurred_at,
      p.business_date,
      p.channel,
      p.sale_total,
      p.deposit_applied,
      p.view_total,
      p.age_days,
      p.custom_order_id,
      p.customer_id,
      p.customer_name,
      p.page_order
    FROM global_summary gs
    CROSS JOIN group_count gc
    LEFT JOIN paged_rows p ON 1 = 1
    ORDER BY p.page_order, p.occurred_at ASC, p.sale_id ASC
  `);

  const firstRow = rows[0];
  const groups = groupReceivableSales(
    rows.flatMap((row) => {
      const mapped = mapReceivableRow(row);
      return mapped ? [mapped] : [];
    }),
  );
  const totalGroups = firstRow?.total_groups ?? 0;
  const totalPages = Math.ceil(totalGroups / query.pageSize);
  const receivablesTotal = firstRow?.global_total ?? 0;
  const debtorCount = firstRow?.debtor_count ?? 0;
  const pendingSaleCount = firstRow?.global_pending_sale_count ?? 0;
  assertCentavos(receivablesTotal, "globalReceivablesTotal");
  if (
    !Number.isSafeInteger(debtorCount) ||
    debtorCount < 0 ||
    !Number.isSafeInteger(pendingSaleCount) ||
    pendingSaleCount < 0 ||
    !Number.isSafeInteger(totalGroups) ||
    totalGroups < 0
  ) {
    throw new DomainError("INTERNAL", "No se pudo leer el resumen de deudas.");
  }

  return {
    globalSummary: {
      receivablesTotal,
      debtorCount,
      pendingSaleCount,
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

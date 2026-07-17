// Read queries against `v_stock`/`v_kardex` (KOK-017, Doc 04 §4, Doc 07 SC-08). These two SQL
// views are defined only in apps/worker/migrations/0001_init.sql — Drizzle's SQLite dialect
// cannot express `v_kardex`'s window function (running balance) or `v_stock`'s partial
// aggregation (LEFT JOIN + COALESCE against item_stock), so there is no Drizzle table binding for
// either view (see db/schema.ts's header note). Both functions here query them via
// `db.all(sql\`...\`)` — Drizzle's raw-SQL escape hatch — and hand-map the raw snake_case rows
// into the camelCase DTOs declared in packages/shared/src/inventory-views.ts.
//
// Unlike movements.ts's `buildStockMovementStatements` (a WRITE building block that only builds
// statements for a caller's own db.batch()), this file is READ-ONLY: no commands, no db.batch(),
// no mutation of any kind (D-2 is about writes; reads have no such constraint, and these views are
// never write targets — SQLite views are inherently read-only).

import type {
  ItemCategory,
  ItemKind,
  KardexRowDto,
  ListKardexFilters,
  ListKardexResult,
  ListStockFilters,
  ListStockResult,
  StockMovementType,
  StockRowDto,
  Unit,
} from "@kokoro/shared";
import { type SQL, sql } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { validationError } from "../errors.js";

/** Raw `v_stock` row shape (snake_case, exactly the view's SELECT list — Doc 04 §4). SQLite has no
 * boolean type: `is_low_stock` arrives as `0`/`1`. */
interface StockViewRow {
  item_id: string;
  name: string;
  kind: ItemKind;
  category: ItemCategory;
  unit: Unit;
  wac: number;
  replacement_cost: number;
  sale_price: number | null;
  min_stock_qty: number | null;
  is_active: number;
  qty_on_hand: number;
  negative_since: string | null;
  stock_value: number;
  is_low_stock: number;
}

/** Raw `v_kardex` row shape (snake_case, exactly the view's SELECT list — Doc 04 §4). */
interface KardexViewRow {
  id: string;
  occurred_at: string;
  business_date: string;
  item_id: string;
  item_name: string;
  unit: Unit;
  type: StockMovementType;
  qty: number;
  unit_cost: number;
  total_cost: number;
  source_event_type: string;
  source_event_id: string;
  created_at: string;
  running_balance: number;
}

function toStockRowDto(row: StockViewRow): StockRowDto {
  return {
    itemId: row.item_id,
    name: row.name,
    kind: row.kind,
    category: row.category,
    unit: row.unit,
    wac: row.wac,
    replacementCost: row.replacement_cost,
    salePrice: row.sale_price,
    minStockQty: row.min_stock_qty,
    qtyOnHand: row.qty_on_hand,
    negativeSince: row.negative_since,
    stockValue: row.stock_value,
    isLowStock: row.is_low_stock === 1,
  };
}

function toKardexRowDto(row: KardexViewRow): KardexRowDto {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    businessDate: row.business_date,
    itemId: row.item_id,
    itemName: row.item_name,
    unit: row.unit,
    type: row.type,
    qty: row.qty,
    unitCost: row.unit_cost,
    totalCost: row.total_cost,
    sourceEventType: row.source_event_type,
    sourceEventId: row.source_event_id,
    createdAt: row.created_at,
    runningBalance: row.running_balance,
  };
}

/**
 * SC-08's default "Stock" tab. `v_stock` already restricts to `is_active = 1` (the view's own
 * WHERE clause, Doc 04 §4) — inactive items never appear here regardless of filters.
 *
 * Ordering: negative-stock rows first, then low-stock rows, then everything else, all by name
 * within each group — SC-08 calls for "low-stock and negative-stock rows pinned on top" so the
 * owner sees what needs attention without scrolling. `(negative_since IS NOT NULL)` evaluates to
 * 0/1 in SQLite, so `DESC` puts the 1s (flagged) first; same for `is_low_stock DESC`.
 */
export async function listStock(db: Db, filters: ListStockFilters = {}): Promise<ListStockResult> {
  const conditions: SQL[] = [];
  if (filters.kind) conditions.push(sql`kind = ${filters.kind}`);
  if (filters.lowStockOnly) conditions.push(sql`is_low_stock = 1`);
  if (filters.negativeOnly) conditions.push(sql`negative_since IS NOT NULL`);

  const whereClause =
    conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

  const rows = await db.all<StockViewRow>(sql`
    SELECT * FROM v_stock
    ${whereClause}
    ORDER BY (negative_since IS NOT NULL) DESC, is_low_stock DESC, name ASC
  `);

  return { stock: rows.map(toStockRowDto) };
}

/**
 * Per-item movement history for SC-08's "row -> Kardex drawer" interaction (Doc 07). `itemId` is
 * required (see listKardexFiltersSchema's doc comment for why).
 *
 * Ordering: newest-first (`occurred_at DESC, created_at DESC` — the same tiebreak columns the
 * view's own window function partitions/orders by, just reversed, so ties break identically to
 * how the running balance was computed). Doc 07's `KardexView` spec doesn't pin an order; this is
 * the natural read for "what happened to this item" — a drawer opened to answer "why is this
 * number what it is right now" wants the most recent activity on top, not buried after scrolling
 * through the item's entire history. `limit` defaults to 200, matching listTransactions/
 * listPurchases's precedent (finance.ts / purchasing.ts).
 *
 * `itemId` is defensively re-checked here even though `listKardexFiltersSchema` already requires
 * it (D-2-style precedent: core/ services don't trust every caller already ran Zod, e.g. this
 * module's own tests call `listKardex` directly with a hand-built filters object). Without this
 * check a caller-supplied `undefined` would silently bind as SQL NULL and `item_id = NULL` would
 * just return zero rows — a confusing "empty kardex" instead of a clear validation error.
 */
export async function listKardex(db: Db, filters: ListKardexFilters): Promise<ListKardexResult> {
  if (!filters.itemId) {
    throw validationError("Se requiere itemId para consultar el kardex.", {});
  }

  const conditions: SQL[] = [sql`item_id = ${filters.itemId}`];
  if (filters.fromDate) conditions.push(sql`business_date >= ${filters.fromDate}`);
  if (filters.toDate) conditions.push(sql`business_date <= ${filters.toDate}`);

  const limit = filters.limit ?? 200;

  const rows = await db.all<KardexViewRow>(sql`
    SELECT * FROM v_kardex
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY occurred_at DESC, created_at DESC, id DESC
    LIMIT ${limit}
  `);

  return { movements: rows.map(toKardexRowDto) };
}

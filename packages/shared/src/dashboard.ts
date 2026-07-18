// Dashboard summary DTO (KOK-023, Doc 07 SC-01 reduced scope). Served by GET
// /api/dashboard/summary — a read-only composition of three existing read paths (core/finance's
// listAccounts, core/inventory's getStockValueTotal + listStock), not a new business concept of
// its own. Reuses `StockRowDto` (inventory-views.ts) for the low-stock rows rather than
// redefining item fields (single-shape precedent, same spirit as D-4).
//
// SC-01's full scope (sales/profit/Bs-per-hour StatCards, deltas/sparklines, margin-at-risk top-5,
// upcoming orders, the 30-day sales chart, and the general alerts strip) is explicitly OUT of
// scope here — that's KOK-052 "Dashboard v2". This DTO only carries what ships now: cash total
// (bank+cash split), stock value, and the low-stock subset of the alerts strip.

import type { StockRowDto } from "./inventory-views.js";

export interface DashboardCashSummary {
  /** Centavos (INV-6): `acc_bank`'s current balance. */
  bank: number;
  /** Centavos (INV-6): `acc_cash`'s current balance. */
  cash: number;
  /** Centavos (INV-6): bank + cash. */
  total: number;
}

export interface DashboardSummaryDto {
  cash: DashboardCashSummary;
  /** Centavos (INV-6): `SUM(stock_value)` over `v_stock` (core/inventory's getStockValueTotal). */
  stockValue: number;
  /** `v_stock` rows with `isLowStock = true` (core/inventory's `listStock({ lowStockOnly: true })`). */
  lowStock: StockRowDto[];
}

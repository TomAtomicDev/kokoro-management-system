// P0 acceptance gate (Doc 11 §6): "migration 0001 applied cleanly to fresh DB". test/setup.ts
// applies it before this file runs; these assertions confirm the resulting shape and that the
// generated views actually compute (not just that CREATE VIEW parsed).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const EXPECTED_TABLES = [
  "app_settings",
  "assistant_interactions",
  "audit_log",
  "custom_order_lines",
  "custom_orders",
  "customers",
  "daily_snapshots",
  "financial_accounts",
  "financial_transactions",
  "idempotency_keys",
  "inventory_count_lines",
  "inventory_counts",
  "item_aliases",
  "item_stock",
  "items",
  "job_runs",
  "pending_drafts",
  "price_history",
  "production_consumptions",
  "production_runs",
  "purchase_lines",
  "purchases",
  "recipe_lines",
  "recipes",
  "sale_lines",
  "sales",
  "session_costs",
  "sessions",
  "stock_exits",
  "stock_movements",
  "telegram_updates",
];

const EXPECTED_VIEWS = [
  "v_stock",
  "v_kardex",
  "v_price_health",
  "v_receivables",
  "v_liability",
  "v_cashflow_daily",
  "v_session_hours",
  "v_waste",
];

describe("migration 0001", () => {
  it("creates every table from Doc 04 §3", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
  });

  it("creates every view from Doc 04 §4", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const view of EXPECTED_VIEWS) {
      expect(names).toContain(view);
    }
  });

  it("seeds the two financial accounts (Doc 04 §7)", async () => {
    const { results } = await env.DB.prepare(
      "SELECT id, type, balance FROM financial_accounts ORDER BY id",
    ).all<{ id: string; type: string; balance: number }>();
    expect(results).toEqual([
      { id: "acc_bank", type: "BANK", balance: 0 },
      { id: "acc_cash", type: "CASH", balance: 0 },
    ]);
  });

  it("seeds app_settings defaults (Doc 04 §7)", async () => {
    const row = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = 'min_margin_pct'",
    ).first<{ value: string }>();
    expect(row?.value).toBe("3000");
  });

  it("rejects an invalid items.kind via CHECK constraint", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO items (id, name, kind, category, unit, created_at, updated_at)
         VALUES ('bad', 'Bad item', 'NOT_A_KIND', 'OTHER', 'UNIT', '2026-01-01', '2026-01-01')`,
      ).run(),
    ).rejects.toThrow();
  });

  it("v_stock computes stock_value = qty_on_hand x wac and flags low stock", async () => {
    const now = "2026-07-14T10:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO items (id, name, kind, category, unit, wac, min_stock_qty, created_at, updated_at)
         VALUES ('item_test', 'Test flour', 'RAW_MATERIAL', 'INGREDIENT', 'KG', 12.0, 10000, ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        "INSERT INTO item_stock (item_id, qty_on_hand, updated_at) VALUES ('item_test', 5000, ?)",
      ).bind(now),
    ]);

    const row = await env.DB.prepare(
      "SELECT qty_on_hand, stock_value, is_low_stock FROM v_stock WHERE item_id = 'item_test'",
    ).first<{ qty_on_hand: number; stock_value: number; is_low_stock: number }>();

    expect(row).toEqual({ qty_on_hand: 5000, stock_value: 60000, is_low_stock: 1 });
  });

  it("v_kardex computes a running balance per item via window function", async () => {
    const now = "2026-07-14T10:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO items (id, name, kind, category, unit, created_at, updated_at)
         VALUES ('item_kardex_test', 'Kardex test item', 'RAW_MATERIAL', 'INGREDIENT', 'KG', ?, ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO stock_movements
           (id, occurred_at, business_date, item_id, type, qty, unit_cost, total_cost,
            source_event_type, source_event_id, created_at)
         VALUES ('mv_a', ?, '2026-07-14', 'item_kardex_test', 'PURCHASE_IN', 3000, 10, 30000, 'purchase', 'p1', ?)`,
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO stock_movements
           (id, occurred_at, business_date, item_id, type, qty, unit_cost, total_cost,
            source_event_type, source_event_id, created_at)
         VALUES ('mv_b', ?, '2026-07-14', 'item_kardex_test', 'SALE_OUT', -1000, 10, -10000, 'sale', 's1', ?)`,
      ).bind(now, now),
    ]);

    const { results } = await env.DB.prepare(
      "SELECT qty, running_balance FROM v_kardex WHERE item_id = 'item_kardex_test' ORDER BY created_at, id",
    ).all<{ qty: number; running_balance: number }>();

    expect(results).toEqual([
      { qty: 3000, running_balance: 3000 },
      { qty: -1000, running_balance: 2000 },
    ]);
  });
});

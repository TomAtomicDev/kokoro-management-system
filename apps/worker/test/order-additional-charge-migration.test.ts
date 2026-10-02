// KOK-205 migration fixture: upgrade a real D1 fixture from 0026 and verify the additive schema/FKs.
import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { createCustomer } from "../src/core/customers/index.js";
import {
  confirmOrder,
  deliverOrder,
  markOrderReady,
  quoteOrder,
  startOrderProduction,
} from "../src/core/orders/index.js";
import { createDb } from "../src/db/index.js";

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: string | null };
type TableDefinition = { sql: string };

const ACTOR = "OWNER_WEB" as const;
const OCCURRED_AT = "2026-07-20T14:00:00.000Z";
const BUSINESS_DATE = "2026-07-20";

describe("KOK-205 migration 0027", () => {
  it("adds nonnegative zero-default columns and preserves order/sale foreign keys", async () => {
    const fixtureDb = (env as unknown as { MIGRATION_FIXTURE_DB: D1Database }).MIGRATION_FIXTURE_DB;
    const migrations = env.TEST_MIGRATIONS;
    const migrationIndex = migrations.findIndex(
      (migration) => migration.name === "0027_order_additional_charge.sql",
    );
    const migration = migrations[migrationIndex];
    if (migrationIndex < 1 || migration === undefined) {
      throw new Error("KOK-205 migration 0027 was not included after migration 0026");
    }

    await applyD1Migrations(fixtureDb, migrations.slice(0, migrationIndex));
    await applyD1Migrations(fixtureDb, [migration]);

    const [orderColumns, saleColumns, orderDefinition, saleDefinition] = await Promise.all([
      fixtureDb.prepare("PRAGMA table_info(custom_orders)").all<ColumnInfo>(),
      fixtureDb.prepare("PRAGMA table_info(sales)").all<ColumnInfo>(),
      fixtureDb
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'custom_orders'")
        .first<TableDefinition>(),
      fixtureDb
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sales'")
        .first<TableDefinition>(),
    ]);
    for (const column of [
      orderColumns.results.find((candidate) => candidate.name === "additional_charge"),
      saleColumns.results.find((candidate) => candidate.name === "additional_charge"),
    ]) {
      expect(column).toMatchObject({ type: "INTEGER", notnull: 1, dflt_value: "0" });
    }

    for (const definition of [orderDefinition, saleDefinition]) {
      const normalizedSql = definition?.sql.replace(/["`]/g, "").replace(/\s+/g, " ").toLowerCase();
      expect(normalizedSql).toContain("check (additional_charge >= 0)");
    }

    const orderBalanceMigration = migrations.find(
      (candidate) => candidate.name === "0028_derived_order_balances.sql",
    );
    if (!orderBalanceMigration) {
      throw new Error("KOK-207 migration 0028 was not included in TEST_MIGRATIONS");
    }
    await applyD1Migrations(fixtureDb, [orderBalanceMigration]);

    // Populate the customer→order and order→sale relationships through core factories. The
    // resulting FK check verifies the additive migration leaves both existing graphs intact.
    const db = createDb(fixtureDb);
    const customer = await createCustomer(
      db,
      { name: `KOK-205 migration ${crypto.randomUUID()}` },
      ACTOR,
    );
    const item = await createItem(
      db,
      {
        name: `KOK-205 migration item ${crypto.randomUUID()}`,
        kind: "FINISHED",
        category: "BAKERY",
        unit: "UNIT",
      },
      ACTOR,
    );
    const { order } = await quoteOrder(
      db,
      {
        customerId: customer.id,
        description: "Pedido de integridad de migración",
        agreedTotal: 400,
        additionalCharge: 125,
        lines: [{ itemId: item.id, qty: 1000 }],
      },
      ACTOR,
    );
    await confirmOrder(db, order.id, {}, ACTOR);
    await startOrderProduction(db, order.id, ACTOR);
    await markOrderReady(db, order.id, ACTOR);
    const delivery = await deliverOrder(
      db,
      order.id,
      { occurredAt: OCCURRED_AT, businessDate: BUSINESS_DATE },
      ACTOR,
    );

    expect(order.additionalCharge).toBe(125);
    expect(delivery.sale).toMatchObject({
      customOrderId: order.id,
      total: 525,
      additionalCharge: 125,
    });
    expect((await fixtureDb.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});

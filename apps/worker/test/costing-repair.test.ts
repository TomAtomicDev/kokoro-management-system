// Integration tests for core/costing's DB-touching half (KOK-013): detectWacDrift / getCurrentWac
// against real D1, following the same Doc 11 §3 template as inventory.test.ts — seed a fixture
// item + hand-written stock_movements rows (no purchase/sale service exists yet to generate
// them), assert on the returned drift (or lack of it).
//
// detectWacDrift is DETECTION ONLY (KOK-024/ADR-016 demoted the nightly job from repair to
// backstop auditor — see core/costing/repair.ts's header) — it never writes anything, so these
// tests assert `items.wac` stays exactly as seeded and no `costing_repair` audit row appears,
// alongside the returned `WacDrift` shape.
import { env } from "cloudflare:test";
import { generateUuidV7 } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { detectWacDrift, getCurrentWac } from "../src/core/costing/index.js";
import { createDb } from "../src/db/index.js";
import { items, stockMovements } from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;

type TestDb = ReturnType<typeof createDb>;

async function seedItem(db: TestDb, name: string, wac: number) {
  const item = await createItem(
    db,
    { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
    ACTOR,
  );
  await db.update(items).set({ wac }).where(eq(items.id, item.id));
  return item;
}

async function seedMovement(
  db: TestDb,
  opts: {
    itemId: string;
    type: "PURCHASE_IN" | "PRODUCTION_IN" | "PRODUCTION_OUT" | "SALE_OUT" | "EXIT_OUT" | "ADJUST";
    qty: number;
    unitCost: number;
    occurredAt: string;
    createdAt?: string;
  },
) {
  await db.insert(stockMovements).values({
    id: generateUuidV7(),
    occurredAt: opts.occurredAt,
    businessDate: opts.occurredAt.slice(0, 10),
    itemId: opts.itemId,
    type: opts.type,
    qty: opts.qty,
    unitCost: opts.unitCost,
    totalCost: Math.round(opts.qty * opts.unitCost),
    sourceEventType: "test_fixture",
    sourceEventId: "fixture_1",
    createdAt: opts.createdAt ?? opts.occurredAt,
  });
}

describe("getCurrentWac", () => {
  it("returns the item's live wac", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Get current wac item", 123.45);
    await expect(getCurrentWac(db, item.id)).resolves.toBeCloseTo(123.45, 9);
  });

  it("throws NOT_FOUND for a nonexistent item", async () => {
    const db = createDb(env.DB);
    await expect(getCurrentWac(db, "does_not_exist")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("detectWacDrift (R-2 backstop)", () => {
  it("detects >1% drift and reports it WITHOUT writing anything", async () => {
    const db = createDb(env.DB);
    // Seed with a deliberately-wrong wac (100) that disagrees with what the kardex implies.
    const item = await seedItem(db, "Drifted item", 100);

    // True kardex: single purchase of 1000 @ 200 -> correct wac = 200. 100 vs 200 is 50% drift.
    await seedMovement(db, {
      itemId: item.id,
      type: "PURCHASE_IN",
      qty: 1000,
      unitCost: 200,
      occurredAt: "2026-07-01T10:00:00.000Z",
    });

    const drift = await detectWacDrift(db, item.id);
    expect(drift).toEqual({ itemId: item.id, current: 100, recomputed: 200, driftRatio: 1 });

    // Detection only: the stored wac is untouched, and no costing_repair audit row was written
    // (createItem itself writes its own 'create' audit row for this item, so filter to the
    // 'costing_repair' action specifically rather than asserting on entityId alone).
    expect(await getCurrentWac(db, item.id)).toBe(100);
    const auditRows = await db.query.auditLog.findMany({
      where: (t, { and, eq }) => and(eq(t.entityId, item.id), eq(t.action, "costing_repair")),
    });
    expect(auditRows).toHaveLength(0);
  });

  it("returns null when the stored wac already matches the recomputed value (within 1%)", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Correct wac item", 200);

    await seedMovement(db, {
      itemId: item.id,
      type: "PURCHASE_IN",
      qty: 1000,
      unitCost: 200,
      occurredAt: "2026-07-01T10:00:00.000Z",
    });

    const drift = await detectWacDrift(db, item.id);
    expect(drift).toBeNull();
    expect(await getCurrentWac(db, item.id)).toBe(200);
  });

  it("replays movements ordered by occurred_at (with created_at tiebreak), not insertion order", async () => {
    const db = createDb(env.DB);
    const item = await seedItem(db, "Ordering item", 0);

    // Insert the SECOND-in-time movement first, and the FIRST-in-time movement second, to prove
    // the function orders by occurredAt rather than trusting row insertion order.
    await seedMovement(db, {
      itemId: item.id,
      type: "PURCHASE_IN",
      qty: 1000,
      unitCost: 300,
      occurredAt: "2026-07-02T10:00:00.000Z", // later in time
    });
    await seedMovement(db, {
      itemId: item.id,
      type: "PURCHASE_IN",
      qty: 1000,
      unitCost: 100,
      occurredAt: "2026-07-01T10:00:00.000Z", // earlier in time
    });

    // Correct chronological replay: onHand=0,wac=0 -> purchase(100) -> wac=100, onHand=1000
    //  -> purchase(300): (1000*100 + 1000*300)/2000 = 200. Seeded wac (0) vs 200 is >1% drift.
    const drift = await detectWacDrift(db, item.id);
    expect(drift?.recomputed).toBe(200);
  });

  it("throws NOT_FOUND for a nonexistent item", async () => {
    const db = createDb(env.DB);
    await expect(detectWacDrift(db, "does_not_exist")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

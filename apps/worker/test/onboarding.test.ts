// Integration tests for core/settings, core/finance/accounts.ts's setOpeningBalances, and
// core/catalog/bulk-import.ts's bulkCreateItems (KOK-020, Doc 07 steps 1-5). Follows the Doc 11
// §3 template: seed -> execute command -> assert rows + audit_log + atomicity, run against real
// D1 via @cloudflare/vitest-pool-workers.
//
// Storage is isolated per test FILE, not per test (mirrors exits.test.ts/counts.test.ts's
// identical note) — the `beforeEach` below resets both seeded accounts' balance AND
// openingBalance to 0, clears `onboarding_completed_at` from app_settings, and deletes any
// audit_log rows this file's tests create so counts don't leak across tests. Items get unique
// names per test (items.name is UNIQUE) so seeded rows never collide across tests.
import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { bulkCreateItems } from "../src/core/catalog/bulk-import.js";
import { setOpeningBalances } from "../src/core/finance/accounts.js";
import { getSetting, setSetting } from "../src/core/settings/index.js";
import { createDb } from "../src/db/index.js";
import { appSettings, auditLog, financialAccounts } from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const ONBOARDING_KEY = "onboarding_completed_at";

type TestDb = ReturnType<typeof createDb>;

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(inArray(auditLog.entityType, ["financial_accounts", "item"]));
  await db.delete(appSettings).where(eq(appSettings.key, ONBOARDING_KEY));
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db
      .update(financialAccounts)
      .set({ balance: 0, openingBalance: 0 })
      .where(eq(financialAccounts.id, id));
  }
});

describe("core/settings — getSetting/setSetting", () => {
  it("returns null for a never-set key", async () => {
    const db = createDb(env.DB);
    expect(await getSetting(db, "does_not_exist_key")).toBeNull();
  });

  it("round-trips: set then get returns the value", async () => {
    const db = createDb(env.DB);
    await setSetting(db, "test_setting_key", "hello");
    expect(await getSetting(db, "test_setting_key")).toBe("hello");
    // Cleanup — this key isn't reset by beforeEach (only ONBOARDING_KEY is).
    await db.delete(appSettings).where(eq(appSettings.key, "test_setting_key"));
  });

  it("set-then-set-again overwrites (upsert path, not just insert)", async () => {
    const db = createDb(env.DB);
    await setSetting(db, "overwrite_key", "first");
    expect(await getSetting(db, "overwrite_key")).toBe("first");
    await setSetting(db, "overwrite_key", "second");
    expect(await getSetting(db, "overwrite_key")).toBe("second");
    await db.delete(appSettings).where(eq(appSettings.key, "overwrite_key"));
  });
});

describe("core/settings — onboarding status semantics", () => {
  it("no setting -> not completed; after setSetting -> completed", async () => {
    const db = createDb(env.DB);
    expect(await getSetting(db, ONBOARDING_KEY)).toBeNull();
    await setSetting(db, ONBOARDING_KEY, "2026-07-17T10:00:00.000Z");
    expect(await getSetting(db, ONBOARDING_KEY)).toBe("2026-07-17T10:00:00.000Z");
  });
});

describe("setOpeningBalances", () => {
  it("sets BOTH openingBalance and balance for acc_bank and acc_cash", async () => {
    const db = createDb(env.DB);
    const result = await setOpeningBalances(db, { bankOpening: 150000, cashOpening: 20000 }, ACTOR);

    expect(result.bankAccount.openingBalance).toBe(150000);
    expect(result.bankAccount.balance).toBe(150000);
    expect(result.cashAccount.openingBalance).toBe(20000);
    expect(result.cashAccount.balance).toBe(20000);

    const bankRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    const cashRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
    });
    expect(bankRow).toMatchObject({ openingBalance: 150000, balance: 150000 });
    expect(cashRow).toMatchObject({ openingBalance: 20000, balance: 20000 });

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityType, "financial_accounts"), eqOp(t.entityId, "acc_bank")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, action: "set_opening_balances" });
  });

  it("rejects with CONFLICT once onboarding_completed_at is set", async () => {
    const db = createDb(env.DB);
    await setSetting(db, ONBOARDING_KEY, "2026-07-17T10:00:00.000Z");

    await expect(
      setOpeningBalances(db, { bankOpening: 1000, cashOpening: 1000 }, ACTOR),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("bulkCreateItems", () => {
  async function findByName(db: TestDb, name: string) {
    return db.query.items.findFirst({ where: (t, { eq: eqOp }) => eqOp(t.name, name) });
  }

  it("creates N items with correct field values and N audit rows", async () => {
    const db = createDb(env.DB);
    const result = await bulkCreateItems(
      db,
      {
        items: [
          { name: "Bulk item A", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
          { name: "Bulk item B", kind: "RAW_MATERIAL", category: "PACKAGING", unit: "UNIT" },
          { name: "Bulk item C", kind: "FINISHED", category: "BAKERY", unit: "UNIT" },
        ],
      },
      ACTOR,
    );

    expect(result.items).toHaveLength(3);
    for (const dto of result.items) {
      expect(dto.wac).toBe(0);
      expect(dto.replacementCost).toBe(0);
      expect(dto.replacementCostUpdatedAt).toBeNull();
      expect(dto.isActive).toBe(true);
    }

    const rowA = await findByName(db, "Bulk item A");
    expect(rowA).toMatchObject({ wac: 0, replacementCost: 0, isActive: 1 });

    const auditRows = await db.query.auditLog.findMany({
      where: (t, { and, eq: eqOp }) =>
        and(
          eqOp(t.entityType, "item"),
          inArray(
            t.entityId,
            result.items.map((i) => i.id),
          ),
        ),
    });
    expect(auditRows).toHaveLength(3);
    for (const row of auditRows) {
      expect(row).toMatchObject({ actor: ACTOR, action: "create", entityType: "item" });
    }
  });

  it("rejects wholesale when item 2 of 3 self-duplicates item 1's name; none of the three are persisted", async () => {
    const db = createDb(env.DB);

    await expect(
      bulkCreateItems(
        db,
        {
          items: [
            { name: "Self dup item", kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
            { name: "Self dup item", kind: "RAW_MATERIAL", category: "DAIRY", unit: "KG" },
            { name: "Self dup item third", kind: "RAW_MATERIAL", category: "OTHER", unit: "KG" },
          ],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await findByName(db, "Self dup item")).toBeUndefined();
    expect(await findByName(db, "Self dup item third")).toBeUndefined();
  });

  it("rejects wholesale when one item's name collides with a PRE-EXISTING item", async () => {
    const db = createDb(env.DB);
    await bulkCreateItems(
      db,
      {
        items: [
          {
            name: "Pre-existing collide item",
            kind: "RAW_MATERIAL",
            category: "INGREDIENT",
            unit: "KG",
          },
        ],
      },
      ACTOR,
    );

    await expect(
      bulkCreateItems(
        db,
        {
          items: [
            { name: "Fresh sibling item", kind: "RAW_MATERIAL", category: "OTHER", unit: "KG" },
            {
              name: "Pre-existing collide item",
              kind: "RAW_MATERIAL",
              category: "DAIRY",
              unit: "KG",
            },
          ],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await findByName(db, "Fresh sibling item")).toBeUndefined();
  });
});

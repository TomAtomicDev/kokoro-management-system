import { env } from "cloudflare:test";
import {
  addMoney,
  rateFromTotal,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { createItem } from "../src/core/catalog/index.js";
import { recordExit } from "../src/core/inventory/exits.js";
import { listWasteSummary } from "../src/core/inventory/waste.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  financialAccounts,
  financialTransactions,
  stockExits,
  stockMovements,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const OCCURRED_AT_TIME = "T10:00:00.000Z";

type TestDb = ReturnType<typeof createDb>;

async function seedPurchasedItem(
  db: TestDb,
  name: string,
  businessDate: string,
  lineTotal: number,
): Promise<{ id: string }> {
  const item = await createItem(
    db,
    { name, kind: "RAW_MATERIAL", category: "INGREDIENT", unit: "KG" },
    ACTOR,
  );
  await recordPurchase(
    db,
    {
      accountId: "acc_bank",
      occurredAt: `${businessDate}${OCCURRED_AT_TIME}`,
      businessDate,
      lines: [{ itemId: item.id, qty: 1000, lineTotal }],
    },
    ACTOR,
  );
  return item;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "stock_exits"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "stock_exit"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "purchase"));
  await db.delete(stockExits);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("listWasteSummary", () => {
  it("groups exits by month and reason and sorts by newest month then largest cost", async () => {
    const db = createDb(env.DB);
    const item = await seedPurchasedItem(db, "Waste summary basic item", "2026-06-01", 2000);

    for (const [businessDate, reason, qty] of [
      ["2026-06-20", "GIFT_SAMPLE", 10],
      ["2026-07-10", "WASTE", 100],
      ["2026-07-16", "WASTE", 200],
      ["2026-07-18", "SPOILAGE", 50],
    ] as const) {
      await recordExit(
        db,
        {
          itemId: item.id,
          qty,
          reason,
          occurredAt: `${businessDate}${OCCURRED_AT_TIME}`,
          businessDate,
        },
        ACTOR,
      );
    }

    await expect(listWasteSummary(db)).resolves.toEqual({
      summary: [
        { month: "2026-07", reason: "WASTE", exitCount: 2, totalCost: 600 },
        { month: "2026-07", reason: "SPOILAGE", exitCount: 1, totalCost: 100 },
        { month: "2026-06", reason: "GIFT_SAMPLE", exitCount: 1, totalCost: 20 },
      ],
    });
  });

  it("sums each row's sanctioned totalCentavos value for arbitrary safe exit costs", async () => {
    const db = createDb(env.DB);
    let run = 0;

    await fc.assert(
      fc.asyncProperty(
        fc
          .array(
            fc.record({
              qty: fc.integer({ min: 1, max: 1000 }),
              lineTotal: fc.integer({ min: 1, max: 10_000 }),
            }),
            { minLength: 1, maxLength: 6 },
          )
          .map((pairs) =>
            pairs.map((pair) => ({
              ...pair,
              unitCostSnapshotMc: rateFromTotal(toCentavos(pair.lineTotal), toMilliUnits(1000)),
            })),
          ),
        async (pairs) => {
          run += 1;
          const businessDate = `2026-08-${String(run).padStart(2, "0")}`;
          for (const [index, pair] of pairs.entries()) {
            const item = await seedPurchasedItem(
              db,
              `Waste property item ${run}-${index}`,
              businessDate,
              pair.lineTotal,
            );
            await recordExit(
              db,
              {
                itemId: item.id,
                qty: pair.qty,
                reason: "WASTE",
                occurredAt: `${businessDate}${OCCURRED_AT_TIME}`,
                businessDate,
              },
              ACTOR,
            );
          }

          const expectedTotal = addMoney(
            ...pairs.map((pair) =>
              totalCentavos(
                toMilliCentavosPerUnit(pair.unitCostSnapshotMc),
                toMilliUnits(pair.qty),
              ),
            ),
          );
          const result = await listWasteSummary(db, {
            fromDate: businessDate,
            toDate: businessDate,
          });

          expect(result.summary).toEqual([
            {
              month: "2026-08",
              reason: "WASTE",
              exitCount: pairs.length,
              totalCost: expectedTotal,
            },
          ]);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// Integration tests for KOK-185 (Doc 03 INV-12, Doc 04's KOK-185 subsection, migration 0024):
// human-readable event codes ({PREFIX}-{NNNN}-{YYYY}), assigned by an AFTER INSERT/AFTER UPDATE
// SQLite trigger rather than core/ itself (see the migration's header for why). This file locks
// in the code-specific invariants — uniqueness, format, stability across edit, manual-vs-
// system-owned financial rows, and a TRANSFER pair sharing one code — using recordSale/transfer
// as representative examples of the two trigger shapes (a plain AFTER INSERT, and the AFTER
// UPDATE OF counterpart_tx_id special case). Every OTHER entity's create path (purchases,
// production runs, assemblies, orders, sessions, counts, exits) already exercises the identical
// AFTER INSERT trigger through its own existing test file — this file does not re-duplicate that
// coverage, only the properties specific to code assignment itself.
//
// Storage is isolated per test FILE, not per test (@cloudflare/vitest-pool-workers v0.13+) — see
// sales.test.ts's header for the same note. Codes accumulate across tests in this file (the
// counter never resets mid-file), so assertions check FORMAT and RELATIVE ordering/uniqueness,
// never a hardcoded absolute sequence number.
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { transfer } from "../src/core/finance/transfer.js";
import { recordSale, updateSale } from "../src/core/sales/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  financialAccounts,
  financialTransactions,
  saleLines,
  sales,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

type TestDb = ReturnType<typeof createDb>;

const CODE_PATTERN = /^[A-Z]{3}-\d{4}-\d{4}$/;

async function seedFinishedItem(db: TestDb, name: string) {
  return createItem(db, { name, kind: "FINISHED", category: "BAKERY", unit: "UNIT" }, ACTOR);
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog);
  await db.delete(saleLines);
  await db.delete(sales);
  await db.update(financialTransactions).set({ counterpartTxId: null });
  await db.delete(financialTransactions);
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("KOK-185 event codes", () => {
  it("assigns a unique, correctly-formatted VTA- code to each sale, and never reassigns it on edit", async () => {
    const db = createDb(env.DB);
    const item = await seedFinishedItem(db, "Event codes — sale item A");

    const first = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, unitPriceMc: 1_000_000 }],
      },
      ACTOR,
    );
    const second = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, unitPriceMc: 1_000_000 }],
      },
      ACTOR,
    );

    expect(first.sale.code).toMatch(/^VTA-\d{4}-2026$/);
    expect(second.sale.code).toMatch(/^VTA-\d{4}-2026$/);
    expect(second.sale.code).not.toBe(first.sale.code);

    // Stable across an edit: updateSale is a full line-set replacement, but the code column is
    // never in its SET list (core/sales/index.ts's commitSaleMutation) and the trigger only fires
    // WHEN NEW.code IS NULL, which an already-coded row never satisfies again. Kardex-identical
    // edit (same line) so it never trips the unrelated R-5 replay-confirmation guard.
    const edited = await updateSale(
      db,
      first.sale.id,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        notes: "edited",
        lines: [{ itemId: item.id, qty: 1000, unitPriceMc: 1_000_000 }],
      },
      ACTOR,
    );
    expect(edited.sale.code).toBe(first.sale.code);
  });

  it("gives a system-owned INCOME/SALE row no code of its own (it inherits the sale's, Doc 07)", async () => {
    const db = createDb(env.DB);
    const item = await seedFinishedItem(db, "Event codes — sale item B");

    const result = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, unitPriceMc: 1_000_000 }],
      },
      ACTOR,
    );

    const txRow = await db.query.financialTransactions.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.sourceEventType, "sale"), eqOp(t.sourceEventId, result.sale.id)),
    });
    expect(txRow?.category).toBe("SALE");
    expect(txRow?.code).toBeNull();
  });

  it("gives both legs of a transfer the SAME TRF- code, distinct from another transfer's", async () => {
    const db = createDb(env.DB);

    const first = await transfer(
      db,
      {
        fromAccountId: "acc_bank",
        toAccountId: "acc_cash",
        amount: 5000,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        description: undefined,
      },
      ACTOR,
    );
    const second = await transfer(
      db,
      {
        fromAccountId: "acc_cash",
        toAccountId: "acc_bank",
        amount: 1000,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        description: undefined,
      },
      ACTOR,
    );

    expect(first.outTransaction.code).toMatch(/^TRF-\d{4}-2026$/);
    expect(first.outTransaction.code).toBe(first.inTransaction.code);
    expect(second.outTransaction.code).toBe(second.inTransaction.code);
    expect(second.outTransaction.code).not.toBe(first.outTransaction.code);

    // Both legs physically exist as distinct rows with the shared code — the partial unique index
    // (migration 0024) allows this specifically by excluding TRANSFER_IN, not by accident.
    const rows = await db.query.financialTransactions.findMany({
      where: (t, { inArray: inArrayOp }) =>
        inArrayOp(t.id, [
          first.outTransaction.id,
          first.inTransaction.id,
          second.outTransaction.id,
          second.inTransaction.id,
        ]),
    });
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.code)).size).toBe(2);
  });

  it("matches the {PREFIX}-{NNNN}-{YYYY} format exactly (3 letters, 4-digit sequence, 4-digit year)", async () => {
    const db = createDb(env.DB);
    const item = await seedFinishedItem(db, "Event codes — format check item");
    const result = await recordSale(
      db,
      {
        paymentStatus: "PAID",
        paymentMethod: "CASH",
        accountId: "acc_cash",
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: item.id, qty: 1000, unitPriceMc: 1_000_000 }],
      },
      ACTOR,
    );
    expect(result.sale.code).toMatch(CODE_PATTERN);
  });
});

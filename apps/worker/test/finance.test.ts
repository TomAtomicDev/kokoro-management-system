// Integration tests for core/finance (KOK-014, Doc 03 UC-11/12/13). Follows the Doc 11 §3
// template: seed -> execute command -> assert transaction row(s) + account balance delta +
// audit_log entry + atomicity, run against real D1 via @cloudflare/vitest-pool-workers
// (test/setup.ts applies migrations/0001_init.sql first, which seeds `financial_accounts`
// 'acc_bank' (BANK) and 'acc_cash' (CASH), both opening_balance/balance = 0, is_active = 1 — Doc
// 04 §7).
//
// @cloudflare/vitest-pool-workers v0.13+ isolates storage per test FILE, not per test (the old
// `isolatedStorage: true` per-test default was removed — see
// https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-vitest-3-to-vitest-4/).
// The `beforeEach` below restores the per-test guarantee this file's tests were written against:
// both seeded accounts back at balance 0, with no leftover transactions/audit rows from prior tests.
import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getAccount,
  listAccounts,
  listTransactions,
  recordTransaction,
  transfer,
  withdraw,
} from "../src/core/finance/index.js";
import { createDb } from "../src/db/index.js";
import { auditLog, financialAccounts, financialTransactions } from "../src/db/schema.js";

const SEEDED_ACCOUNT_IDS = ["acc_bank", "acc_cash"] as const;

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "financial_transactions"));
  // counterpart_tx_id is a self-referencing FK (ON DELETE restrict, not deferred), so a paired
  // TRANSFER_OUT/TRANSFER_IN row can still be pointed to by its sibling at the moment SQLite
  // deletes it. Null the references out first so the delete below never trips the constraint.
  await db.update(financialTransactions).set({ counterpartTxId: null });
  await db.delete(financialTransactions);
  await db
    .delete(financialAccounts)
    .where(inArray(financialAccounts.id, ["acc_inactive_1", "acc_inactive_2", "acc_inactive_3"]));
  for (const id of SEEDED_ACCOUNT_IDS) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

const ACTOR = "OWNER_WEB" as const;
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

type TestDb = ReturnType<typeof createDb>;

/** Test-only fixture: an inactive account. No command in this task's scope creates
 * financial_accounts (they're seed-only, Doc 04 §7), so unlike business-event fixtures elsewhere
 * (which go through a real core/ service, D-2), this one is a direct insert into what is reference
 * data, not a business event. */
async function seedInactiveAccount(db: TestDb, id: string): Promise<void> {
  await db.insert(financialAccounts).values({
    id,
    name: "Cuenta inactiva",
    type: "CASH",
    openingBalance: 0,
    balance: 0,
    isActive: 0,
  });
}

describe("recordTransaction (UC-11)", () => {
  it("records INCOME/OTHER_INCOME, credits the account, and writes an audit_log entry", async () => {
    const db = createDb(env.DB);
    const result = await recordTransaction(
      db,
      {
        accountId: "acc_bank",
        type: "INCOME",
        category: "OTHER_INCOME",
        amount: 5000,
        businessDate: BUSINESS_DATE,
        occurredAt: NOW,
        description: "Reembolso de proveedor",
      },
      ACTOR,
    );

    expect(result.transaction.type).toBe("INCOME");
    expect(result.transaction.category).toBe("OTHER_INCOME");
    expect(result.transaction.amount).toBe(5000);
    expect(result.transaction.sourceEventId).toBeNull();
    expect(result.transaction.sourceEventType).toBeNull();
    expect(result.transaction.counterpartTxId).toBeNull();
    expect(result.account.balance).toBe(5000);

    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq }) => eq(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(5000);

    const txRow = await db.query.financialTransactions.findFirst({
      where: (t, { eq }) => eq(t.id, result.transaction.id),
    });
    expect(txRow).toMatchObject({ accountId: "acc_bank", type: "INCOME", amount: 5000 });

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { eq, and }) => and(eq(t.entityId, result.transaction.id), eq(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "financial_transactions" });
  });

  it("records EXPENSE/OPERATING_EXPENSE and debits the account", async () => {
    const db = createDb(env.DB);
    const result = await recordTransaction(
      db,
      {
        accountId: "acc_cash",
        type: "EXPENSE",
        category: "OPERATING_EXPENSE",
        amount: 1200,
        businessDate: BUSINESS_DATE,
        occurredAt: NOW,
      },
      ACTOR,
    );

    expect(result.transaction.type).toBe("EXPENSE");
    expect(result.account.balance).toBe(-1200);
  });

  it.each([["EQUIPMENT" as const], ["OTHER_EXPENSE" as const]])(
    "accepts EXPENSE/%s",
    async (category) => {
      const db = createDb(env.DB);
      const result = await recordTransaction(
        db,
        {
          accountId: "acc_cash",
          type: "EXPENSE",
          category,
          amount: 800,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      );
      expect(result.transaction.category).toBe(category);
    },
  );

  it("rejects INCOME paired with a system-owned category (SALE)", async () => {
    const db = createDb(env.DB);
    await expect(
      recordTransaction(
        db,
        {
          accountId: "acc_bank",
          type: "INCOME",
          category: "SALE",
          amount: 100,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq }) => eq(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(0);
  });

  it("rejects EXPENSE paired with an income-only category (OTHER_INCOME)", async () => {
    const db = createDb(env.DB);
    await expect(
      recordTransaction(
        db,
        {
          accountId: "acc_bank",
          type: "EXPENSE",
          category: "OTHER_INCOME",
          amount: 100,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects EXPENSE paired with a fixed category reserved for withdraw() (OWNER_WITHDRAWAL)", async () => {
    const db = createDb(env.DB);
    await expect(
      recordTransaction(
        db,
        {
          accountId: "acc_bank",
          type: "EXPENSE",
          category: "OWNER_WITHDRAWAL",
          amount: 100,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a nonexistent account with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    await expect(
      recordTransaction(
        db,
        {
          accountId: "does_not_exist",
          type: "INCOME",
          category: "OTHER_INCOME",
          amount: 100,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an inactive account with VALIDATION", async () => {
    const db = createDb(env.DB);
    await seedInactiveAccount(db, "acc_inactive_1");

    await expect(
      recordTransaction(
        db,
        {
          accountId: "acc_inactive_1",
          type: "INCOME",
          category: "OTHER_INCOME",
          amount: 100,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("withdraw (UC-13)", () => {
  it("always writes EXPENSE/OWNER_WITHDRAWAL and debits the account", async () => {
    const db = createDb(env.DB);
    const result = await withdraw(
      db,
      {
        accountId: "acc_bank",
        amount: 2500,
        businessDate: BUSINESS_DATE,
        occurredAt: NOW,
        description: "Retiro personal",
      },
      ACTOR,
    );

    expect(result.transaction.type).toBe("EXPENSE");
    expect(result.transaction.category).toBe("OWNER_WITHDRAWAL");
    expect(result.transaction.sourceEventId).toBeNull();
    expect(result.account.balance).toBe(-2500);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { eq, and }) => and(eq(t.entityId, result.transaction.id), eq(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "financial_transactions" });
  });

  it("rejects a nonexistent account with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    await expect(
      withdraw(
        db,
        { accountId: "does_not_exist", amount: 100, businessDate: BUSINESS_DATE, occurredAt: NOW },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("transfer (UC-12)", () => {
  it("creates paired TRANSFER_OUT/TRANSFER_IN rows referencing each other via counterpartTxId and conserves total cash", async () => {
    const db = createDb(env.DB);
    const bankBefore = await getAccount(db, "acc_bank");
    const cashBefore = await getAccount(db, "acc_cash");

    const result = await transfer(
      db,
      {
        fromAccountId: "acc_bank",
        toAccountId: "acc_cash",
        amount: 3000,
        businessDate: BUSINESS_DATE,
        occurredAt: NOW,
        description: "Reposición de caja chica",
      },
      ACTOR,
    );

    expect(result.outTransaction.type).toBe("TRANSFER_OUT");
    expect(result.inTransaction.type).toBe("TRANSFER_IN");
    expect(result.outTransaction.category).toBe("TRANSFER");
    expect(result.inTransaction.category).toBe("TRANSFER");
    expect(result.outTransaction.amount).toBe(3000);
    expect(result.inTransaction.amount).toBe(3000);
    expect(result.outTransaction.counterpartTxId).toBe(result.inTransaction.id);
    expect(result.inTransaction.counterpartTxId).toBe(result.outTransaction.id);
    expect(result.outTransaction.accountId).toBe("acc_bank");
    expect(result.inTransaction.accountId).toBe("acc_cash");

    expect(result.fromAccount.balance).toBe(bankBefore.balance - 3000);
    expect(result.toAccount.balance).toBe(cashBefore.balance + 3000);

    // Money conservation: a transfer never creates or destroys money, only moves it.
    const totalBefore = bankBefore.balance + cashBefore.balance;
    const totalAfter = result.fromAccount.balance + result.toAccount.balance;
    expect(totalAfter).toBe(totalBefore);

    const bankRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq }) => eq(t.id, "acc_bank"),
    });
    const cashRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq }) => eq(t.id, "acc_cash"),
    });
    expect(bankRow?.balance).toBe(-3000);
    expect(cashRow?.balance).toBe(3000);
  });

  it("rejects a transfer to the same account", async () => {
    const db = createDb(env.DB);
    await expect(
      transfer(
        db,
        {
          fromAccountId: "acc_bank",
          toAccountId: "acc_bank",
          amount: 100,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a transfer to a nonexistent account, leaving the source balance unchanged and no rows written", async () => {
    const db = createDb(env.DB);

    await expect(
      transfer(
        db,
        {
          fromAccountId: "acc_bank",
          toAccountId: "does_not_exist",
          amount: 100,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const bankRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq }) => eq(t.id, "acc_bank"),
    });
    expect(bankRow?.balance).toBe(0);

    const rows = await db.query.financialTransactions.findMany({
      where: (t, { eq }) => eq(t.accountId, "acc_bank"),
    });
    expect(rows).toHaveLength(0);
  });

  it("rejects a transfer from/to an inactive account", async () => {
    const db = createDb(env.DB);
    await seedInactiveAccount(db, "acc_inactive_2");

    await expect(
      transfer(
        db,
        {
          fromAccountId: "acc_bank",
          toAccountId: "acc_inactive_2",
          amount: 100,
          businessDate: BUSINESS_DATE,
          occurredAt: NOW,
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("reads: listAccounts / getAccount / listTransactions", () => {
  it("listAccounts returns only active accounts", async () => {
    const db = createDb(env.DB);
    await seedInactiveAccount(db, "acc_inactive_3");

    const { accounts } = await listAccounts(db);
    expect(accounts.map((a) => a.id).sort()).toEqual(["acc_bank", "acc_cash"]);
  });

  it("listTransactions filters by accountId and orders businessDate/createdAt desc", async () => {
    const db = createDb(env.DB);
    await recordTransaction(
      db,
      {
        accountId: "acc_bank",
        type: "INCOME",
        category: "OTHER_INCOME",
        amount: 100,
        businessDate: "2026-07-14",
        occurredAt: "2026-07-14T10:00:00.000Z",
      },
      ACTOR,
    );
    await recordTransaction(
      db,
      {
        accountId: "acc_bank",
        type: "INCOME",
        category: "OTHER_INCOME",
        amount: 200,
        businessDate: "2026-07-16",
        occurredAt: "2026-07-16T10:00:00.000Z",
      },
      ACTOR,
    );
    await recordTransaction(
      db,
      {
        accountId: "acc_cash",
        type: "EXPENSE",
        category: "OPERATING_EXPENSE",
        amount: 50,
        businessDate: "2026-07-15",
        occurredAt: "2026-07-15T10:00:00.000Z",
      },
      ACTOR,
    );

    const { transactions } = await listTransactions(db, { accountId: "acc_bank" });
    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.businessDate)).toEqual(["2026-07-16", "2026-07-14"]);
    expect(transactions.every((t) => t.accountId === "acc_bank")).toBe(true);
  });
});

describe("batch atomicity (INV-1)", () => {
  it("a failing statement in the same batch leaves the account balance and transaction rows unchanged", async () => {
    // Mirrors the exact statement shape recordTransaction() builds (financial_transactions insert
    // + account balance update), but with a category value that violates the
    // financial_transactions_category_check CHECK constraint, run as a raw D1 batch (not a mock)
    // to prove the balance update ahead of it never lands either.
    await expect(
      env.DB.batch([
        env.DB.prepare(
          "UPDATE financial_accounts SET balance = balance + 999 WHERE id = 'acc_bank'",
        ),
        env.DB.prepare(
          `INSERT INTO financial_transactions
             (id, occurred_at, business_date, account_id, type, category, amount, created_at, updated_at)
           VALUES
             ('tx_atomicity_test', ?, ?, 'acc_bank', 'INCOME', 'NOT_A_REAL_CATEGORY', 999, ?, ?)`,
        ).bind(NOW, BUSINESS_DATE, NOW, NOW),
      ]),
    ).rejects.toThrow();

    const accountRow = await env.DB.prepare(
      "SELECT balance FROM financial_accounts WHERE id = 'acc_bank'",
    ).first<{ balance: number }>();
    expect(accountRow?.balance).toBe(0);

    const txRow = await env.DB.prepare(
      "SELECT id FROM financial_transactions WHERE id = 'tx_atomicity_test'",
    ).first();
    expect(txRow).toBeNull();
  });
});

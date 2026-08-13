// Integration tests for core/sessions (KOK-027, Doc 03 §6 UC-14). Follows the Doc 11 §3 template:
// seed -> execute command -> assert event rows + financial transaction + account balance +
// audit_log + atomicity, run against real D1 via @cloudflare/vitest-pool-workers (test/setup.ts
// applies migrations/0001_init.sql first, which seeds `financial_accounts` 'acc_bank' (BANK) and
// 'acc_cash' (CASH), both balance = 0, is_active = 1 — Doc 04 §7).
//
// Storage is isolated per test FILE, not per test (mirrors purchasing.test.ts's identical note) —
// the `beforeEach` below restores the per-test guarantee this file's tests were written against:
// both seeded accounts back at balance 0, no leftover sessions/session_costs/session_cost-sourced
// transactions/audit rows/purchases from prior tests. `purchases` is blanket-cleared here (not just
// scoped to sessions) because this file is the only one in the suite that links a purchase to a
// session (the delete-blocking test) — mirrors purchasing.test.ts's own blanket `delete(purchases)`.
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { createItem } from "../src/core/catalog/index.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import {
  assertNoConflictingOpenSession,
  closeAndStartSession,
  deleteSession,
  getSession,
  listSessions,
  recordSession as recordSessionCore,
  resolveSessionForEvent,
  restoreSession,
  updateSession as updateSessionCore,
} from "../src/core/sessions/index.js";
import { createDb } from "../src/db/index.js";
import {
  auditLog,
  financialAccounts,
  financialTransactions,
  purchases,
  sessions,
} from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const BUSINESS_DATE = "2026-07-16";
const STARTED_AT = "2026-07-16T09:00:00.000Z";
const ENDED_AT = "2026-07-16T11:00:00.000Z";

type TestDb = ReturnType<typeof createDb>;

function recordSession(
  db: TestDb,
  command: Omit<Parameters<typeof recordSessionCore>[1], "startedAt"> & { startedAt?: string },
  actor: Parameters<typeof recordSessionCore>[2],
) {
  return recordSessionCore(db, { startedAt: STARTED_AT, ...command }, actor);
}

function updateSession(
  db: TestDb,
  id: string,
  command: Omit<Parameters<typeof updateSessionCore>[2], "startedAt"> & { startedAt?: string },
  actor: Parameters<typeof updateSessionCore>[3],
) {
  return updateSessionCore(db, id, { startedAt: STARTED_AT, ...command }, actor);
}

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

async function sessionCostTx(db: TestDb, costLineId: string) {
  return db.query.financialTransactions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.sourceEventId, costLineId),
  });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "sessions"));
  await db
    .delete(financialTransactions)
    .where(eq(financialTransactions.sourceEventType, "session_cost"));
  // Clears anything that could FK-restrict a session delete (purchases.session_id is
  // onDelete: "restrict" against sessions) before clearing sessions themselves.
  await db.delete(purchases);
  await db.delete(sessions); // cascades to session_costs (onDelete: cascade, schema.ts).
  for (const id of ["acc_bank", "acc_cash"] as const) {
    await db.update(financialAccounts).set({ balance: 0 }).where(eq(financialAccounts.id, id));
  }
});

describe("resolveSessionForEvent (Doc 03 S-1)", () => {
  it("links an existing matching OPEN session without returning an insert", async () => {
    const db = createDb(env.DB);
    const { session } = await recordSession(
      db,
      { type: "PURCHASE_TRIP", businessDate: BUSINESS_DATE },
      ACTOR,
    );
    const resolved = await resolveSessionForEvent(db, {
      type: "PURCHASE_TRIP",
      occurredAt: STARTED_AT,
      businessDate: BUSINESS_DATE,
    });
    expect(resolved).toEqual({ sessionId: session.id, status: "OPEN", statements: [] });
  });

  it("returns a minimal matching session insert when none is OPEN", async () => {
    const db = createDb(env.DB);
    const resolved = await resolveSessionForEvent(db, {
      type: "PRODUCTION",
      occurredAt: STARTED_AT,
      businessDate: BUSINESS_DATE,
    });
    expect(resolved.statements).toHaveLength(1);
    expect(await db.query.sessions.findFirst()).toBeUndefined();
    const statement = resolved.statements[0];
    if (!statement) throw new Error("expected session insert statement");
    await db.batch([statement]);
    expect(await db.query.sessions.findFirst()).toMatchObject({
      id: resolved.sessionId,
      type: "PRODUCTION",
      businessDate: BUSINESS_DATE,
      startedAt: STARTED_AT,
      status: "OPEN",
    });
  });

  it("honors an explicit matching session even when CLOSED", async () => {
    const db = createDb(env.DB);
    const { session } = await recordSession(
      db,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE, durationMin: 30 },
      ACTOR,
    );
    await updateSession(
      db,
      session.id,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE, durationMin: 30, status: "CLOSED" },
      ACTOR,
    );
    await expect(
      resolveSessionForEvent(db, {
        type: "PRODUCTION",
        occurredAt: STARTED_AT,
        businessDate: BUSINESS_DATE,
        explicitSessionId: session.id,
      }),
    ).resolves.toEqual({ sessionId: session.id, status: "CLOSED", statements: [] });
  });

  it("rejects an explicit session of the wrong type", async () => {
    const db = createDb(env.DB);
    const { session } = await recordSession(
      db,
      { type: "ADMIN", businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await expect(
      resolveSessionForEvent(db, {
        type: "PRODUCTION",
        occurredAt: STARTED_AT,
        businessDate: BUSINESS_DATE,
        explicitSessionId: session.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects an explicit soft-deleted session", async () => {
    const db = createDb(env.DB);
    const { session } = await recordSession(
      db,
      { type: "OTHER", businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await deleteSession(db, session.id, {}, ACTOR);
    await expect(
      resolveSessionForEvent(db, {
        type: "OTHER",
        occurredAt: STARTED_AT,
        businessDate: BUSINESS_DATE,
        explicitSessionId: session.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("assertNoConflictingOpenSession / closeAndStartSession (Doc 03 S-1b)", () => {
  it("guards conflicts while allowing the current session to be excluded", async () => {
    const db = createDb(env.DB);
    const { session } = await recordSession(
      db,
      { type: "ADMIN", businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await expect(assertNoConflictingOpenSession(db, "ADMIN")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(assertNoConflictingOpenSession(db, "ADMIN", session.id)).resolves.toBeUndefined();
  });

  it("atomically closes the old session and opens a same-type replacement with its costs", async () => {
    const db = createDb(env.DB);
    const { session } = await recordSession(
      db,
      { type: "PURCHASE_TRIP", businessDate: BUSINESS_DATE, startedAt: STARTED_AT },
      ACTOR,
    );
    const result = await closeAndStartSession(
      db,
      {
        closeSessionId: session.id,
        newSession: {
          type: "PURCHASE_TRIP",
          businessDate: "2026-07-17",
          startedAt: "2026-07-17T09:00:00.000Z",
          costLines: [{ label: "Taxi", amount: 1200, isEstimate: false, accountId: "acc_bank" }],
        },
      },
      ACTOR,
    );
    expect(result.closedSession).toMatchObject({ id: session.id, status: "CLOSED" });
    expect(result.closedSession.endedAt).not.toBeNull();
    expect(result.newSession).toMatchObject({ type: "PURCHASE_TRIP", status: "OPEN" });
    expect(result.newSession.costLines).toHaveLength(1);
    const openRows = await db.query.sessions.findMany({
      where: (table, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(
          eqOp(table.type, "PURCHASE_TRIP"),
          eqOp(table.status, "OPEN"),
          isNullOp(table.deletedAt),
        ),
    });
    expect(openRows.map((row) => row.id)).toEqual([result.newSession.id]);
    const audits = await db.query.auditLog.findMany({
      where: (table, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(table.entityType, "sessions"), eqOp(table.actor, ACTOR)),
    });
    expect(audits.filter((row) => row.action === "update")).toHaveLength(1);
    expect(audits.filter((row) => row.action === "create")).toHaveLength(2);
  });

  it("refuses a cross-type replacement and an already-CLOSED target", async () => {
    const db = createDb(env.DB);
    const { session } = await recordSession(
      db,
      { type: "ADMIN", businessDate: BUSINESS_DATE, durationMin: 10 },
      ACTOR,
    );
    await expect(
      closeAndStartSession(
        db,
        {
          closeSessionId: session.id,
          newSession: { type: "OTHER", businessDate: BUSINESS_DATE, startedAt: STARTED_AT },
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await updateSession(
      db,
      session.id,
      { type: "ADMIN", businessDate: BUSINESS_DATE, durationMin: 10, status: "CLOSED" },
      ACTOR,
    );
    await expect(
      closeAndStartSession(
        db,
        {
          closeSessionId: session.id,
          newSession: { type: "ADMIN", businessDate: BUSINESS_DATE, startedAt: STARTED_AT },
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("recordSession (UC-14 create)", () => {
  it.each([
    { closingField: "endedAt", command: { endedAt: ENDED_AT } },
    { closingField: "durationMin", command: { durationMin: 45 } },
  ])("is born CLOSED when $closingField is supplied", async ({ command }) => {
    const db = createDb(env.DB);

    const result = await recordSession(
      db,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE, ...command },
      ACTOR,
    );

    expect(result.session.status).toBe("CLOSED");
  });

  it("is born OPEN when neither an end nor duration is supplied", async () => {
    const db = createDb(env.DB);

    const result = await recordSession(
      db,
      { type: "DELIVERY_RUN", businessDate: BUSINESS_DATE },
      ACTOR,
    );

    expect(result.session.status).toBe("OPEN");
  });

  it("records a session with a non-estimate cost line: financial_transactions row, account balance debit, audit_log", async () => {
    const db = createDb(env.DB);

    const result = await recordSession(
      db,
      {
        type: "PRODUCTION",
        businessDate: BUSINESS_DATE,
        startedAt: STARTED_AT,
        endedAt: ENDED_AT,
        costLines: [
          { label: "Transporte", amount: 5000, isEstimate: false, accountId: "acc_bank" },
        ],
      },
      ACTOR,
    );

    expect(result.session.costLines).toHaveLength(1);
    const line = result.session.costLines[0];
    expect(line).toMatchObject({
      label: "Transporte",
      amount: 5000,
      isEstimate: false,
      accountId: "acc_bank",
    });

    const txRow = await sessionCostTx(db, line?.id ?? "");
    expect(txRow).toMatchObject({
      type: "EXPENSE",
      category: "OPERATING_EXPENSE",
      amount: 5000,
      accountId: "acc_bank",
      sourceEventType: "session_cost",
      sourceEventId: line?.id,
    });

    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(-5000);

    const auditRow = await db.query.auditLog.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.entityId, result.session.id), eqOp(t.action, "create")),
    });
    expect(auditRow).toMatchObject({ actor: ACTOR, entityType: "sessions" });
  });

  it("an estimate cost line creates NO financial_transactions row and touches no account balance (Doc 03 §6 S-2)", async () => {
    const db = createDb(env.DB);

    const result = await recordSession(
      db,
      {
        type: "DELIVERY_RUN",
        businessDate: BUSINESS_DATE,
        costLines: [{ label: "Gasolina (estimado)", amount: 3000, isEstimate: true }],
      },
      ACTOR,
    );

    const line = result.session.costLines[0];
    expect(line).toMatchObject({ isEstimate: true, accountId: null });
    expect(await sessionCostTx(db, line?.id ?? "")).toBeUndefined();

    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(0);
  });

  it("a mix of estimate and non-estimate lines only books cash for the non-estimate one", async () => {
    const db = createDb(env.DB);

    const result = await recordSession(
      db,
      {
        type: "ADMIN",
        businessDate: BUSINESS_DATE,
        costLines: [
          { label: "Estimado", amount: 1000, isEstimate: true },
          { label: "Real", amount: 2000, isEstimate: false, accountId: "acc_cash" },
        ],
      },
      ACTOR,
    );

    expect(result.session.costLines).toHaveLength(2);
    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
    });
    expect(accountRow?.balance).toBe(-2000);
  });

  it("a zero-amount non-estimate line skips the financial_transactions row (amount > 0 CHECK), leaving the balance untouched", async () => {
    const db = createDb(env.DB);

    const result = await recordSession(
      db,
      {
        type: "OTHER",
        businessDate: BUSINESS_DATE,
        costLines: [
          { label: "Sin costo aún", amount: 0, isEstimate: false, accountId: "acc_bank" },
        ],
      },
      ACTOR,
    );

    const line = result.session.costLines[0];
    expect(await sessionCostTx(db, line?.id ?? "")).toBeUndefined();
    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(0);
  });

  it("rejects a non-estimate line with no accountId (VALIDATION, D-2 defensive re-check)", async () => {
    const db = createDb(env.DB);

    await expect(
      recordSession(
        db,
        {
          type: "OTHER",
          businessDate: BUSINESS_DATE,
          costLines: [{ label: "Sin cuenta", amount: 1000, isEstimate: false }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a nonexistent account with NOT_FOUND, and an inactive one with VALIDATION", async () => {
    const db = createDb(env.DB);
    await seedInactiveAccount(db, "acc_inactive_session_1");

    await expect(
      recordSession(
        db,
        {
          type: "OTHER",
          businessDate: BUSINESS_DATE,
          costLines: [{ label: "x", amount: 1000, isEstimate: false, accountId: "does_not_exist" }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      recordSession(
        db,
        {
          type: "OTHER",
          businessDate: BUSINESS_DATE,
          costLines: [
            { label: "x", amount: 1000, isEstimate: false, accountId: "acc_inactive_session_1" },
          ],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a session with no cost lines at all is legitimate (Doc 03 §6 has no 'at least one line' rule)", async () => {
    const db = createDb(env.DB);
    const result = await recordSession(db, { type: "OTHER", businessDate: BUSINESS_DATE }, ACTOR);
    expect(result.session.costLines).toEqual([]);
    expect(result.session.status).toBe("OPEN");
  });

  describe("one-OPEN-per-type hard invariant (Doc 03 S-1b)", () => {
    it("allows a same-type session born CLOSED while another session is OPEN", async () => {
      const db = createDb(env.DB);
      await recordSession(db, { type: "PRODUCTION", businessDate: BUSINESS_DATE }, ACTOR);

      const past = await recordSession(
        db,
        { type: "PRODUCTION", businessDate: BUSINESS_DATE, durationMin: 30 },
        ACTOR,
      );

      expect(past.session.status).toBe("CLOSED");
    });

    it("blocks another OPEN session of the same type", async () => {
      const db = createDb(env.DB);

      await recordSession(db, { type: "PRODUCTION", businessDate: BUSINESS_DATE }, ACTOR);
      await expect(
        recordSession(db, { type: "PRODUCTION", businessDate: BUSINESS_DATE }, ACTOR),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("allows simultaneous OPEN sessions of different types", async () => {
      const db = createDb(env.DB);
      await recordSession(db, { type: "PRODUCTION", businessDate: BUSINESS_DATE }, ACTOR);
      const other = await recordSession(
        db,
        { type: "DELIVERY_RUN", businessDate: BUSINESS_DATE },
        ACTOR,
      );
      expect(other.session.status).toBe("OPEN");
    });

    it("allows a replacement after the prior same-type session is CLOSED or soft-deleted", async () => {
      const db = createDb(env.DB);
      const closedSource = await recordSession(
        db,
        { type: "ADMIN", businessDate: BUSINESS_DATE, durationMin: 30 },
        ACTOR,
      );
      await updateSession(
        db,
        closedSource.session.id,
        { type: "ADMIN", businessDate: BUSINESS_DATE, durationMin: 30, status: "CLOSED" },
        ACTOR,
      );
      const afterClose = await recordSession(
        db,
        { type: "ADMIN", businessDate: BUSINESS_DATE },
        ACTOR,
      );
      expect(afterClose.session.status).toBe("OPEN");

      const toDelete = await recordSession(
        db,
        { type: "OTHER", businessDate: BUSINESS_DATE },
        ACTOR,
      );
      await deleteSession(db, toDelete.session.id, {}, ACTOR);
      const afterDelete = await recordSession(
        db,
        { type: "OTHER", businessDate: BUSINESS_DATE },
        ACTOR,
      );
      expect(afterDelete.session.status).toBe("OPEN");
    });
  });
});

describe("updateSession (UC-14 edit / close)", () => {
  it("blocks reopening or retagging into a type that already has another OPEN session", async () => {
    const db = createDb(env.DB);
    const existingOpen = await recordSession(
      db,
      { type: "ADMIN", businessDate: BUSINESS_DATE },
      ACTOR,
    );
    const closed = await recordSession(
      db,
      { type: "OTHER", businessDate: BUSINESS_DATE, durationMin: 20 },
      ACTOR,
    );
    await updateSession(
      db,
      closed.session.id,
      { type: "OTHER", businessDate: BUSINESS_DATE, durationMin: 20, status: "CLOSED" },
      ACTOR,
    );

    await expect(
      updateSession(
        db,
        closed.session.id,
        { type: "ADMIN", businessDate: BUSINESS_DATE, durationMin: 20, status: "OPEN" },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(existingOpen.session.status).toBe("OPEN");
  });

  it("reverses the OLD cost line's transaction and books the NEW one when the cost-line set changes", async () => {
    const db = createDb(env.DB);
    const created = await recordSession(
      db,
      {
        type: "PRODUCTION",
        businessDate: BUSINESS_DATE,
        costLines: [{ label: "Antes", amount: 4000, isEstimate: false, accountId: "acc_bank" }],
      },
      ACTOR,
    );
    const oldLineId = created.session.costLines[0]?.id ?? "";
    expect(
      (
        await db.query.financialAccounts.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
        })
      )?.balance,
    ).toBe(-4000);

    const updated = await updateSession(
      db,
      created.session.id,
      {
        type: "PRODUCTION",
        businessDate: BUSINESS_DATE,
        status: "OPEN",
        costLines: [{ label: "Después", amount: 7000, isEstimate: false, accountId: "acc_bank" }],
      },
      ACTOR,
    );

    // Old line's transaction is gone; the old cost-line id no longer resolves at all (full
    // replacement, mirrors purchase_lines being wholesale replaced on edit).
    expect(await sessionCostTx(db, oldLineId)).toBeUndefined();
    const newLine = updated.session.costLines[0];
    expect(newLine?.id).not.toBe(oldLineId);
    const newTx = await sessionCostTx(db, newLine?.id ?? "");
    expect(newTx).toMatchObject({ amount: 7000, accountId: "acc_bank" });

    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(-7000);
  });

  it("moving a cost line to a different account nets exactly two account balance deltas", async () => {
    const db = createDb(env.DB);
    const created = await recordSession(
      db,
      {
        type: "OTHER",
        businessDate: BUSINESS_DATE,
        costLines: [{ label: "x", amount: 3000, isEstimate: false, accountId: "acc_bank" }],
      },
      ACTOR,
    );

    await updateSession(
      db,
      created.session.id,
      {
        type: "OTHER",
        businessDate: BUSINESS_DATE,
        status: "OPEN",
        costLines: [{ label: "x", amount: 3000, isEstimate: false, accountId: "acc_cash" }],
      },
      ACTOR,
    );

    const bankRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    const cashRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
    });
    expect(bankRow?.balance).toBe(0); // fully reversed
    expect(cashRow?.balance).toBe(-3000); // booked on the new account, not double-counted
  });

  it("closing (status: CLOSED) requires a resolvable duration and rejects otherwise", async () => {
    const db = createDb(env.DB);
    const created = await recordSession(
      db,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE },
      ACTOR,
    );

    await expect(
      updateSession(
        db,
        created.session.id,
        { type: "PRODUCTION", businessDate: BUSINESS_DATE, status: "CLOSED" },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const closedByDuration = await updateSession(
      db,
      created.session.id,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE, durationMin: 45, status: "CLOSED" },
      ACTOR,
    );
    expect(closedByDuration.session.status).toBe("CLOSED");
    expect(closedByDuration.session.durationMin).toBe(45);
  });

  it("closing with startedAt/endedAt instead of a direct durationMin also resolves", async () => {
    const db = createDb(env.DB);
    const created = await recordSession(
      db,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE, startedAt: STARTED_AT },
      ACTOR,
    );

    const closed = await updateSession(
      db,
      created.session.id,
      {
        type: "PRODUCTION",
        businessDate: BUSINESS_DATE,
        startedAt: STARTED_AT,
        endedAt: ENDED_AT,
        status: "CLOSED",
      },
      ACTOR,
    );
    expect(closed.session.status).toBe("CLOSED");
  });

  it("closing never touches production_runs.allocated_session_cost (KOK-028 out of scope)", async () => {
    // No production run is even seeded here — this test documents the scope boundary by asserting
    // the close path succeeds on a PRODUCTION session with no linked runs at all, i.e. it does not
    // reach for any production_runs row.
    const db = createDb(env.DB);
    const created = await recordSession(
      db,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE, durationMin: 10 },
      ACTOR,
    );
    const closed = await updateSession(
      db,
      created.session.id,
      { type: "PRODUCTION", businessDate: BUSINESS_DATE, durationMin: 10, status: "CLOSED" },
      ACTOR,
    );
    expect(closed.session.status).toBe("CLOSED");
  });

  it("rejects an unknown or already-deleted session with NOT_FOUND", async () => {
    const db = createDb(env.DB);
    const command = {
      type: "OTHER" as const,
      businessDate: BUSINESS_DATE,
      status: "OPEN" as const,
    };

    await expect(updateSession(db, "does_not_exist", command, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const created = await recordSession(db, { type: "OTHER", businessDate: BUSINESS_DATE }, ACTOR);
    await deleteSession(db, created.session.id, {}, ACTOR);
    await expect(updateSession(db, created.session.id, command, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("deleteSession / restoreSession (D-8 soft delete)", () => {
  it("blocks deletion with CONFLICT while a live event still references the session", async () => {
    const db = createDb(env.DB);
    const item = await createItem(
      db,
      {
        name: "Sessions — item vinculado",
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      },
      ACTOR,
    );
    const created = await recordSession(
      db,
      { type: "PURCHASE_TRIP", businessDate: BUSINESS_DATE },
      ACTOR,
    );
    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: `${BUSINESS_DATE}T10:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        sessionId: created.session.id,
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 1000 }],
      },
      ACTOR,
    );

    await expect(deleteSession(db, created.session.id, {}, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // Still live after the refused delete.
    const row = await db.query.sessions.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.session.id),
    });
    expect(row?.deletedAt).toBeNull();
  });

  it("reverses non-estimate cost-line transactions and soft-deletes when no live linked events exist", async () => {
    const db = createDb(env.DB);
    const created = await recordSession(
      db,
      {
        type: "OTHER",
        businessDate: BUSINESS_DATE,
        costLines: [{ label: "x", amount: 6000, isEstimate: false, accountId: "acc_bank" }],
      },
      ACTOR,
    );
    const lineId = created.session.costLines[0]?.id ?? "";
    expect(
      (
        await db.query.financialAccounts.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
        })
      )?.balance,
    ).toBe(-6000);

    const deleted = await deleteSession(db, created.session.id, {}, ACTOR);
    expect(deleted.deletedAt).not.toBeNull();

    expect(await sessionCostTx(db, lineId)).toBeUndefined();
    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
    });
    expect(accountRow?.balance).toBe(0);

    // R-3/D-8: session_costs rows themselves survive the delete unchanged.
    const row = await db.query.sessions.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, created.session.id),
    });
    expect(row?.deletedAt).not.toBeNull();
    const costRows = await db.query.sessionCosts.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.sessionId, created.session.id),
    });
    expect(costRows).toHaveLength(1);

    await expect(getSession(db, created.session.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("restore recreates the reversed transaction and re-debits the account", async () => {
    const db = createDb(env.DB);
    const created = await recordSession(
      db,
      {
        type: "OTHER",
        businessDate: BUSINESS_DATE,
        costLines: [{ label: "x", amount: 2500, isEstimate: false, accountId: "acc_cash" }],
      },
      ACTOR,
    );
    await deleteSession(db, created.session.id, {}, ACTOR);
    expect(
      (
        await db.query.financialAccounts.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
        })
      )?.balance,
    ).toBe(0);

    const restored = await restoreSession(db, created.session.id, {}, ACTOR);
    expect(restored.session.id).toBe(created.session.id);
    expect(restored.session.costLines).toHaveLength(1);

    const lineId = restored.session.costLines[0]?.id ?? "";
    expect(await sessionCostTx(db, lineId)).toMatchObject({ amount: 2500, accountId: "acc_cash" });
    const accountRow = await db.query.financialAccounts.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, "acc_cash"),
    });
    expect(accountRow?.balance).toBe(-2500);

    const fetched = await getSession(db, created.session.id);
    expect(fetched.session.id).toBe(created.session.id);
  });

  it("rejects restoring a session that is not currently deleted, and one that does not exist", async () => {
    const db = createDb(env.DB);
    const created = await recordSession(db, { type: "OTHER", businessDate: BUSINESS_DATE }, ACTOR);
    await expect(restoreSession(db, created.session.id, {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(restoreSession(db, "does_not_exist", {}, ACTOR)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("getSession: linked events viewer (Doc 07 SC-09)", () => {
  it("lists non-deleted purchases referencing the session and excludes soft-deleted ones", async () => {
    const db = createDb(env.DB);
    const item = await createItem(
      db,
      {
        name: "Sessions — get linked item",
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      },
      ACTOR,
    );
    const created = await recordSession(
      db,
      { type: "PURCHASE_TRIP", businessDate: BUSINESS_DATE },
      ACTOR,
    );

    const purchase = await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: `${BUSINESS_DATE}T10:00:00.000Z`,
        businessDate: BUSINESS_DATE,
        sessionId: created.session.id,
        supplierName: "Proveedor X",
        lines: [{ itemId: item.id, qty: 1000, lineTotal: 3000 }],
      },
      ACTOR,
    );

    const fetched = await getSession(db, created.session.id);
    expect(fetched.linkedEvents.purchases).toHaveLength(1);
    expect(fetched.linkedEvents.purchases[0]).toMatchObject({
      id: purchase.purchase.id,
      label: "Proveedor X",
    });
    expect(fetched.linkedEvents.productionRuns).toEqual([]);
    expect(fetched.linkedEvents.sales).toEqual([]);
    expect(fetched.linkedEvents.stockExits).toEqual([]);
  });

  it("returns NOT_FOUND for a missing session", async () => {
    const db = createDb(env.DB);
    await expect(getSession(db, "does_not_exist")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listSessions", () => {
  it("filters by type/status and computes costsTotal across ALL lines (estimates included)", async () => {
    const db = createDb(env.DB);
    await recordSession(
      db,
      {
        type: "PRODUCTION",
        businessDate: "2026-07-10",
        durationMin: 60,
        costLines: [
          { label: "real", amount: 1000, isEstimate: false, accountId: "acc_bank" },
          { label: "estimado", amount: 500, isEstimate: true },
        ],
      },
      ACTOR,
    );
    const otherType = await recordSession(db, { type: "OTHER", businessDate: "2026-07-11" }, ACTOR);
    await updateSession(
      db,
      otherType.session.id,
      { type: "OTHER", businessDate: "2026-07-11", durationMin: 5, status: "CLOSED" },
      ACTOR,
    );

    const { sessions: productionOnly } = await listSessions(db, { type: "PRODUCTION" });
    expect(productionOnly).toHaveLength(1);
    expect(productionOnly[0]).toMatchObject({
      type: "PRODUCTION",
      status: "CLOSED",
      durationMin: 60,
      linkedEventCount: 0,
      costsTotal: 1500, // Σ of BOTH lines, estimate included — display total, not the cash total.
    });

    const { sessions: closedOnly } = await listSessions(db, { status: "CLOSED" });
    expect(closedOnly).toHaveLength(2);
    expect(closedOnly).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "PRODUCTION", status: "CLOSED", durationMin: 60 }),
        expect.objectContaining({ type: "OTHER", status: "CLOSED", durationMin: 5 }),
      ]),
    );
  });

  it("computes duration_min from started_at/ended_at via v_session_hours when no direct value is stored", async () => {
    const db = createDb(env.DB);
    await recordSession(
      db,
      {
        type: "DELIVERY_RUN",
        businessDate: BUSINESS_DATE,
        startedAt: STARTED_AT,
        endedAt: ENDED_AT,
      },
      ACTOR,
    );

    const { sessions: rows } = await listSessions(db, { type: "DELIVERY_RUN" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.durationMin).toBe(120); // 09:00 -> 11:00
  });

  it("filters by business date range", async () => {
    const db = createDb(env.DB);
    const first = await recordSession(db, { type: "ADMIN", businessDate: "2026-07-01" }, ACTOR);
    await updateSession(
      db,
      first.session.id,
      { type: "ADMIN", businessDate: "2026-07-01", durationMin: 1, status: "CLOSED" },
      ACTOR,
    );
    await recordSession(db, { type: "ADMIN", businessDate: "2026-07-20" }, ACTOR);

    const { sessions: rows } = await listSessions(db, {
      type: "ADMIN",
      fromDate: "2026-07-15",
      toDate: "2026-07-25",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.businessDate).toBe("2026-07-20");
  });
});

// ---------------------------------------------------------------------------
// Property test (Doc 11 §2, mandatory for money math per D-5/CLAUDE.md's "money math MUST
// add/extend a property-based test").
// ---------------------------------------------------------------------------

describe("property: session cost-line create/update/delete conserves the account balance (D-5)", () => {
  it("∀ sequences of cost-line replacements on one session: acc_bank.balance always equals -Σ(currently active non-estimate line amounts), and returns to 0 after delete", async () => {
    const db = createDb(env.DB);

    const lineArb = fc.record({
      amount: fc.integer({ min: 0, max: 5000 }),
      isEstimate: fc.boolean(),
    });
    const groupArb = fc.array(lineArb, { minLength: 0, maxLength: 4 });

    async function expectedBalanceOf(lines: readonly { amount: number; isEstimate: boolean }[]) {
      const total = lines.filter((l) => !l.isEstimate).reduce((sum, l) => sum + l.amount, 0);
      // Normalize -0 to 0 (`-0` and `0` are distinct under `toBe`'s `Object.is`, but the DB's
      // stored balance is always a plain `0`).
      return total === 0 ? 0 : -total;
    }

    function toCommandLines(lines: readonly { amount: number; isEstimate: boolean }[]) {
      return lines.map((l, i) => ({
        label: `costo ${i}`,
        amount: l.amount,
        isEstimate: l.isEstimate,
        accountId: l.isEstimate ? undefined : ("acc_bank" as const),
      }));
    }

    await fc.assert(
      fc.asyncProperty(fc.array(groupArb, { minLength: 1, maxLength: 6 }), async (groups) => {
        const [firstGroup, ...restGroups] = groups;
        const initial = firstGroup ?? [];

        const created = await recordSession(
          db,
          { type: "OTHER", businessDate: BUSINESS_DATE, costLines: toCommandLines(initial) },
          ACTOR,
        );
        const sessionId = created.session.id;

        let accountRow = await db.query.financialAccounts.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
        });
        expect(accountRow?.balance).toBe(await expectedBalanceOf(initial));

        for (const group of restGroups) {
          await updateSession(
            db,
            sessionId,
            {
              type: "OTHER",
              businessDate: BUSINESS_DATE,
              status: "OPEN",
              costLines: toCommandLines(group),
            },
            ACTOR,
          );
          accountRow = await db.query.financialAccounts.findFirst({
            where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
          });
          expect(accountRow?.balance).toBe(await expectedBalanceOf(group));
        }

        // Delete reverses everything left standing — no leaked or duplicated cents.
        await deleteSession(db, sessionId, {}, ACTOR);
        accountRow = await db.query.financialAccounts.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.id, "acc_bank"),
        });
        expect(accountRow?.balance).toBe(0);
      }),
      { numRuns: 15 },
    );
  });
});

describe("batch atomicity (INV-1)", () => {
  it("a failing statement in the same shape of batch as recordSession leaves the account balance and session rows unchanged", async () => {
    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO sessions (id, type, business_date, status, created_at, updated_at)
           VALUES ('session_atomicity_test', 'OTHER', ?, 'OPEN', ?, ?)`,
        ).bind(BUSINESS_DATE, "2026-07-16T10:00:00.000Z", "2026-07-16T10:00:00.000Z"),
        env.DB.prepare(
          "UPDATE financial_accounts SET balance = balance + -1000 WHERE id = 'acc_bank'",
        ),
        // Violates session_costs_amount_check (amount must be >= 0).
        env.DB.prepare(
          `INSERT INTO session_costs (id, session_id, label, amount, is_estimate, account_id)
           VALUES ('cost_atomicity_test', 'session_atomicity_test', 'x', -1, 0, 'acc_bank')`,
        ),
      ]),
    ).rejects.toThrow();

    const sessionRow = await env.DB.prepare(
      "SELECT id FROM sessions WHERE id = 'session_atomicity_test'",
    ).first();
    expect(sessionRow).toBeNull();

    const accountRow = await env.DB.prepare(
      "SELECT balance FROM financial_accounts WHERE id = 'acc_bank'",
    ).first<{ balance: number }>();
    expect(accountRow?.balance).toBe(0);
  });
});

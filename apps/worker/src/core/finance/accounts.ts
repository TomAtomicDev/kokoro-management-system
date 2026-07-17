// financial_accounts reads + the shared relative-balance-update builder (INV-5). Most of this
// module is a BUILDING BLOCK like core/inventory (KOK-012): `buildAccountBalanceDelta` only
// builds a Drizzle statement, it never executes on its own — transactions.ts and transfer.ts (the
// actual top-level commands, UC-11/12/13) include it in their own db.batch() alongside the
// financial_transactions insert(s) and the audit_log insert (D-3: one atomic batch per command).
//
// `setOpeningBalances` (KOK-020, Doc 07 steps 1-5) is the one exception: it IS a top-level command
// living in this file rather than its own module, because it only ever touches financial_accounts
// (an ABSOLUTE set, not the relative delta above) and belongs next to the account rows it mutates.

import type {
  AuditActor,
  FinancialAccountDto,
  ListAccountsResult,
  SetOpeningBalancesCommand,
  SetOpeningBalancesResult,
} from "@kokoro/shared";
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialAccounts } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { conflict, notFound, validationError } from "../errors.js";
import { getSetting } from "../settings/index.js";
import { toAccountDto } from "./dto.js";

/** The only two accounts that exist (Doc 04 §7 seed) — same literal-id precedent
 * test/counts.test.ts/test/purchasing.test.ts already use. */
const BANK_ACCOUNT_ID = "acc_bank";
const CASH_ACCOUNT_ID = "acc_cash";

type Statement = BatchItem<"sqlite">;
type FinancialAccountRow = typeof financialAccounts.$inferSelect;

/**
 * Builds (does not execute) a relative `balance` update: `balance = balance + delta`. `delta` may
 * be negative (expenses, transfer-out legs) — this is a single SQL expression evaluated against
 * the row's CURRENT balance at update time, not a JS read-then-write, so it stays correct even if
 * another statement in the same batch also touches this account (it doesn't, in this module's
 * commands, but the pattern is what INV-5 requires regardless).
 */
export function buildAccountBalanceDelta(db: Db, accountId: string, delta: number): Statement {
  assertSafeIntegerInput(delta, "delta");
  return db
    .update(financialAccounts)
    .set({ balance: sql`${financialAccounts.balance} + ${delta}` })
    .where(eq(financialAccounts.id, accountId));
}

// Mirrors packages/shared/src/numeric.ts's assertSafeInteger pattern (not part of the package's
// public barrel — see apps/worker/src/core/inventory/movements.ts's identical helper for the
// precedent this follows). core/finance is its own trusted boundary for the integers it persists.
function assertSafeIntegerInput(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw validationError(`${label} debe ser un entero seguro.`, { [label]: value });
  }
}

/** Fetches the account row, throwing NOT_FOUND / VALIDATION if it doesn't exist or is inactive.
 * Used before batching (a plain SELECT ahead of the atomic write, same precedent as core/catalog). */
export async function findActiveAccountRowOrThrow(
  db: Db,
  accountId: string,
): Promise<FinancialAccountRow> {
  const row = await db.query.financialAccounts.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, accountId),
  });
  if (!row) {
    throw notFound("No se encontró la cuenta.", { accountId });
  }
  if (row.isActive !== 1) {
    throw validationError("La cuenta no está activa.", { accountId });
  }
  return row;
}

export async function getAccount(db: Db, id: string): Promise<FinancialAccountDto> {
  const row = await db.query.financialAccounts.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!row) {
    throw notFound("No se encontró la cuenta.", { id });
  }
  return toAccountDto(row);
}

export async function listAccounts(db: Db): Promise<ListAccountsResult> {
  const rows = await db.query.financialAccounts.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.isActive, 1),
    orderBy: (t, { asc }) => asc(t.name),
  });
  return { accounts: rows.map(toAccountDto) };
}

/**
 * Onboarding wizard step (KOK-020, Doc 07 steps 1-5): sets BOTH `openingBalance` AND `balance` to
 * the given values for the two seeded accounts. Unlike `buildAccountBalanceDelta` (a RELATIVE
 * `balance = balance + delta`, used by every other finance command for INV-5), this is an
 * ABSOLUTE `.set({ openingBalance, balance })` — the two operations are semantically different and
 * are not interchangeable: this one only ever runs once, before any transaction has been recorded,
 * to declare the starting point INV-5's deltas accumulate from afterward.
 *
 * Guarded by `onboarding_completed_at` (core/settings): once onboarding has been marked complete,
 * opening balances are frozen — re-running this would silently rewrite financial history that
 * later transactions have already accumulated on top of.
 *
 * One audit_log row for the combined action (mirrors core/finance/transfer.ts's documented
 * judgment call: "a single owner action producing two linked writes -> one audit entry"),
 * entityType `financial_accounts`, entityId `acc_bank` by convention, `after` carrying both new
 * balances.
 */
export async function setOpeningBalances(
  db: Db,
  command: SetOpeningBalancesCommand,
  actor: AuditActor,
): Promise<SetOpeningBalancesResult> {
  const completedAt = await getSetting(db, "onboarding_completed_at");
  if (completedAt) {
    throw conflict(
      "Ya se completó la configuración inicial; los saldos de apertura no se pueden modificar después.",
      {},
    );
  }

  const [bankAccount, cashAccount] = await Promise.all([
    findActiveAccountRowOrThrow(db, BANK_ACCOUNT_ID),
    findActiveAccountRowOrThrow(db, CASH_ACCOUNT_ID),
  ]);

  await db.batch([
    db
      .update(financialAccounts)
      .set({ openingBalance: command.bankOpening, balance: command.bankOpening })
      .where(eq(financialAccounts.id, BANK_ACCOUNT_ID)),
    db
      .update(financialAccounts)
      .set({ openingBalance: command.cashOpening, balance: command.cashOpening })
      .where(eq(financialAccounts.id, CASH_ACCOUNT_ID)),
    buildAuditLogInsert(db, {
      actor,
      action: "set_opening_balances",
      entityType: "financial_accounts",
      entityId: BANK_ACCOUNT_ID,
      before: {
        bankOpening: bankAccount.openingBalance,
        bankBalance: bankAccount.balance,
        cashOpening: cashAccount.openingBalance,
        cashBalance: cashAccount.balance,
      },
      after: {
        bankOpening: command.bankOpening,
        bankBalance: command.bankOpening,
        cashOpening: command.cashOpening,
        cashBalance: command.cashOpening,
      },
    }),
  ]);

  return {
    bankAccount: toAccountDto({
      ...bankAccount,
      openingBalance: command.bankOpening,
      balance: command.bankOpening,
    }),
    cashAccount: toAccountDto({
      ...cashAccount,
      openingBalance: command.cashOpening,
      balance: command.cashOpening,
    }),
  };
}

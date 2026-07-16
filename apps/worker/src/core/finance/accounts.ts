// financial_accounts reads + the shared relative-balance-update builder (INV-5). This module is
// a BUILDING BLOCK like core/inventory (KOK-012): `buildAccountBalanceDelta` only builds a
// Drizzle statement, it never executes on its own — transactions.ts and transfer.ts (the actual
// top-level commands, UC-11/12/13) include it in their own db.batch() alongside the
// financial_transactions insert(s) and the audit_log insert (D-3: one atomic batch per command).

import type { FinancialAccountDto, ListAccountsResult } from "@kokoro/shared";
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialAccounts } from "../../db/schema.js";
import { notFound, validationError } from "../errors.js";
import { toAccountDto } from "./dto.js";

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

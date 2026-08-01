// financial_accounts reads + the shared relative-balance-update builder (INV-5). Most of this
// module is a BUILDING BLOCK like core/inventory (KOK-012): `buildAccountBalanceDelta` only
// builds a Drizzle statement, it never executes on its own — transactions.ts and transfer.ts (the
// actual top-level commands, UC-11/12/13) include it in their own db.batch() alongside the
// financial_transactions insert(s) and the audit_log insert (D-3: one atomic batch per command).
//
// `buildReplaceTransactionsForSourceStatements` (KOK-024) is the cash-side twin of
// core/inventory/movements.ts's `buildReplaceMovementsForSourceStatements`: the same "build, don't
// execute" regeneration primitive, for `financial_transactions` + `financial_accounts.balance`
// instead of `stock_movements` + `item_stock.qty_on_hand`.
//
// `setOpeningBalances` (KOK-020, Doc 07 steps 1-5) is the one exception: it IS a top-level command
// living in this file rather than its own module, because it only ever touches financial_accounts
// (an ABSOLUTE set, not the relative delta above) and belongs next to the account rows it mutates.

import type {
  AuditActor,
  FinancialAccountDto,
  FinancialTransactionCategory,
  FinancialTransactionType,
  ListAccountsResult,
  SetOpeningBalancesCommand,
  SetOpeningBalancesResult,
} from "@kokoro/shared";
import { generateUuidV7, nowIso } from "@kokoro/shared";
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialAccounts, financialTransactions } from "../../db/schema.js";
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

/**
 * Input contract for a system-owned `financial_transactions` row, i.e. one DERIVED from a business
 * event rather than recorded standalone (Doc 04 §5: rows with `source_event_id` set are
 * system-owned and "not editable directly"). Deliberately a plain data shape, not a Zod schema —
 * the same reasoning as core/inventory/types.ts's `StockMovementInput`: each event service owns its
 * own Command DTO schema in packages/shared (D-4) and maps its fields into this shape.
 *
 * `counterpartTxId` is intentionally absent: pairing is exclusive to transfers (core/finance/
 * transfer.ts), which are standalone commands, never event-derived.
 */
export interface FinancialTransactionInput {
  /** UTC ISO-8601 instant (Doc 04 §1). */
  occurredAt: string;
  /** Local business date `YYYY-MM-DD`, America/La_Paz (INV-3). */
  businessDate: string;
  accountId: string;
  type: FinancialTransactionType;
  category: FinancialTransactionCategory;
  /**
   * Centavos, ALWAYS POSITIVE (INV-6, and Doc 04 §3.4's `amount > 0` CHECK). The balance direction
   * comes purely from `type` — callers must not pre-negate; a negative or zero amount is rejected.
   */
  amount: number;
  description?: string | null;
  /** e.g. 'purchase' | 'sale' | 'custom_order' — free text, no FK by design (INV-9). */
  sourceEventType: string;
  sourceEventId: string;
}

/**
 * Canonical balance direction per transaction type (Doc 04 §3.4, and the identical CASE expression
 * in `getBalanceConsistencyMismatches`'s SQL): INCOME/TRANSFER_IN credit the account, EXPENSE/
 * TRANSFER_OUT debit it. `amount` is always positive, so the sign lives here and nowhere else —
 * the same "direction is a property of the type, not of the caller" rule core/inventory's
 * MOVEMENT_DIRECTION enforces for the kardex.
 */
const TRANSACTION_BALANCE_DIRECTION: Record<FinancialTransactionType, 1 | -1> = {
  INCOME: 1,
  TRANSFER_IN: 1,
  EXPENSE: -1,
  TRANSFER_OUT: -1,
};

/** Signed centavos this transaction contributes to `financial_accounts.balance` (INV-5). */
function signedBalanceEffect(type: FinancialTransactionType, amount: number): number {
  return TRANSACTION_BALANCE_DIRECTION[type] * amount;
}

function assertValidTransactionAmount(amount: number): void {
  assertSafeIntegerInput(amount, "amount");
  if (amount <= 0) {
    throw validationError(
      "El monto de una transacción debe ser positivo; el signo lo determina el tipo.",
      { amount },
    );
  }
}

/**
 * Builds (does not execute) the `financial_transactions` INSERT for one system-owned row.
 * `deletedAt` is always null: a freshly regenerated derived row is by definition live — the
 * SOFT delete of D-8/INV-10 applies to the source EVENT, not to the rows derived from it.
 */
function buildTransactionInsert(
  input: FinancialTransactionInput,
  createdAt: string,
  db: Db,
): Statement {
  assertValidTransactionAmount(input.amount);

  return db.insert(financialTransactions).values({
    id: generateUuidV7(),
    occurredAt: input.occurredAt,
    businessDate: input.businessDate,
    accountId: input.accountId,
    type: input.type,
    category: input.category,
    amount: input.amount,
    counterpartTxId: null,
    sourceEventType: input.sourceEventType,
    sourceEventId: input.sourceEventId,
    description: input.description ?? null,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
  });
}

/**
 * The idempotent regeneration primitive for the cash side of an event edit/delete (KOK-024) — the
 * exact analogue of core/inventory/movements.ts's `buildReplaceMovementsForSourceStatements`, and
 * the ONLY legitimate writer of system-owned `financial_transactions` rows (those WITH a
 * `source_event_id`). `assertTransactionEditable` in transactions.ts is the other half of that same
 * rule: it turns AWAY direct edits of exactly the rows this function owns.
 *
 * Reads the existing rows for `(sourceEventType, sourceEventId)` via a plain SELECT (atomicity only
 * applies to the WRITE statements returned here, per the same "build, don't execute" contract as
 * the rest of this module), then builds:
 *   - one DELETE removing all of those rows (hard-deleting system-owned derived rows here is the
 *     case D-8 explicitly carves out: "hard DELETE is reserved for derived rows regeneration
 *     inside services". The event is what gets soft-deleted; its derived cash rows are regenerated,
 *     never left behind as tombstones — INV-9's `source_event_type`/`source_event_id` pair stays a
 *     clean 1:N projection of the event's CURRENT state).
 *   - one INSERT per row of `newRows`.
 *   - exactly ONE `buildAccountBalanceDelta` per account touched by EITHER the old or the new set,
 *     netting the old rows' reversal (subtracted) and the new rows' effect (added) into a single
 *     delta per account — never two competing updates for the same account.
 *
 * The netting is keyed on accountId precisely so an event whose `accountId` CHANGES (e.g. a
 * purchase re-attributed from cash to bank) produces TWO deltas: `+amount` back to the old account
 * (reversal only) and `-amount` out of the new one (new effect only). An empty `newRows` — the
 * delete case — nets to exactly the reversal of the old set, fully undoing the event's cash effect.
 *
 * Only rows that currently COUNT toward `balance` are reversed: soft-deleted rows
 * (`deleted_at IS NOT NULL`) were already subtracted from the balance when they were soft-deleted,
 * so reversing them again would double-count. They are still hard-deleted by the DELETE above.
 * This mirrors `listTransactions`'s and `getBalanceConsistencyMismatches`'s `deleted_at` filters.
 *
 * Idempotent: calling this twice with the same `newRows` leaves `financial_accounts.balance` and
 * the *set* of transaction rows for this source in the same final state both times (row ids and
 * timestamps are regenerated). The second call finds the first call's rows as "existing", reverses
 * them, and re-adds the same values, netting to a zero delta per account.
 *
 * Never executes: include the returned statements in the caller's own `db.batch()` alongside the
 * event's own update/soft-delete, its stock-movement statements, and its audit_log row (D-3).
 */
export async function buildReplaceTransactionsForSourceStatements(
  db: Db,
  sourceEventType: string,
  sourceEventId: string,
  newRows: FinancialTransactionInput[],
): Promise<{ statements: Statement[] }> {
  for (const row of newRows) {
    if (row.sourceEventType !== sourceEventType || row.sourceEventId !== sourceEventId) {
      // Defensive, mirroring buildReplaceMovementsForSourceStatements: every row passed to a
      // *regeneration* for a given source must agree with that source, otherwise the netting below
      // (keyed only on accountId) would silently mix deltas belonging to a different event.
      throw validationError(
        "Todas las transacciones nuevas deben pertenecer al mismo evento origen que se está regenerando.",
        { sourceEventType, sourceEventId, row },
      );
    }
  }

  const existingRows = await db.query.financialTransactions.findMany({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.sourceEventType, sourceEventType), eqOp(t.sourceEventId, sourceEventId)),
  });

  const now = nowIso();
  const statements: Statement[] = [
    // Unconditional: a no-op DELETE (zero rows matched) is harmless and keeps this function's shape
    // identical whether or not a prior generation exists — important for idempotency on the very
    // first call, where existingRows is legitimately empty.
    db
      .delete(financialTransactions)
      .where(
        and(
          eq(financialTransactions.sourceEventType, sourceEventType),
          eq(financialTransactions.sourceEventId, sourceEventId),
        ),
      ),
    ...newRows.map((row) => buildTransactionInsert(row, now, db)),
  ];

  const net = new Map<string, number>();
  for (const row of existingRows) {
    if (row.deletedAt !== null) continue;
    net.set(
      row.accountId,
      (net.get(row.accountId) ?? 0) - signedBalanceEffect(row.type, row.amount),
    );
  }
  for (const row of newRows) {
    net.set(
      row.accountId,
      (net.get(row.accountId) ?? 0) + signedBalanceEffect(row.type, row.amount),
    );
  }
  for (const [accountId, delta] of net) {
    statements.push(buildAccountBalanceDelta(db, accountId, delta));
  }

  return { statements };
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

/** Raw aggregate row for `getBalanceConsistencyMismatches` — a hand-written GROUP BY/JOIN over
 * `financial_accounts`/`financial_transactions` (Doc 04 §3.4), not a view. */
interface BalanceMismatchRow {
  account_id: string;
  account_name: string;
  expected_balance: number;
  actual_balance: number;
}

/** One active account where the stored `balance` disagrees with what the transaction ledger
 * implies (INV-5's nightly consistency sentinel, KOK-021). */
export interface BalanceMismatchDto {
  accountId: string;
  accountName: string;
  /** Centavos (INV-6): `openingBalance + Σ(amount signed by type)`, excluding soft-deleted
   * transactions — what `balance` SHOULD equal per INV-5. */
  expectedBalance: number;
  /** Centavos: the value actually stored in `financial_accounts.balance`. */
  actualBalance: number;
}

/**
 * INV-5's nightly consistency sentinel (KOK-021) for cash: for every ACTIVE account, compares
 * `openingBalance + Σ(amount signed by type)` — INCOME/TRANSFER_IN add, EXPENSE/TRANSFER_OUT
 * subtract, `amount` is always positive (Doc 04 §3.4's CHECK constraint) so the sign comes purely
 * from `type` — against the stored `balance` (INV-5's derived column, kept live by
 * `buildAccountBalanceDelta` on every command). Soft-deleted transactions
 * (`deleted_at IS NOT NULL`) are excluded, mirroring `listTransactions`'s filter precedent
 * (`transactions.ts`).
 *
 * A mismatch means an earlier batch broke atomicity somewhere upstream (a `financial_transactions`
 * row written without its paired balance delta, or vice versa). Like
 * `core/inventory`'s `getStockConsistencyMismatches`, this is a pure read with no repair procedure
 * defined — it only detects and reports.
 */
export async function getBalanceConsistencyMismatches(db: Db): Promise<BalanceMismatchDto[]> {
  const rows = await db.all<BalanceMismatchRow>(sql`
    SELECT * FROM (
      SELECT
        a.id AS account_id,
        a.name AS account_name,
        a.balance AS actual_balance,
        a.opening_balance + COALESCE(SUM(CASE
          WHEN t.type IN ('INCOME', 'TRANSFER_IN') THEN t.amount
          WHEN t.type IN ('EXPENSE', 'TRANSFER_OUT') THEN -t.amount
          ELSE 0
        END), 0) AS expected_balance
      FROM financial_accounts a
      LEFT JOIN financial_transactions t
        ON t.account_id = a.id AND t.deleted_at IS NULL
      WHERE a.is_active = 1
      GROUP BY a.id, a.name, a.opening_balance, a.balance
    )
    WHERE expected_balance != actual_balance
    ORDER BY account_name ASC
  `);

  return rows.map((row) => ({
    accountId: row.account_id,
    accountName: row.account_name,
    expectedBalance: row.expected_balance,
    actualBalance: row.actual_balance,
  }));
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

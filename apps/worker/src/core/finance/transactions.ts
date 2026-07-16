// core/finance — standalone financial transactions (KOK-014, Doc 03 UC-11/UC-13, Doc 04 §3.4).
//
// ARCHITECTURAL NOTE: unlike core/inventory (KOK-012) or core/costing (KOK-013), which are pure
// building blocks that never call db.batch(), core/finance's exported functions ARE the
// top-level command entry points — same pattern as core/catalog (KOK-011). Each one builds its
// own statements array and calls db.batch() itself: the financial_transactions insert + the
// account balance update (accounts.ts's buildAccountBalanceDelta) + the audit_log insert, all in
// ONE atomic batch (D-3).

import type {
  AuditActor,
  FinancialTransactionCategory,
  ListTransactionsFilters,
  ListTransactionsResult,
  RecordTransactionCommand,
  RecordTransactionResult,
  WithdrawCommand,
  WithdrawResult,
} from "@kokoro/shared";
import {
  RECORD_TRANSACTION_CATEGORIES_BY_TYPE,
  addMoney,
  generateUuidV7,
  nowIso,
  subMoney,
} from "@kokoro/shared";

import type { Db } from "../../db/index.js";
import { financialTransactions } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { conflict, validationError } from "../errors.js";
import { buildAccountBalanceDelta, findActiveAccountRowOrThrow } from "./accounts.js";
import { toAccountDto, toTransactionDto } from "./dto.js";

/**
 * Enforces the `recordTransaction` category/type pairing (Doc 10 KOK-014). This is the
 * AUTHORITATIVE check: packages/shared/finance.ts's `recordTransactionCommandSchema` already runs
 * the same rule via `.superRefine` for instant Zod-level (API/form) feedback, but core/ services
 * don't trust that every caller went through Zod first (e.g. this module's own integration tests
 * call `recordTransaction` directly with a hand-built object), so the service re-checks using the
 * exact same shared constant — one rule, enforced twice, never redefined.
 */
function assertLegalCategoryForType(
  type: "INCOME" | "EXPENSE",
  category: FinancialTransactionCategory,
): void {
  const allowed = RECORD_TRANSACTION_CATEGORIES_BY_TYPE[type];
  if (!allowed.includes(category)) {
    throw validationError(
      `Para type=${type} la categoría debe ser una de: ${allowed.join(", ")}.`,
      { type, category },
    );
  }
}

/** UC-11: a standalone expense or "other income" transaction (never system-owned — sourceEventId
 * is always null here; purchases/sales/orders write their own system-owned rows in their own
 * later services). */
export async function recordTransaction(
  db: Db,
  command: RecordTransactionCommand,
  actor: AuditActor,
): Promise<RecordTransactionResult> {
  assertLegalCategoryForType(command.type, command.category);
  const account = await findActiveAccountRowOrThrow(db, command.accountId);

  const now = nowIso();
  const row = {
    id: generateUuidV7(),
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    accountId: command.accountId,
    type: command.type,
    category: command.category,
    amount: command.amount,
    counterpartTxId: null,
    sourceEventType: null,
    sourceEventId: null,
    description: command.description ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const delta = command.type === "INCOME" ? command.amount : -command.amount;

  await db.batch([
    db.insert(financialTransactions).values(row),
    buildAccountBalanceDelta(db, command.accountId, delta),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "financial_transactions",
      entityId: row.id,
      before: null,
      after: row,
    }),
  ]);

  const newBalance =
    command.type === "INCOME"
      ? addMoney(account.balance, command.amount)
      : subMoney(account.balance, command.amount);

  return {
    transaction: toTransactionDto(row),
    account: toAccountDto({ ...account, balance: newBalance }),
  };
}

/** UC-13: owner withdrawal — always EXPENSE / OWNER_WITHDRAWAL, fixed, not caller-supplied. */
export async function withdraw(
  db: Db,
  command: WithdrawCommand,
  actor: AuditActor,
): Promise<WithdrawResult> {
  const account = await findActiveAccountRowOrThrow(db, command.accountId);

  const now = nowIso();
  const row = {
    id: generateUuidV7(),
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    accountId: command.accountId,
    type: "EXPENSE" as const,
    category: "OWNER_WITHDRAWAL" as const,
    amount: command.amount,
    counterpartTxId: null,
    sourceEventType: null,
    sourceEventId: null,
    description: command.description ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.batch([
    db.insert(financialTransactions).values(row),
    buildAccountBalanceDelta(db, command.accountId, -command.amount),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "financial_transactions",
      entityId: row.id,
      before: null,
      after: row,
    }),
  ]);

  return {
    transaction: toTransactionDto(row),
    account: toAccountDto({ ...account, balance: subMoney(account.balance, command.amount) }),
  };
}

/** Read query for the (later, KOK-015) Finance screen's transactions table. Soft-deleted rows are
 * excluded defensively — this task builds no delete path, so `deletedAt` is always null today;
 * the filter is future-proofing for KOK-024. */
export async function listTransactions(
  db: Db,
  filters: ListTransactionsFilters = {},
): Promise<ListTransactionsResult> {
  const rows = await db.query.financialTransactions.findMany({
    where: (t, { and, eq: eqOp, gte, lte, isNull }) => {
      const conditions = [isNull(t.deletedAt)];
      if (filters.accountId) conditions.push(eqOp(t.accountId, filters.accountId));
      if (filters.category) conditions.push(eqOp(t.category, filters.category));
      if (filters.fromDate) conditions.push(gte(t.businessDate, filters.fromDate));
      if (filters.toDate) conditions.push(lte(t.businessDate, filters.toDate));
      return and(...conditions);
    },
    orderBy: (t, { desc }) => [desc(t.businessDate), desc(t.createdAt)],
    limit: filters.limit ?? 200,
  });
  return { transactions: rows.map(toTransactionDto) };
}

/**
 * Guard for KOK-024 (event edit/delete framework) and KOK-015 (Finance screen) to call once an
 * edit path exists for financial_transactions. Doc 04 §5: rows with `source_event_id` set are
 * system-owned — "not editable directly (edit the source event instead)". Unused within this
 * task (CREATE + READ only per Doc 10 KOK-014's scope note); exported now so the rule has one
 * authoritative home instead of being re-derived ad hoc by whichever task builds editing.
 */
export function assertTransactionEditable(tx: { sourceEventId: string | null }): void {
  if (tx.sourceEventId !== null) {
    throw conflict(
      "Esta transacción proviene de otro evento; edita el evento de origen en lugar de la transacción.",
      { sourceEventId: tx.sourceEventId },
    );
  }
}

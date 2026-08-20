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
  DeleteTransactionCommand,
  DeleteTransactionResult,
  FinancialTransactionCategory,
  ListTransactionsFilters,
  ListTransactionsResult,
  RecordTransactionCommand,
  RecordTransactionResult,
  RestoreTransactionResult,
  TransferCommand,
  UpdateTransactionCommand,
  UpdateTransactionResult,
  WithdrawCommand,
  WithdrawResult,
} from "@kokoro/shared";
import {
  addMoney,
  generateUuidV7,
  nowIso,
  RECORD_TRANSACTION_CATEGORIES_BY_TYPE,
  subMoney,
  toCentavos,
} from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialTransactions } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { conflict, notFound, validationError } from "../errors.js";
import { buildAccountBalanceDelta, findActiveAccountRowOrThrow } from "./accounts.js";
import { toAccountDto, toTransactionDto } from "./dto.js";

type Statement = BatchItem<"sqlite">;
type FinancialTransactionRow = typeof financialTransactions.$inferSelect;

const TRANSACTION_BALANCE_DIRECTION: Record<FinancialTransactionRow["type"], 1 | -1> = {
  INCOME: 1,
  TRANSFER_IN: 1,
  EXPENSE: -1,
  TRANSFER_OUT: -1,
};

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

function assertValidTransactionAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw validationError("El monto de una transacción debe ser un entero positivo en centavos.", {
      amount,
    });
  }
}

/** Signed centavos contribution to an account balance (INV-5). Exported for the property test
 * that guards edit/delete/restore netting without introducing a second arithmetic oracle. */
export function signedTransactionBalanceEffect(
  type: FinancialTransactionRow["type"],
  amount: number,
): number {
  assertValidTransactionAmount(amount);
  return TRANSACTION_BALANCE_DIRECTION[type] * amount;
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
  assertValidTransactionAmount(command.amount);
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
    // KOK-185: assigned by an AFTER INSERT trigger (migration 0024) — never by core/. `category`
    // is one of the manual, non-TRANSFER categories here (assertLegalCategoryForType only allows
    // INCOME/EXPENSE), so the trigger always fires for this row.
    code: null,
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
      ? addMoney(toCentavos(account.balance), toCentavos(command.amount))
      : subMoney(toCentavos(account.balance), toCentavos(command.amount));

  // The one answer that cannot disagree with what the trigger actually wrote (mirrors
  // core/sales/index.ts's readAccountDtoOrThrow).
  const codeRow = await db.query.financialTransactions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, row.id),
    columns: { code: true },
  });

  return {
    transaction: toTransactionDto({ ...row, code: codeRow?.code ?? null }),
    account: toAccountDto({ ...account, balance: newBalance }),
  };
}

/** UC-13: owner withdrawal — always EXPENSE / OWNER_WITHDRAWAL, fixed, not caller-supplied. */
export async function withdraw(
  db: Db,
  command: WithdrawCommand,
  actor: AuditActor,
): Promise<WithdrawResult> {
  assertValidTransactionAmount(command.amount);
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
    // KOK-185: assigned by an AFTER INSERT trigger (migration 0024) — see recordTransaction above.
    code: null,
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

  const codeRow = await db.query.financialTransactions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, row.id),
    columns: { code: true },
  });

  return {
    transaction: toTransactionDto({ ...row, code: codeRow?.code ?? null }),
    account: toAccountDto({
      ...account,
      balance: subMoney(toCentavos(account.balance), toCentavos(command.amount)),
    }),
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

type TransactionMutationRows = {
  rows: FinancialTransactionRow[];
  out?: FinancialTransactionRow;
  in?: FinancialTransactionRow;
};

/** Loads a live manual row or a live manual transfer pair. The pair invariants are checked before
 * any write so an inconsistent ledger can never be partially edited or voided. */
async function loadLiveManualRows(db: Db, id: string): Promise<TransactionMutationRows> {
  const row = await loadTransactionRow(db, id);
  assertTransactionEditable(row);
  if (row.deletedAt !== null) {
    throw notFound("No se encontró el movimiento activo.", { id });
  }
  return loadPairOrSingle(db, row, false);
}

/** Same loader for restore, where every row in a transfer pair must be soft-deleted. */
async function loadDeletedManualRows(db: Db, id: string): Promise<TransactionMutationRows> {
  const row = await loadTransactionRow(db, id);
  assertTransactionEditable(row);
  if (row.deletedAt === null) {
    throw notFound("No se encontró el movimiento eliminado.", { id });
  }
  return loadPairOrSingle(db, row, true);
}

async function loadTransactionRow(db: Db, id: string): Promise<FinancialTransactionRow> {
  const row = await db.query.financialTransactions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!row) throw notFound("No se encontró el movimiento financiero.", { id });
  return row;
}

async function loadPairOrSingle(
  db: Db,
  row: FinancialTransactionRow,
  deleted: boolean,
): Promise<TransactionMutationRows> {
  if (row.counterpartTxId === null) {
    if (row.type === "TRANSFER_IN" || row.type === "TRANSFER_OUT") {
      throw conflict("La transferencia no tiene una pareja válida; no se puede modificar.", {
        transactionId: row.id,
      });
    }
    return { rows: [row] };
  }

  const counterpart = await loadTransactionRow(db, row.counterpartTxId);
  if (
    counterpart.counterpartTxId !== row.id ||
    row.category !== "TRANSFER" ||
    counterpart.category !== "TRANSFER" ||
    !(
      (row.type === "TRANSFER_OUT" && counterpart.type === "TRANSFER_IN") ||
      (row.type === "TRANSFER_IN" && counterpart.type === "TRANSFER_OUT")
    ) ||
    row.sourceEventId !== null ||
    counterpart.sourceEventId !== null ||
    (row.deletedAt === null) !== (counterpart.deletedAt === null)
  ) {
    throw conflict("La transferencia no tiene una pareja válida; no se puede modificar.", {
      transactionId: row.id,
      counterpartTxId: row.counterpartTxId,
    });
  }
  if ((row.deletedAt !== null) !== deleted || (counterpart.deletedAt !== null) !== deleted) {
    throw notFound(
      deleted ? "No se encontró el movimiento eliminado." : "No se encontró el movimiento activo.",
      { id: row.id },
    );
  }

  const out = row.type === "TRANSFER_OUT" ? row : counterpart;
  const incoming = row.type === "TRANSFER_IN" ? row : counterpart;
  return { rows: [out, incoming], out, in: incoming };
}

function isTransferCommand(command: UpdateTransactionCommand): command is TransferCommand {
  return "fromAccountId" in command;
}

function addBalanceDelta(
  deltas: Map<string, number>,
  row: FinancialTransactionRow,
  factor: 1 | -1,
): void {
  const effect = signedTransactionBalanceEffect(row.type, row.amount) * factor;
  deltas.set(row.accountId, (deltas.get(row.accountId) ?? 0) + effect);
}

/** Builds one relative balance statement per touched account. The statement is included in the
 * same batch as the row mutation and audit entry, so INV-5 cannot observe a half-applied edit. */
function buildBalanceStatements(
  db: Db,
  previousRows: FinancialTransactionRow[],
  nextRows: FinancialTransactionRow[],
): Statement[] {
  const deltas = new Map<string, number>();
  for (const row of previousRows) {
    if (row.deletedAt === null) addBalanceDelta(deltas, row, -1);
  }
  for (const row of nextRows) {
    if (row.deletedAt === null) addBalanceDelta(deltas, row, 1);
  }
  return [...deltas.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([accountId, delta]) => buildAccountBalanceDelta(db, accountId, delta));
}

async function readAccountsForRows(db: Db, rows: FinancialTransactionRow[]) {
  const accountIds = [...new Set(rows.map((row) => row.accountId))];
  const accounts = await Promise.all(
    accountIds.map(async (accountId) => {
      const account = await db.query.financialAccounts.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.id, accountId),
      });
      if (!account) throw notFound("No se encontró la cuenta.", { accountId });
      return toAccountDto(account);
    }),
  );
  return accounts;
}

function auditState(rows: FinancialTransactionRow[]): unknown {
  return rows.length === 1 ? rows[0] : { out: rows[0], in: rows[1] };
}

async function commitTransactionMutation(
  db: Db,
  previousRows: FinancialTransactionRow[],
  nextRows: FinancialTransactionRow[],
  action: "update" | "delete" | "restore",
  actor: AuditActor,
): Promise<void> {
  const entityId =
    previousRows.find((row) => row.type === "TRANSFER_OUT")?.id ?? previousRows[0]?.id;
  if (!entityId) throw notFound("No se encontró el movimiento financiero.");
  const statements: Statement[] = [];
  for (const row of nextRows) {
    statements.push(
      db
        .update(financialTransactions)
        .set({
          accountId: row.accountId,
          type: row.type,
          category: row.category,
          amount: row.amount,
          occurredAt: row.occurredAt,
          businessDate: row.businessDate,
          description: row.description,
          deletedAt: row.deletedAt,
          updatedAt: row.updatedAt,
        })
        .where(eq(financialTransactions.id, row.id)),
    );
  }
  statements.push(...buildBalanceStatements(db, previousRows, nextRows));
  statements.push(
    buildAuditLogInsert(db, {
      actor,
      action,
      entityType: "financial_transactions",
      entityId,
      before: auditState(previousRows),
      after: auditState(nextRows),
    }),
  );
  await db.batch(statements as [Statement, ...Statement[]]);
}

function buildStandaloneUpdateRow(
  current: FinancialTransactionRow,
  command: RecordTransactionCommand | WithdrawCommand,
  now: string,
): FinancialTransactionRow {
  if (!("type" in command)) {
    if (current.type !== "EXPENSE" || current.category !== "OWNER_WITHDRAWAL") {
      throw validationError(
        "Este movimiento no es un retiro personal; usa los campos de gasto o ingreso.",
        { id: current.id },
      );
    }
    assertValidTransactionAmount(command.amount);
    return {
      ...current,
      accountId: command.accountId,
      amount: command.amount,
      occurredAt: command.occurredAt,
      businessDate: command.businessDate,
      description: command.description ?? null,
      updatedAt: now,
    };
  }
  assertLegalCategoryForType(command.type, command.category);
  assertValidTransactionAmount(command.amount);
  return {
    ...current,
    accountId: command.accountId,
    type: command.type,
    category: command.category,
    amount: command.amount,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    description: command.description ?? null,
    updatedAt: now,
  };
}

function buildTransferUpdateRows(
  out: FinancialTransactionRow,
  incoming: FinancialTransactionRow,
  command: TransferCommand,
  now: string,
): [FinancialTransactionRow, FinancialTransactionRow] {
  if (command.fromAccountId === command.toAccountId) {
    throw validationError("La cuenta de origen y destino no pueden ser la misma.", {
      accountId: command.fromAccountId,
    });
  }
  assertValidTransactionAmount(command.amount);
  return [
    {
      ...out,
      accountId: command.fromAccountId,
      amount: command.amount,
      occurredAt: command.occurredAt,
      businessDate: command.businessDate,
      description: command.description ?? null,
      updatedAt: now,
    },
    {
      ...incoming,
      accountId: command.toAccountId,
      amount: command.amount,
      occurredAt: command.occurredAt,
      businessDate: command.businessDate,
      description: command.description ?? null,
      updatedAt: now,
    },
  ];
}

/** Updates one standalone manual row or both legs of a manual transfer atomically. */
export async function updateTransaction(
  db: Db,
  id: string,
  command: UpdateTransactionCommand,
  actor: AuditActor,
): Promise<UpdateTransactionResult> {
  const previous = await loadLiveManualRows(db, id);
  const now = nowIso();
  let nextRows: FinancialTransactionRow[];

  if (isTransferCommand(command)) {
    if (!previous.out || !previous.in) {
      throw validationError("Una transferencia solo puede editarse como pareja.", { id });
    }
    if (command.fromAccountId === command.toAccountId) {
      throw validationError("La cuenta de origen y destino no pueden ser la misma.", {
        accountId: command.fromAccountId,
      });
    }
    await Promise.all([
      findActiveAccountRowOrThrow(db, command.fromAccountId),
      findActiveAccountRowOrThrow(db, command.toAccountId),
    ]);
    nextRows = buildTransferUpdateRows(previous.out, previous.in, command, now);
  } else {
    if (previous.rows.length !== 1 || !previous.rows[0]) {
      throw validationError(
        "Una transferencia solo puede editarse con sus cuentas de origen y destino.",
        {
          id,
        },
      );
    }
    await findActiveAccountRowOrThrow(db, command.accountId);
    nextRows = [buildStandaloneUpdateRow(previous.rows[0], command, now)];
  }

  await commitTransactionMutation(db, previous.rows, nextRows, "update", actor);
  return {
    transactions: nextRows.map(toTransactionDto),
    accounts: await readAccountsForRows(db, nextRows),
  };
}

/** Soft-deletes one manual row or both legs of a transfer pair atomically. */
export async function deleteTransaction(
  db: Db,
  id: string,
  _command: DeleteTransactionCommand,
  actor: AuditActor,
): Promise<DeleteTransactionResult> {
  const previous = await loadLiveManualRows(db, id);
  const now = nowIso();
  const nextRows = previous.rows.map((row) => ({ ...row, deletedAt: now, updatedAt: now }));
  await commitTransactionMutation(db, previous.rows, nextRows, "delete", actor);
  return {
    transactions: nextRows.map(toTransactionDto),
    accounts: await readAccountsForRows(db, nextRows),
    deletedAt: now,
  };
}

/** Restores a previously soft-deleted manual row or transfer pair atomically. */
export async function restoreTransaction(
  db: Db,
  id: string,
  _command: DeleteTransactionCommand,
  actor: AuditActor,
): Promise<RestoreTransactionResult> {
  const previous = await loadDeletedManualRows(db, id);
  const now = nowIso();
  const nextRows = previous.rows.map((row) => ({ ...row, deletedAt: null, updatedAt: now }));
  await commitTransactionMutation(db, previous.rows, nextRows, "restore", actor);
  return {
    transactions: nextRows.map(toTransactionDto),
    accounts: await readAccountsForRows(db, nextRows),
  };
}

/**
 * Guard for KOK-024 (event edit/delete framework) and KOK-015 (Finance screen) to call once an
 * edit path exists for financial_transactions. Doc 04 §5: rows with `source_event_id` set are
 * system-owned — "not editable directly (edit the source event instead)". The KOK-146 mutation
 * loaders call this before handling either a standalone row or a transfer pair, so the rule has
 * one authoritative home instead of being re-derived ad hoc by each mutation path.
 */
export function assertTransactionEditable(tx: { sourceEventId: string | null }): void {
  if (tx.sourceEventId !== null) {
    throw conflict(
      "Esta transacción proviene de otro evento; edita el evento de origen en lugar de la transacción.",
      { sourceEventId: tx.sourceEventId },
    );
  }
}

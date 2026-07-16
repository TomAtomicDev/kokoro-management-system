// core/finance — bank <-> cash transfers (KOK-014, Doc 03 UC-12, Doc 04 §3.4). A transfer is a
// PAIRED write: a TRANSFER_OUT row on the source account and a TRANSFER_IN row on the destination
// account, cross-referencing each other via `counterpartTxId`, both `category: 'TRANSFER'`. Both
// ids are generated upfront (generateUuidV7).
//
// Both rows are INSERTed with `counterpartTxId: null` first, then linked by two UPDATEs — all
// still in the SAME atomic db.batch() (D-3). Originally this inserted each row with its
// counterpart's id already in the INSERT values (no follow-up UPDATE), since both rows land in
// the same transaction/batch either way. That failed against real D1: SQLite's `counterpart_tx_id`
// self-FK is NOT declared deferrable (schema.ts, not ours to change per this task's scope), so it
// is checked immediately per-statement, not at batch/transaction commit — inserting the OUT row
// referencing the not-yet-existing IN row's id trips `FOREIGN KEY constraint failed` right there,
// before the IN row's own INSERT ever runs. Insert-null-then-UPDATE sidesteps that: by the time
// each UPDATE runs, both rows already exist earlier in the same batch. Caught by finance.test.ts
// against the real D1 engine, not assumed from reading the schema.

import type { AuditActor, TransferCommand, TransferResult } from "@kokoro/shared";
import { addMoney, generateUuidV7, nowIso, subMoney } from "@kokoro/shared";
import { eq } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { financialTransactions } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { validationError } from "../errors.js";
import { buildAccountBalanceDelta, findActiveAccountRowOrThrow } from "./accounts.js";
import { toAccountDto, toTransactionDto } from "./dto.js";

/** UC-12: transfer between two active financial_accounts. Money-conservation is structural here,
 * not merely tested: the same `command.amount` is subtracted from one account and added to the
 * other inside a single atomic batch (D-3), so `bank.balance + cash.balance` is invariant across
 * the call (verified in finance.test.ts, but guaranteed by this shape regardless). */
export async function transfer(
  db: Db,
  command: TransferCommand,
  actor: AuditActor,
): Promise<TransferResult> {
  // packages/shared/finance.ts's transferCommandSchema already refines fromAccountId !==
  // toAccountId, but this service doesn't trust every caller went through Zod (same rationale as
  // recordTransaction's category check) — defensive re-check.
  if (command.fromAccountId === command.toAccountId) {
    throw validationError("La cuenta de origen y destino no pueden ser la misma.", {
      accountId: command.fromAccountId,
    });
  }

  const [fromAccount, toAccount] = await Promise.all([
    findActiveAccountRowOrThrow(db, command.fromAccountId),
    findActiveAccountRowOrThrow(db, command.toAccountId),
  ]);

  const now = nowIso();
  const outId = generateUuidV7();
  const inId = generateUuidV7();

  const outRow = {
    id: outId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    accountId: command.fromAccountId,
    type: "TRANSFER_OUT" as const,
    category: "TRANSFER" as const,
    amount: command.amount,
    counterpartTxId: inId,
    sourceEventType: null,
    sourceEventId: null,
    description: command.description ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const inRow = {
    id: inId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    accountId: command.toAccountId,
    type: "TRANSFER_IN" as const,
    category: "TRANSFER" as const,
    amount: command.amount,
    counterpartTxId: outId,
    sourceEventType: null,
    sourceEventId: null,
    description: command.description ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  // Judgment call: ONE audit_log row for the whole transfer (entityId = the OUT leg's id,
  // after_json carrying both rows — the FINAL state, counterpartTxId included, not the
  // null-then-updated intermediate insert values) rather than one row per leg. A transfer is a
  // single owner action producing two linked rows, not two independent events — one audit entry
  // mirrors that and keeps the audit trail as easy to read as the transfer itself (look up either
  // tx id's counterpart to find the paired leg; the audit row is keyed off the OUT leg by
  // convention).
  await db.batch([
    db.insert(financialTransactions).values({ ...outRow, counterpartTxId: null }),
    db.insert(financialTransactions).values({ ...inRow, counterpartTxId: null }),
    db
      .update(financialTransactions)
      .set({ counterpartTxId: inId })
      .where(eq(financialTransactions.id, outId)),
    db
      .update(financialTransactions)
      .set({ counterpartTxId: outId })
      .where(eq(financialTransactions.id, inId)),
    buildAccountBalanceDelta(db, command.fromAccountId, -command.amount),
    buildAccountBalanceDelta(db, command.toAccountId, command.amount),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "financial_transactions",
      entityId: outId,
      before: null,
      after: { out: outRow, in: inRow },
    }),
  ]);

  return {
    outTransaction: toTransactionDto(outRow),
    inTransaction: toTransactionDto(inRow),
    fromAccount: toAccountDto({
      ...fromAccount,
      balance: subMoney(fromAccount.balance, command.amount),
    }),
    toAccount: toAccountDto({
      ...toAccount,
      balance: addMoney(toAccount.balance, command.amount),
    }),
  };
}

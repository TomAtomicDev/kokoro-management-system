// Row -> DTO mapping shared by accounts.ts, transactions.ts and transfer.ts. Kept separate so
// none of those files needs to duplicate the shape of FinancialAccountDto/FinancialTransactionDto.

import type { FinancialAccountDto, FinancialTransactionDto } from "@kokoro/shared";

import type { financialAccounts, financialTransactions } from "../../db/schema.js";

type FinancialAccountRow = typeof financialAccounts.$inferSelect;
type FinancialTransactionRow = typeof financialTransactions.$inferSelect;

export function toAccountDto(row: FinancialAccountRow): FinancialAccountDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    openingBalance: row.openingBalance,
    balance: row.balance,
    isActive: row.isActive === 1,
  };
}

export function toTransactionDto(row: FinancialTransactionRow): FinancialTransactionDto {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    businessDate: row.businessDate,
    accountId: row.accountId,
    type: row.type,
    category: row.category,
    amount: row.amount,
    counterpartTxId: row.counterpartTxId,
    sourceEventType: row.sourceEventType,
    sourceEventId: row.sourceEventId,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

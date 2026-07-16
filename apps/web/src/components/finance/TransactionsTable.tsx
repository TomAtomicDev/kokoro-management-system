// SC-10 transactions table: all financial_transactions, signed-colored amount (Doc 06 §3 rule —
// see features/finance/transaction-styling.ts), system-owned rows flagged read-only.
//
// No row click / DetailDrawer: editing a financial_transaction has no API yet (KOK-014
// deliberately didn't build it — that's KOK-024's job), so this table is read-only end to end,
// not just for system-owned rows.

import { formatMoney } from "@kokoro/shared";
import type { FinancialAccountDto, FinancialTransactionDto } from "@kokoro/shared";
import { useMemo } from "react";

import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import {
  signedTransactionAmount,
  transactionAmountColorClass,
} from "@/features/finance/transaction-styling";
import { financeLabels } from "@/lib/i18n-finance";
import { cn } from "@/lib/utils";

export interface TransactionsTableProps {
  transactions: FinancialTransactionDto[];
  accounts: FinancialAccountDto[];
  loading?: boolean;
}

export function TransactionsTable({ transactions, accounts, loading }: TransactionsTableProps) {
  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts) map.set(account.id, account.name);
    return map;
  }, [accounts]);

  const columns: EventTableColumn<FinancialTransactionDto>[] = [
    {
      id: "date",
      header: financeLabels.columnDate,
      cell: (row) => row.businessDate,
    },
    {
      id: "account",
      header: financeLabels.columnAccount,
      cell: (row) => accountNameById.get(row.accountId) ?? row.accountId,
    },
    {
      id: "type",
      header: financeLabels.columnType,
      cell: (row) => financeLabels.typeLabels[row.type],
    },
    {
      id: "category",
      header: financeLabels.columnCategory,
      cell: (row) => financeLabels.categoryLabels[row.category],
    },
    {
      id: "amount",
      header: financeLabels.columnAmount,
      numeric: true,
      cell: (row) => (
        <span className={cn("font-medium", transactionAmountColorClass(row.type))}>
          {formatMoney(signedTransactionAmount(row.type, row.amount), { signed: true })}
        </span>
      ),
    },
    {
      id: "description",
      header: financeLabels.columnDescription,
      cell: (row) => row.description ?? "—",
    },
    {
      id: "source",
      header: financeLabels.columnSource,
      cell: (row) =>
        row.sourceEventId ? (
          <span title={financeLabels.systemOwnedHint}>
            <Badge variant="muted">{financeLabels.systemOwnedBadge}</Badge>
          </span>
        ) : (
          <span className="text-subtle-foreground">—</span>
        ),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={transactions}
      getRowId={(row) => row.id}
      emptyMessage={financeLabels.noTransactions}
      loading={loading}
      loadingMessage={financeLabels.loading}
    />
  );
}

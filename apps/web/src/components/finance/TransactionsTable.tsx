// SC-10 transactions table: all financial_transactions, signed-colored amount (Doc 06 §3 rule —
// see features/finance/transaction-styling.ts), system-owned rows flagged read-only.
//
// Rows open the Finance detail drawer. Manual rows expose edit/delete there; system-owned rows
// stay read-only and explain that their source event owns them.

import type {
  FinancialAccountDto,
  FinancialTransactionDto,
  FinancialTransactionSourceEventDto,
} from "@kokoro/shared";
import { formatMoney, toCentavos } from "@kokoro/shared";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";

import {
  EventTable,
  type EventTableColumn,
  type EventTableSortState,
} from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import {
  signedTransactionAmount,
  transactionAmountColorClass,
} from "@/features/finance/transaction-styling";
import { financeLabels } from "@/lib/i18n-finance";
import { cn } from "@/lib/utils";

export function formatSourceEventLabel(sourceEvent: FinancialTransactionSourceEventDto): string {
  const [year, month, day] = sourceEvent.businessDate.split("-");
  const shortDate = year && month && day ? `${day}/${month}` : sourceEvent.businessDate;
  return [financeLabels.sourceEventTypeLabels[sourceEvent.type], sourceEvent.code]
    .filter((part): part is string => part !== null)
    .join(" ")
    .concat(` · ${shortDate}`);
}

function SourceEventLink({
  sourceEvent,
}: {
  sourceEvent: FinancialTransactionSourceEventDto;
}): React.ReactElement {
  const label = formatSourceEventLabel(sourceEvent);
  const linkClassName = "text-primary underline-offset-2 hover:underline";
  const stopRowSelection = (event: { stopPropagation: () => void }): void => {
    event.stopPropagation();
  };

  switch (sourceEvent.type) {
    case "purchase":
      return (
        <Link
          to="/purchases"
          search={(previous) => ({ ...previous, open: sourceEvent.id })}
          className={linkClassName}
          onClick={stopRowSelection}
          onKeyDown={stopRowSelection}
        >
          {label}
        </Link>
      );
    case "sale":
      return (
        <Link
          to="/sales"
          search={(previous) => ({ ...previous, open: sourceEvent.id })}
          className={linkClassName}
          onClick={stopRowSelection}
          onKeyDown={stopRowSelection}
        >
          {label}
        </Link>
      );
    case "custom_order":
      return (
        <Link
          to="/orders"
          search={(previous) => ({ ...previous, open: sourceEvent.id })}
          className={linkClassName}
          onClick={stopRowSelection}
          onKeyDown={stopRowSelection}
        >
          {label}
        </Link>
      );
    case "session":
      return (
        <Link
          to="/sessions"
          search={(previous) => ({ ...previous, open: sourceEvent.id })}
          className={linkClassName}
          onClick={stopRowSelection}
          onKeyDown={stopRowSelection}
        >
          {label}
        </Link>
      );
  }
}

export interface TransactionsTableProps {
  transactions: FinancialTransactionDto[];
  accounts: FinancialAccountDto[];
  loading?: boolean;
  onRowClick?: (transaction: FinancialTransactionDto) => void;
  sortState: EventTableSortState | null;
  onSortChange: (sortState: EventTableSortState | null) => void;
}

export function TransactionsTable({
  transactions,
  accounts,
  loading,
  onRowClick,
  sortState,
  onSortChange,
}: TransactionsTableProps) {
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
      sortable: true,
      sortValue: (row) => row.businessDate,
    },
    {
      id: "code",
      header: financeLabels.columnCode,
      isRowIdentifier: true,
      // KOK-185: only manual rows (gasto/ingreso/retiro/transferencia) get their own code — a
      // system-owned row already shows the "source" badge below and inherits its source event's
      // code there (Doc 07), so this column intentionally mirrors that column's em-dash for it.
      cell: (row) => row.code ?? "—",
      sortable: true,
      sortValue: (row) => row.code ?? "—",
    },
    {
      id: "account",
      header: financeLabels.columnAccount,
      cell: (row) => accountNameById.get(row.accountId) ?? row.accountId,
      sortable: true,
      sortValue: (row) => accountNameById.get(row.accountId) ?? row.accountId,
    },
    {
      id: "type",
      header: financeLabels.columnType,
      cell: (row) => financeLabels.typeLabels[row.type],
      sortable: true,
      sortValue: (row) => financeLabels.typeLabels[row.type],
    },
    {
      id: "category",
      header: financeLabels.columnCategory,
      cell: (row) => financeLabels.categoryLabels[row.category],
      sortable: true,
      sortValue: (row) => financeLabels.categoryLabels[row.category],
    },
    {
      id: "amount",
      header: financeLabels.columnAmount,
      numeric: true,
      cell: (row) => (
        <span className={cn("font-medium", transactionAmountColorClass(row.type))}>
          {formatMoney(toCentavos(signedTransactionAmount(row.type, row.amount)), { signed: true })}
        </span>
      ),
      sortable: true,
      sortValue: (row) => signedTransactionAmount(row.type, row.amount),
    },
    {
      id: "description",
      header: financeLabels.columnDescription,
      cell: (row) => row.description ?? "—",
      sortable: true,
      sortValue: (row) => row.description ?? "—",
    },
    {
      id: "source",
      header: financeLabels.columnSource,
      cell: (row) =>
        row.sourceEvent ? (
          <SourceEventLink sourceEvent={row.sourceEvent} />
        ) : row.sourceEventId ? (
          <span title={financeLabels.systemOwnedHint}>
            <Badge variant="muted">{financeLabels.systemOwnedBadge}</Badge>
          </span>
        ) : (
          <span className="text-subtle-foreground">—</span>
        ),
      sortable: true,
      sortValue: (row) => (row.sourceEvent ? formatSourceEventLabel(row.sourceEvent) : "—"),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={transactions}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={financeLabels.noTransactions}
      loading={loading}
      loadingMessage={financeLabels.loading}
      sortState={sortState}
      onSortChange={onSortChange}
    />
  );
}

// SC-10 · Finance — /finance (UC-11, UC-12, UC-13). Header: account cards + Transferir/Retiro
// personal actions; liability strip (placeholder until Phase 3); table of all financial
// transactions.

import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";

import type { EventTableSortState } from "@/components/data-table/EventTable";
import { AccountCard } from "@/components/finance/AccountCard";
import { OrderCashReceivableStrip } from "@/components/finance/OrderCashReceivableStrip";
import { RecordTransactionDialog } from "@/components/finance/RecordTransactionDialog";
import { TransactionDetailDrawer } from "@/components/finance/TransactionDetailDrawer";
import { TransactionsTable } from "@/components/finance/TransactionsTable";
import { TransferDialog } from "@/components/finance/TransferDialog";
import { WithdrawDialog } from "@/components/finance/WithdrawDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAccounts, useTransactions } from "@/features/finance/api";
import { useOrder } from "@/features/orders/api";
import { financeLabels } from "@/lib/i18n-finance";

const routeApi = getRouteApi("/_authenticated/finance");

export function FinanceRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const accountsQuery = useAccounts();
  const relatedOrderQuery = useOrder(search.customOrderId);
  const transactionsQuery = useTransactions({
    ...(search.customOrderId ? { customOrderId: search.customOrderId } : {}),
  });

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);

  const accounts = accountsQuery.data?.accounts ?? [];
  const transactions = transactionsQuery.data?.transactions ?? [];
  const selectedTransaction =
    transactions.find((transaction) => transaction.id === selectedTransactionId) ?? null;
  const selectedCounterpart = selectedTransaction?.counterpartTxId
    ? (transactions.find((transaction) => transaction.id === selectedTransaction.counterpartTxId) ??
      null)
    : null;
  const sortState: EventTableSortState | null =
    search.sort && search.sortDirection
      ? { columnId: search.sort, direction: search.sortDirection }
      : null;

  function updateSort(next: EventTableSortState | null): void {
    void navigate({
      search: (previous) => ({
        ...previous,
        sort: next?.columnId,
        sortDirection: next?.direction,
      }),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{financeLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{financeLabels.subtitle}</p>
        </div>
        {/* Header-level actions (Doc 07 SC-10): a transfer/withdrawal always needs an account
            select inside the dialog anyway, so these live here rather than on a specific card. */}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setExpenseOpen(true)}>
            {financeLabels.actionRecordExpense}
          </Button>
          <Button type="button" variant="outline" onClick={() => setIncomeOpen(true)}>
            {financeLabels.actionRecordIncome}
          </Button>
          <Button type="button" variant="outline" onClick={() => setTransferOpen(true)}>
            {financeLabels.actionTransfer}
          </Button>
          <Button type="button" onClick={() => setWithdrawOpen(true)}>
            {financeLabels.actionWithdraw}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        {accountsQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">{financeLabels.loading}</p>
        ) : (
          accounts.map((account) => <AccountCard key={account.id} account={account} />)
        )}
      </div>

      <OrderCashReceivableStrip />

      {search.customOrderId ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <span className="text-foreground">
            {financeLabels.filteredOrder}:{" "}
            {relatedOrderQuery.data?.code ??
              transactions[0]?.relatedOrder?.code ??
              financeLabels.relatedOrderWithoutCode}
          </span>
          <Link
            to="/finance"
            search={(previous) => ({
              sort: previous.sort,
              sortDirection: previous.sortDirection,
            })}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {financeLabels.clearOrderFilter}
          </Link>
        </div>
      ) : null}

      <TransactionsTable
        transactions={transactions}
        accounts={accounts}
        loading={transactionsQuery.isLoading}
        onRowClick={(transaction) => setSelectedTransactionId(transaction.id)}
        sortState={sortState}
        onSortChange={updateSort}
      />

      <TransactionDetailDrawer
        transaction={selectedTransaction}
        counterpart={selectedCounterpart}
        accounts={accounts}
        open={selectedTransactionId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedTransactionId(null);
        }}
      />

      <RecordTransactionDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        type="EXPENSE"
        accounts={accounts}
      />
      <RecordTransactionDialog
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        type="INCOME"
        accounts={accounts}
      />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} accounts={accounts} />
      <WithdrawDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} accounts={accounts} />
    </div>
  );
}

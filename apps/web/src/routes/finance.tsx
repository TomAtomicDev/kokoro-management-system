// SC-10 · Finance — /finance (UC-11, UC-12, UC-13). Header: account cards + Transferir/Retiro
// personal actions; liability strip (placeholder until Phase 3); table of all financial
// transactions.

import { useState } from "react";

import { AccountCard } from "@/components/finance/AccountCard";
import { LiabilityReceivableStrip } from "@/components/finance/LiabilityReceivableStrip";
import { RecordTransactionDialog } from "@/components/finance/RecordTransactionDialog";
import { TransactionsTable } from "@/components/finance/TransactionsTable";
import { TransferDialog } from "@/components/finance/TransferDialog";
import { WithdrawDialog } from "@/components/finance/WithdrawDialog";
import { Button } from "@/components/ui/button";
import { useAccounts, useTransactions } from "@/features/finance/api";
import { financeLabels } from "@/lib/i18n-finance";

export function FinanceRoute() {
  const accountsQuery = useAccounts();
  const transactionsQuery = useTransactions();

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const accounts = accountsQuery.data?.accounts ?? [];

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

      <LiabilityReceivableStrip />

      <TransactionsTable
        transactions={transactionsQuery.data?.transactions ?? []}
        accounts={accounts}
        loading={transactionsQuery.isLoading}
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

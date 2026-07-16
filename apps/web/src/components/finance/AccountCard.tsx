// One card per active financial_account (Banco, Caja chica) — SC-10 header.
//
// The account balance is the ONE place on this screen where --negative may legitimately appear
// (Doc 06 §3): a negative balance is an actual problem (the business owes more than it holds in
// that account), unlike an ordinary expense/transfer row in the transactions table below, which
// never gets that treatment (see features/finance/transaction-styling.ts for that rule).

import { formatMoney } from "@kokoro/shared";
import type { FinancialAccountDto } from "@kokoro/shared";

import { financeLabels } from "@/lib/i18n-finance";
import { cn } from "@/lib/utils";

export function AccountCard({ account }: { account: FinancialAccountDto }) {
  const negative = account.balance < 0;
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground text-sm">{account.name}</span>
        <span className="text-muted-foreground text-xs">
          {financeLabels.accountTypeLabels[account.type]}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground text-xs">{financeLabels.balance}</span>
        <span
          className={cn(
            "numeric-cell font-medium text-lg",
            negative ? "text-negative" : "text-foreground",
          )}
        >
          {formatMoney(account.balance)}
        </span>
      </div>
    </div>
  );
}

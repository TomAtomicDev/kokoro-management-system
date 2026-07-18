// Pure helpers for the SC-10 "signed coloring" rule (Doc 06 §3, Doc 10 KOK-015).
//
// The naive finance-UI default (debit=red, credit=green) is explicitly WRONG here: Doc 06 §3
// reserves --negative (red) for real problems — below-replacement-cost price, negative balance —
// never for an ordinary expense or a transfer between the owner's own accounts. So:
//   - INCOME gets --positive (green): money genuinely arriving is a mild good-news signal.
//   - EXPENSE and both TRANSFER legs stay on the neutral ink color: paying a normal bill or
//     moving money between accounts is routine, not alarming.
//   - --negative is NOT used anywhere in this module — the only place it may appear on this
//     screen is an account card whose live balance is negative (a real problem), handled
//     separately at the call site, not here.
// The +/- sign is still informational (shown as text via formatMoney's `signed` option); only the
// COLOR is constrained by this rule.

import type { FinancialTransactionType } from "@kokoro/shared";

/** True direction of a transaction row: INCOME/TRANSFER_IN add to the account, the rest subtract. */
export function isInflow(type: FinancialTransactionType): boolean {
  return type === "INCOME" || type === "TRANSFER_IN";
}

/** Signs `amount` (always stored positive, Doc 04 §3.4) by the row's direction, for display. */
export function signedTransactionAmount(type: FinancialTransactionType, amount: number): number {
  return isInflow(type) ? amount : -amount;
}

/** Tailwind class for the amount cell — see module doc for why this is never text-negative. */
export function transactionAmountColorClass(type: FinancialTransactionType): string {
  return type === "INCOME" ? "text-positive" : "text-foreground";
}

import { describe, expect, it } from "vitest";

import { toBusinessDate } from "./dates";
import {
  listTransactionsFiltersSchema,
  recordTransactionCommandSchema,
  transferCommandSchema,
  withdrawCommandSchema,
} from "./finance";

const shiftedDate = (days: number): string => {
  const shifted = new Date();
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return toBusinessDate(shifted);
};

// KOK-168 (F-17): finance.ts must use dates.ts's real businessDateSchema/occurredAtSchema on each
// command's own date fields, not locally-redeclared copies without the future-date refinement.
describe("finance command businessDate (KOK-168 / F-17)", () => {
  const nowIso = new Date().toISOString();

  it("rejects a future businessDate on recordTransaction", () => {
    const result = recordTransactionCommandSchema.safeParse({
      accountId: "account-1",
      type: "EXPENSE",
      category: "OPERATING_EXPENSE",
      amount: 1000,
      businessDate: shiftedDate(1),
      occurredAt: nowIso,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a future businessDate on transfer", () => {
    const result = transferCommandSchema.safeParse({
      fromAccountId: "account-1",
      toAccountId: "account-2",
      amount: 1000,
      businessDate: shiftedDate(1),
      occurredAt: nowIso,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a future businessDate on withdraw", () => {
    const result = withdrawCommandSchema.safeParse({
      accountId: "account-1",
      amount: 1000,
      businessDate: shiftedDate(1),
      occurredAt: nowIso,
    });
    expect(result.success).toBe(false);
  });
});

describe("listTransactionsFiltersSchema date range (KOK-168 / F-17)", () => {
  it("accepts a future fromDate/toDate — a filter boundary is not a transaction date", () => {
    const future = shiftedDate(14);
    expect(
      listTransactionsFiltersSchema.safeParse({ fromDate: future, toDate: future }).success,
    ).toBe(true);
  });
});

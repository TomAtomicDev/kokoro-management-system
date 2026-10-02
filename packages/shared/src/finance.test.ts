import { describe, expect, it } from "vitest";

import { toBusinessDate } from "./dates";
import {
  listTransactionsFiltersSchema,
  recordOrderTransactionCommandSchema,
  recordTransactionCommandSchema,
  transferCommandSchema,
  updateTransactionCommandSchema,
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

  it("accepts an order association filter for Finance deep links", () => {
    expect(listTransactionsFiltersSchema.parse({ customOrderId: "order-1" }).customOrderId).toBe(
      "order-1",
    );
  });
});

describe("independent order finance command contracts (KOK-204 / O-8)", () => {
  const base = {
    accountId: "acc_bank",
    amount: 1250,
    businessDate: toBusinessDate(new Date()),
    occurredAt: new Date().toISOString(),
  };

  it.each([
    ["ORDER_DEPOSIT", "INCOME"],
    ["ORDER_BALANCE", "INCOME"],
    ["ORDER_REFUND", "EXPENSE"],
  ] as const)("requires an order association for %s", (category, type) => {
    expect(recordTransactionCommandSchema.safeParse({ ...base, category, type }).success).toBe(
      false,
    );
    expect(
      recordTransactionCommandSchema.safeParse({
        ...base,
        category,
        type,
        customOrderId: "order-1",
      }).success,
    ).toBe(true);
  });

  it("keeps the order-scoped body free of an association field for the route to supply", () => {
    const parsed = recordOrderTransactionCommandSchema.parse({
      ...base,
      type: "INCOME",
      category: "ORDER_BALANCE",
      customOrderId: "forged-order-id",
    });

    expect(parsed).not.toHaveProperty("customOrderId");
  });

  it("still enforces income/expense category pairing for order categories", () => {
    expect(
      recordTransactionCommandSchema.safeParse({
        ...base,
        type: "INCOME",
        category: "ORDER_REFUND",
        customOrderId: "order-1",
      }).success,
    ).toBe(false);
  });

  it("keeps Finance transaction edits from accepting an association change", () => {
    const parsed = updateTransactionCommandSchema.parse({
      ...base,
      type: "INCOME",
      category: "ORDER_BALANCE",
      customOrderId: "forged-order-id",
    });

    expect(parsed).not.toHaveProperty("customOrderId");
  });
});

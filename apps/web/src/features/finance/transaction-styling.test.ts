import { describe, expect, it } from "vitest";

import {
  isInflow,
  signedTransactionAmount,
  transactionAmountColorClass,
} from "./transaction-styling";

describe("isInflow", () => {
  it("treats INCOME and TRANSFER_IN as inflows", () => {
    expect(isInflow("INCOME")).toBe(true);
    expect(isInflow("TRANSFER_IN")).toBe(true);
  });

  it("treats EXPENSE and TRANSFER_OUT as outflows", () => {
    expect(isInflow("EXPENSE")).toBe(false);
    expect(isInflow("TRANSFER_OUT")).toBe(false);
  });
});

describe("signedTransactionAmount", () => {
  it("keeps inflows positive", () => {
    expect(signedTransactionAmount("INCOME", 14000)).toBe(14000);
    expect(signedTransactionAmount("TRANSFER_IN", 5000)).toBe(5000);
  });

  it("negates outflows", () => {
    expect(signedTransactionAmount("EXPENSE", 5000)).toBe(-5000);
    expect(signedTransactionAmount("TRANSFER_OUT", 5000)).toBe(-5000);
  });
});

describe("transactionAmountColorClass", () => {
  it("uses --positive only for INCOME", () => {
    expect(transactionAmountColorClass("INCOME")).toBe("text-positive");
  });

  // Doc 06 §3: --negative is reserved for real problems, never ordinary outflows — EXPENSE and
  // both TRANSFER legs must stay neutral ink, not red, even though money is leaving the account.
  it("never uses --negative for EXPENSE or either TRANSFER leg", () => {
    for (const type of ["EXPENSE", "TRANSFER_IN", "TRANSFER_OUT"] as const) {
      const cls = transactionAmountColorClass(type);
      expect(cls).not.toContain("negative");
      expect(cls).not.toContain("destructive");
    }
    expect(transactionAmountColorClass("EXPENSE")).toBe("text-foreground");
    expect(transactionAmountColorClass("TRANSFER_IN")).toBe("text-foreground");
    expect(transactionAmountColorClass("TRANSFER_OUT")).toBe("text-foreground");
  });
});

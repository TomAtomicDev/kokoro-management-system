import type { SaleDto } from "@kokoro/shared";
import {
  addMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { summarizeOrderCash, summarizeOrderSaleMargin } from "./order-detail-summary";

describe("order detail money summaries (Doc 03 O-8)", () => {
  it("conserves integer cents for arbitrary linked incomes, expenses and unrelated transfer rows", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            type: fc.constantFrom("INCOME" as const, "EXPENSE" as const, "TRANSFER_IN" as const),
            amount: fc.integer({ min: 1, max: 1_000_000 }),
          }),
          { maxLength: 100 },
        ),
        (transactions) => {
          const summary = summarizeOrderCash(transactions);
          const expectedIncome = transactions
            .filter((transaction) => transaction.type === "INCOME")
            .reduce((sum, transaction) => sum + transaction.amount, 0);
          const expectedExpense = transactions
            .filter((transaction) => transaction.type === "EXPENSE")
            .reduce((sum, transaction) => sum + transaction.amount, 0);
          expect(summary.incomeTotal).toBe(expectedIncome);
          expect(summary.expenseTotal).toBe(expectedExpense);
          expect(summary.cashResult).toBe(expectedIncome - expectedExpense);
        },
      ),
    );
  });

  it("keeps customer charges out of product margin and uses the sale's frozen line COGS", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            unitCostSnapshotMc: fc.integer({ min: 0, max: 10_000_000 }),
            qty: fc.integer({ min: 1, max: 10_000 }),
          }),
          { maxLength: 20 },
        ),
        fc.integer({ min: 0, max: 100_000 }),
        (lines, additionalCharge) => {
          const frozenCogs = lines.reduce(
            (sum, line) =>
              addMoney(
                sum,
                totalCentavos(
                  toMilliCentavosPerUnit(line.unitCostSnapshotMc),
                  toMilliUnits(line.qty),
                ),
              ),
            toCentavos(0),
          );
          const merchandiseRevenue = toCentavos(1_000_000_000);
          const sale = {
            total: merchandiseRevenue + additionalCharge,
            additionalCharge,
            lines,
          } as SaleDto;

          const summary = summarizeOrderSaleMargin(sale);
          expect(summary.merchandiseRevenue).toBe(merchandiseRevenue);
          expect(summary.frozenCogs).toBe(frozenCogs);
          expect(summary.productGrossMargin).toBe(merchandiseRevenue - frozenCogs);
        },
      ),
    );
  });
});

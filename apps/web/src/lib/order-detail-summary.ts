import type { Centavos, FinancialTransactionDto, SaleDto } from "@kokoro/shared";
import {
  addMoney,
  subMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";

export interface OrderCashSummary {
  incomeTotal: Centavos;
  expenseTotal: Centavos;
  cashResult: Centavos;
}

/** Net active order-linked cash events; transfers cannot be associated to an order (Doc 03 O-8). */
export function summarizeOrderCash(
  transactions: readonly Pick<FinancialTransactionDto, "type" | "amount">[],
): OrderCashSummary {
  const incomes = transactions
    .filter((transaction) => transaction.type === "INCOME")
    .map((transaction) => toCentavos(transaction.amount));
  const expenses = transactions
    .filter((transaction) => transaction.type === "EXPENSE")
    .map((transaction) => toCentavos(transaction.amount));
  const incomeTotal = addMoney(...incomes);
  const expenseTotal = addMoney(...expenses);
  return {
    incomeTotal,
    expenseTotal,
    cashResult: subMoney(incomeTotal, expenseTotal),
  };
}

export interface OrderSaleMargin {
  merchandiseRevenue: Centavos;
  frozenCogs: Centavos;
  productGrossMargin: Centavos;
}

/**
 * Uses only the active delivered sale's frozen line costs. Customer charges and cash movements are
 * deliberately excluded: this is product gross margin, not the order's cash result (Doc 03 O-8).
 */
export function summarizeOrderSaleMargin(
  sale: Pick<SaleDto, "total" | "additionalCharge" | "lines">,
): OrderSaleMargin {
  const merchandiseRevenue = subMoney(toCentavos(sale.total), toCentavos(sale.additionalCharge));
  const frozenCogs = sale.lines.reduce(
    (sum, line) =>
      addMoney(
        sum,
        totalCentavos(toMilliCentavosPerUnit(line.unitCostSnapshotMc), toMilliUnits(line.qty)),
      ),
    toCentavos(0),
  );
  return {
    merchandiseRevenue,
    frozenCogs,
    productGrossMargin: subMoney(merchandiseRevenue, frozenCogs),
  };
}

import type { ReceivablesSaleDto } from "@kokoro/shared";
import { addMoney, calculateOrderReceiptBalance, subMoney, toCentavos } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { calculateReceivableAmounts, groupReceivableSales } from "./receivables.js";

describe("grouped receivables math", () => {
  it("property: catalog and order debt conserve the global centavo total across customer groups", () => {
    const saleSpecArbitrary = fc.integer({ min: 0, max: 1_000_000 }).chain((saleTotal) =>
      fc.record({
        saleTotal: fc.constant(saleTotal),
        qualifyingReceipts: fc.integer({ min: 0, max: saleTotal }),
        channel: fc.constantFrom("CATALOG" as const, "CUSTOM_ORDER" as const),
        customerIndex: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
        ageDays: fc.integer({ min: 0, max: 10_000 }),
      }),
    );

    fc.assert(
      fc.property(fc.array(saleSpecArbitrary, { maxLength: 100 }), (specs) => {
        const groupRows = specs.map((spec, index) => {
          const orderBalance =
            spec.channel === "CUSTOM_ORDER"
              ? calculateOrderReceiptBalance(spec.saleTotal, 0, spec.qualifyingReceipts)
              : null;
          const amounts =
            orderBalance === null
              ? calculateReceivableAmounts(spec.saleTotal, spec.saleTotal)
              : {
                  saleTotal: spec.saleTotal,
                  depositApplied: 0,
                  outstandingAmount: orderBalance.expected ?? 0,
                };
          const sale: ReceivablesSaleDto = {
            sourceType: spec.channel === "CUSTOM_ORDER" ? "CUSTOM_ORDER" : "CATALOG_SALE",
            saleId: `sale-${index}`,
            code: spec.channel === "CUSTOM_ORDER" ? `PED-${index}` : `VTA-${index}`,
            saleCode: `VTA-${index}`,
            occurredAt: "2026-09-01T12:00:00.000Z",
            businessDate: "2026-09-01",
            channel: spec.channel,
            ...amounts,
            customerPrice: spec.saleTotal,
            qualifyingReceipts: spec.channel === "CUSTOM_ORDER" ? spec.qualifyingReceipts : 0,
            excess: orderBalance?.excess ?? 0,
            ageDays: spec.ageDays,
            customOrderId: spec.channel === "CUSTOM_ORDER" ? `order-${index}` : null,
          };

          return {
            customerId: spec.customerIndex === null ? null : `customer-${spec.customerIndex}`,
            customerName: spec.customerIndex === null ? null : `Customer ${spec.customerIndex}`,
            sale,
          };
        });

        const groups = groupReceivableSales(groupRows);
        const globalTotal = addMoney(
          ...groupRows.map((row) => toCentavos(row.sale.outstandingAmount)),
        );
        const groupedTotal = addMoney(...groups.map((group) => toCentavos(group.outstandingTotal)));
        const unassignedRows = groups
          .filter((group) => group.groupType === "NO_CUSTOMER")
          .flatMap((group) => group.sales);

        expect(groupedTotal).toBe(globalTotal);
        expect(unassignedRows.map((sale) => sale.saleId)).toEqual(
          specs.flatMap((spec, index) => (spec.customerIndex === null ? [`sale-${index}`] : [])),
        );
        for (const [index, spec] of specs.entries()) {
          const sale = groupRows[index]?.sale;
          if (sale?.sourceType === "CUSTOM_ORDER") {
            expect(
              subMoney(toCentavos(sale.customerPrice), toCentavos(sale.qualifyingReceipts)),
            ).toBe(toCentavos(sale.outstandingAmount));
            expect(sale.excess).toBe(0);
          } else if (sale) {
            expect(sale.outstandingAmount).toBe(spec.saleTotal);
            expect(sale.depositApplied).toBe(0);
          }
        }
      }),
    );
  });

  it("keeps catalog-sale balances equal to the full ON_CREDIT sale total", () => {
    expect(calculateReceivableAmounts(1_000, 1_000)).toEqual({
      saleTotal: 1_000,
      depositApplied: 0,
      outstandingAmount: 1_000,
    });
  });

  it("rejects a view balance that differs from the catalog sale total", () => {
    expect(() => calculateReceivableAmounts(10_000, 9_999)).toThrow(
      "El saldo derivado no coincide con v_receivables.",
    );
  });
});

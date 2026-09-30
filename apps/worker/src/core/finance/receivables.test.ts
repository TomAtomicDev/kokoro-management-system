import type { ReceivablesSaleDto } from "@kokoro/shared";
import { addMoney, subMoney, toCentavos } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { calculateReceivableAmounts, groupReceivableSales } from "./receivables.js";

function expectedOutstanding(saleTotal: number, depositApplied: number): number {
  const remainder = subMoney(toCentavos(saleTotal), toCentavos(depositApplied));
  return remainder > 0 ? remainder : toCentavos(0);
}

describe("grouped receivables math", () => {
  it("property: nets deposits and conserves the global centavo total across customer groups", () => {
    const saleSpecArbitrary = fc
      .integer({ min: 0, max: 1_000_000 })
      .chain((saleTotal) =>
        fc.record({
          saleTotal: fc.constant(saleTotal),
          depositApplied: fc.integer({ min: 0, max: saleTotal }),
          channel: fc.constantFrom("CATALOG" as const, "CUSTOM_ORDER" as const),
          customerIndex: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
          ageDays: fc.integer({ min: 0, max: 10_000 }),
        }),
      )
      .map((spec) => ({
        ...spec,
        depositApplied: spec.channel === "CUSTOM_ORDER" ? spec.depositApplied : 0,
      }));

    fc.assert(
      fc.property(fc.array(saleSpecArbitrary, { maxLength: 100 }), (specs) => {
        const groupRows = specs.map((spec, index) => {
          const expectedBalance = expectedOutstanding(spec.saleTotal, spec.depositApplied);
          const amounts = calculateReceivableAmounts(
            spec.saleTotal,
            spec.depositApplied,
            expectedBalance,
          );
          const sale: ReceivablesSaleDto = {
            saleId: `sale-${index}`,
            code: `VTA-${index}`,
            occurredAt: "2026-09-01T12:00:00.000Z",
            businessDate: "2026-09-01",
            channel: spec.channel,
            ...amounts,
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
        const unassignedSales = groups
          .filter((group) => group.groupType === "NO_CUSTOMER")
          .flatMap((group) => group.sales);

        expect(groupedTotal).toBe(globalTotal);
        expect(unassignedSales.map((sale) => sale.saleId)).toEqual(
          specs.flatMap((spec, index) => (spec.customerIndex === null ? [`sale-${index}`] : [])),
        );
        for (const [index, spec] of specs.entries()) {
          const sale = groupRows[index]?.sale;
          expect(sale?.outstandingAmount).toBe(
            expectedOutstanding(spec.saleTotal, spec.depositApplied),
          );
          if (sale) {
            expect(
              addMoney(toCentavos(sale.outstandingAmount), toCentavos(spec.depositApplied)),
            ).toBe(toCentavos(spec.saleTotal));
          }
        }
      }),
    );
  });

  it("caps an applied deposit at the sale total for the outstanding remainder", () => {
    expect(calculateReceivableAmounts(1_000, 1_200, 0)).toEqual({
      saleTotal: 1_000,
      depositApplied: 1_200,
      outstandingAmount: 0,
    });
  });

  it("rejects a view balance that does not match the sale less its applied deposit", () => {
    expect(() => calculateReceivableAmounts(10_000, 3_000, 6_999)).toThrow(
      "El saldo derivado no coincide con v_receivables.",
    );
  });
});

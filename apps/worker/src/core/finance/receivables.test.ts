import type { ReceivableSourceDto } from "@kokoro/shared";
import { addMoney, calculateOrderReceiptBalance, toCentavos } from "@kokoro/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { calculateReceivableAmounts, groupReceivableSources } from "./receivables.js";

describe("grouped receivables math", () => {
  it("property: eligible catalog/order debt conserves the total across groups", () => {
    const receivableSpecArbitrary = fc.integer({ min: 1, max: 1_000_000 }).chain((saleTotal) =>
      fc.record({
        saleTotal: fc.constant(saleTotal),
        qualifyingReceipts: fc.integer({ min: 0, max: 2_000_000 }),
        sourceType: fc.constantFrom("CATALOG_SALE" as const, "CUSTOM_ORDER" as const),
        orderStatus: fc.constantFrom(
          "QUOTING" as const,
          "CONFIRMED" as const,
          "IN_PRODUCTION" as const,
          "READY" as const,
          "DELIVERED" as const,
          "CANCELLED" as const,
        ),
        customerIndex: fc.option(fc.integer({ min: 0, max: 4 }), { nil: null }),
        ageDays: fc.integer({ min: 0, max: 10_000 }),
      }),
    );

    fc.assert(
      fc.property(fc.array(receivableSpecArbitrary, { maxLength: 100 }), (specs) => {
        const entries: {
          customerId: string | null;
          customerName: string | null;
          receivable: ReceivableSourceDto;
        }[] = [];

        for (const [index, spec] of specs.entries()) {
          const isOrder = spec.sourceType === "CUSTOM_ORDER";
          const orderBalance = isOrder
            ? calculateOrderReceiptBalance(spec.saleTotal, 0, spec.qualifyingReceipts)
            : null;
          const eligible =
            !isOrder || (spec.orderStatus === "DELIVERED" && (orderBalance?.expected ?? 0) > 0);
          if (!eligible) continue;

          const sourceId = isOrder ? `order-${index}` : `sale-${index}`;
          const receivable: ReceivableSourceDto = isOrder
            ? {
                sourceType: "CUSTOM_ORDER",
                channel: "CUSTOM_ORDER",
                saleId: `sale-${index}`,
                code: `PED-${index}`,
                saleCode: `VTA-${index}`,
                occurredAt: "2026-09-01T12:00:00.000Z",
                businessDate: "2026-09-01",
                saleTotal: spec.saleTotal,
                customerPrice: spec.saleTotal,
                qualifyingReceipts: spec.qualifyingReceipts,
                excess: orderBalance?.excess ?? 0,
                outstandingAmount: orderBalance?.expected ?? 0,
                ageDays: spec.ageDays,
                customOrderId: sourceId,
              }
            : {
                sourceType: "CATALOG_SALE",
                channel: "CATALOG",
                saleId: sourceId,
                code: `VTA-${index}`,
                saleCode: `VTA-${index}`,
                occurredAt: "2026-09-01T12:00:00.000Z",
                businessDate: "2026-09-01",
                saleTotal: spec.saleTotal,
                outstandingAmount: spec.saleTotal,
                ageDays: spec.ageDays,
                customOrderId: null,
              };

          entries.push({
            customerId: spec.customerIndex === null ? null : `customer-${spec.customerIndex}`,
            customerName: spec.customerIndex === null ? null : `Customer ${spec.customerIndex}`,
            receivable,
          });
        }

        const groups = groupReceivableSources(entries);
        const globalTotal = addMoney(
          ...entries.map((entry) => toCentavos(entry.receivable.outstandingAmount)),
        );
        const groupedTotal = addMoney(...groups.map((group) => toCentavos(group.outstandingTotal)));
        const groupedSources = groups.flatMap((group) => group.receivables);
        const noCustomerSources = groups
          .filter((group) => group.groupType === "NO_CUSTOMER")
          .flatMap((group) => group.receivables);
        const expectedNoCustomerSaleIds = entries
          .filter((entry) => entry.customerId === null)
          .map((entry) => entry.receivable.saleId);

        expect(groupedTotal).toBe(globalTotal);
        expect(groups.reduce((count, group) => count + group.receivableCount, 0)).toBe(
          entries.length,
        );
        expect(noCustomerSources.map((receivable) => receivable.saleId)).toEqual(
          expectedNoCustomerSaleIds,
        );
        expect(
          new Set(
            groupedSources.map((receivable) =>
              receivable.sourceType === "CUSTOM_ORDER"
                ? `order:${receivable.customOrderId}`
                : `sale:${receivable.saleId}`,
            ),
          ).size,
        ).toBe(entries.length);

        for (const entry of entries) {
          const receivable = entry.receivable;
          if (receivable.sourceType === "CUSTOM_ORDER") {
            const balance = calculateOrderReceiptBalance(
              receivable.customerPrice,
              0,
              receivable.qualifyingReceipts,
            );
            expect(balance.expected).toBe(receivable.outstandingAmount);
            expect(balance.expected).toBeGreaterThan(0);
            expect(balance.excess).toBe(0);
          } else {
            expect(receivable.outstandingAmount).toBe(receivable.saleTotal);
          }
        }
      }),
    );
  });

  it("keeps catalog-sale balances equal to the full ON_CREDIT sale total", () => {
    expect(calculateReceivableAmounts(1_000, 1_000)).toEqual({
      saleTotal: 1_000,
      outstandingAmount: 1_000,
    });
  });

  it("rejects a view balance that differs from the catalog sale total", () => {
    expect(() => calculateReceivableAmounts(10_000, 9_999)).toThrow(
      "El saldo derivado no coincide con v_receivables.",
    );
  });
});

// Unit + property tests for the pure money math in orders.ts (KOK-033, D-5 / Doc 11 §2). The
// stateful lifecycle itself is covered by apps/worker/test/orders.test.ts against real D1.
//
// `allocateAgreedTotalToOrderLines` is the only place a custom order's agreed price becomes
// per-unit sale prices, so "no centavo is invented or lost" is the property that matters: the sale
// it feeds stores `total` as Σ(qty × unit_price) (Doc 04 §5), and that has to reproduce
// `agreed_total` EXACTLY or O-2's "the sale is for the full agreed total" is a lie.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addMoney,
  type MilliCentavosPerUnit,
  subMoney,
  toCentavos,
  totalCentavos,
} from "./money.js";
import {
  allocateAgreedTotalToOrderLines,
  calculateOrderReceiptBalance,
  calculatePreDeliveryOrderCashExposure,
  confirmOrderCommandSchema,
  deliverOrderCommandSchema,
  listOrdersFiltersSchema,
  orderLineCommandSchema,
  serializeOrderListCursor,
  updateOrderCommandSchema,
} from "./orders.js";
import { toMilliUnits, WHOLE_UNIT_MILLI_UNITS } from "./qty.js";

/** Σ(qty × unit_price) exactly as core/orders will compute the sale's stored total. */
function reconstructTotal(
  allocations: readonly { unitPriceMc: MilliCentavosPerUnit }[],
  lines: readonly { qty: number }[],
): number {
  return allocations.reduce(
    (sum, a, i) => addMoney(sum, totalCentavos(a.unitPriceMc, toMilliUnits(lines[i]?.qty ?? 0))),
    toCentavos(0),
  );
}

describe("allocateAgreedTotalToOrderLines", () => {
  it("prices a single whole-unit line at the agreed total", () => {
    const lines = [{ qty: 1000 }];
    expect(allocateAgreedTotalToOrderLines(toCentavos(35_000), lines)).toEqual([
      { lineTotal: 35_000, unitPriceMc: 35_000_000 },
    ]);
  });

  it("splits across whole-unit lines weighted by qty", () => {
    // Bs 300,00 across 1 + 2 units → 100,00 / 200,00.
    const lines = [{ qty: 1000 }, { qty: 2000 }];
    expect(allocateAgreedTotalToOrderLines(toCentavos(30_000), lines)).toEqual([
      { lineTotal: 10_000, unitPriceMc: 10_000_000 },
      { lineTotal: 20_000, unitPriceMc: 10_000_000 },
    ]);
  });

  it("pins lines that carry an explicit lineTotal and splits only the remainder", () => {
    const lines = [{ qty: 1000, lineTotal: 12_000 }, { qty: 1000 }, { qty: 1000 }];
    const out = allocateAgreedTotalToOrderLines(toCentavos(30_000), lines);
    expect(out).toEqual([
      { lineTotal: 12_000, unitPriceMc: 12_000_000 },
      { lineTotal: 9_000, unitPriceMc: 9_000_000 },
      { lineTotal: 9_000, unitPriceMc: 9_000_000 },
    ]);
  });

  it("gives the odd centavo to the largest remainder, never dropping it", () => {
    // Bs 10,00 across three equal lines: 334 + 333 + 333 = 1000, exactly.
    const lines = [{ qty: 1000 }, { qty: 1000 }, { qty: 1000 }];
    const out = allocateAgreedTotalToOrderLines(toCentavos(1000), lines);
    expect(out?.map((a) => a.lineTotal)).toEqual([334, 333, 333]);
    expect(
      out?.reduce((sum, allocation) => addMoney(sum, allocation.lineTotal), toCentavos(0)),
    ).toBe(1000);
  });

  it("returns null when there are no lines at all (nothing to price)", () => {
    expect(allocateAgreedTotalToOrderLines(toCentavos(10_000), [])).toBeNull();
  });

  it("returns null when pinned lines exceed the agreed total", () => {
    expect(
      allocateAgreedTotalToOrderLines(toCentavos(10_000), [{ qty: 1000, lineTotal: 12_000 }]),
    ).toBeNull();
  });

  it("returns null when every line is pinned but the pins do not add up", () => {
    expect(
      allocateAgreedTotalToOrderLines(toCentavos(30_000), [
        { qty: 1000, lineTotal: 12_000 },
        { qty: 1000, lineTotal: 12_000 },
      ]),
    ).toBeNull();
  });

  it("accepts fully-pinned lines that DO add up exactly", () => {
    const out = allocateAgreedTotalToOrderLines(toCentavos(24_000), [
      { qty: 1000, lineTotal: 12_000 },
      { qty: 1000, lineTotal: 12_000 },
    ]);
    expect(out?.map((a) => a.lineTotal)).toEqual([12_000, 12_000]);
  });

  it("uses milli-centavo rate precision to reproduce fractional per-unit prices", () => {
    // Bs 1,00 over a 3-unit line was unrepresentable at whole-centavo rate precision.
    // The `_mc` rate (33_333) reconstructs the agreed total exactly after half-up rounding.
    expect(allocateAgreedTotalToOrderLines(toCentavos(100), [{ qty: 3000 }])).toEqual([
      { lineTotal: 100, unitPriceMc: 33_333 },
    ]);
  });

  it("returns null for a non-positive or non-integer qty", () => {
    expect(allocateAgreedTotalToOrderLines(toCentavos(1000), [{ qty: 0 }])).toBeNull();
    expect(allocateAgreedTotalToOrderLines(toCentavos(1000), [{ qty: -1000 }])).toBeNull();
    expect(allocateAgreedTotalToOrderLines(toCentavos(1000), [{ qty: 1500.5 }])).toBeNull();
  });

  it("property: single-unit lines ALWAYS allocate, and Σ(qty × unitPrice) === agreedTotal", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 20 }),
        (agreedTotal, lineCount) => {
          // qty === 1000 (one whole unit) on every line: the DDL default and the shape the
          // overwhelming majority of custom orders take. Here `unitPrice === lineTotal`
          // identically, so the reconstruction can never drift and the helper never refuses.
          const lines = Array.from({ length: lineCount }, () => ({ qty: 1000 }));
          const out = allocateAgreedTotalToOrderLines(toCentavos(agreedTotal), lines);
          expect(out).not.toBeNull();
          if (out === null) return;
          // The invariant that matters (Doc 11 §2): not one centavo invented or lost.
          expect(reconstructTotal(out, lines)).toBe(agreedTotal);
          for (const a of out) {
            expect(Number.isInteger(a.lineTotal)).toBe(true);
            expect(Number.isInteger(a.unitPriceMc)).toBe(true);
            expect(a.lineTotal).toBeGreaterThanOrEqual(0);
            expect(a.unitPriceMc).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("property: pinned lines are never altered, and the whole still reconstructs exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 10 }),
        (pinned, residual, unpinnedCount) => {
          const agreedTotal = addMoney(toCentavos(pinned), toCentavos(residual));
          const lines = [
            { qty: 1000, lineTotal: pinned },
            ...Array.from({ length: unpinnedCount }, () => ({ qty: 1000 })),
          ];
          const out = allocateAgreedTotalToOrderLines(agreedTotal, lines);
          expect(out).not.toBeNull();
          if (out === null) return;
          // Rule 1: a hand-priced line keeps exactly the price the owner typed.
          expect(out[0]?.lineTotal).toBe(pinned);
          expect(reconstructTotal(out, lines)).toBe(agreedTotal);
        },
      ),
    );
  });

  it("property: multi-unit lines either refuse or reconstruct exactly — never drift", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 12 }),
        (agreedTotal, unitCounts) => {
          // A line of N whole units carries ONE per-unit price, so its money is always a multiple
          // of N — some agreed totals are genuinely unrepresentable (Bs 1,00 over 3 units). The
          // helper must then refuse rather than round the customer's price.
          const lines = unitCounts.map((units) => ({ qty: units * WHOLE_UNIT_MILLI_UNITS }));
          const out = allocateAgreedTotalToOrderLines(toCentavos(agreedTotal), lines);
          if (out === null) return;
          expect(reconstructTotal(out, lines)).toBe(agreedTotal);
        },
      ),
    );
  });

  it("property: any successful allocation reconstructs exactly, whatever the quantities", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 9_000 }), { minLength: 1, maxLength: 12 }),
        (agreedTotal, qtys) => {
          const lines = qtys.map((qty) => ({ qty }));
          const out = allocateAgreedTotalToOrderLines(toCentavos(agreedTotal), lines);
          // Fractional quantities MAY be unrepresentable — but never silently wrong: the helper
          // either refuses (null) or reproduces the agreed total to the centavo.
          if (out === null) return;
          expect(reconstructTotal(out, lines)).toBe(agreedTotal);
        },
      ),
    );
  });
});

describe("calculateOrderReceiptBalance (KOK-205/KOK-207)", () => {
  it("property: customer amount, expected and excess conserve arbitrary integer centavos", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 2_000_000_000_000 }), { maxLength: 20 }),
        (merchandise, charge, receiptAmounts) => {
          const receipts = receiptAmounts.reduce(
            (total, amount) => addMoney(toCentavos(total), toCentavos(amount)),
            toCentavos(0),
          );
          const result = calculateOrderReceiptBalance(merchandise, charge, receipts);
          expect(result.customerAmount).not.toBeNull();
          expect(result.expected).not.toBeNull();
          expect(result.excess).not.toBeNull();
          if (
            result.customerAmount === null ||
            result.expected === null ||
            result.excess === null
          ) {
            return;
          }
          const signedDifference = subMoney(
            toCentavos(result.customerAmount),
            toCentavos(receipts),
          );
          expect(result.expected).toBeGreaterThanOrEqual(0);
          expect(result.excess).toBeGreaterThanOrEqual(0);
          expect(result.expected === 0 || result.excess === 0).toBe(true);
          expect(subMoney(toCentavos(result.expected), toCentavos(result.excess))).toBe(
            signedDifference,
          );
        },
      ),
    );
  });

  it("returns no numeric balance preview until a merchandise subtotal is agreed", () => {
    expect(calculateOrderReceiptBalance(null, 500, 1_250)).toEqual({
      customerAmount: null,
      expected: null,
      excess: null,
    });
  });

  it("accepts subtotal reduction below receipts and exposes the excess", () => {
    expect(calculateOrderReceiptBalance(1_000, 200, 1_500)).toEqual({
      customerAmount: 1_200,
      expected: 0,
      excess: 300,
    });
  });

  it("refuses customer amounts outside safe integer centavos", () => {
    expect(() => calculateOrderReceiptBalance(Number.MAX_SAFE_INTEGER, 1, 0)).toThrow();
  });

  it("rejects negative agreement amounts and receipts defensively", () => {
    expect(() => calculateOrderReceiptBalance(-1, 0, 0)).toThrow();
    expect(() => calculateOrderReceiptBalance(0, -1, 0)).toThrow();
    expect(() => calculateOrderReceiptBalance(0, 0, -1)).toThrow();
    expect(() => calculateOrderReceiptBalance(null, -1, 0)).toThrow();
  });
});

describe("calculatePreDeliveryOrderCashExposure (KOK-207)", () => {
  it("property: each order's exposure is nonnegative and never offsets another order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 2_000_000_000_000 }),
            fc.integer({ min: 0, max: 2_000_000_000_000 }),
          ),
          { minLength: 0, maxLength: 20 },
        ),
        (transactionsByOrder) => {
          const exposures = transactionsByOrder.map(([receipts, refunds]) =>
            calculatePreDeliveryOrderCashExposure(receipts, refunds),
          );
          const totalExposure = exposures.reduce(
            (total, exposure) => addMoney(toCentavos(total), toCentavos(exposure)),
            toCentavos(0),
          );
          const portfolioReceipts = transactionsByOrder.reduce(
            (total, [receipts]) => addMoney(toCentavos(total), toCentavos(receipts)),
            toCentavos(0),
          );
          const portfolioRefunds = transactionsByOrder.reduce(
            (total, [, refunds]) => addMoney(toCentavos(total), toCentavos(refunds)),
            toCentavos(0),
          );

          expect(exposures.every((exposure) => exposure >= 0)).toBe(true);
          expect(totalExposure).toBeGreaterThanOrEqual(
            calculatePreDeliveryOrderCashExposure(portfolioReceipts, portfolioRefunds),
          );
        },
      ),
    );
  });

  it("floors a refund excess at zero for its order", () => {
    expect(calculatePreDeliveryOrderCashExposure(250, 300)).toBe(0);
    expect(calculatePreDeliveryOrderCashExposure(900, 250)).toBe(650);
    const perOrderTotal = addMoney(
      toCentavos(calculatePreDeliveryOrderCashExposure(250, 300)),
      toCentavos(calculatePreDeliveryOrderCashExposure(1_000, 0)),
    );
    expect(perOrderTotal).toBe(1_000);
    expect(perOrderTotal).toBeGreaterThan(calculatePreDeliveryOrderCashExposure(1_250, 300));
  });

  it("rejects non-centavo-safe or negative inputs", () => {
    expect(() => calculatePreDeliveryOrderCashExposure(-1, 0)).toThrow();
    expect(() => calculatePreDeliveryOrderCashExposure(0, -1)).toThrow();
    expect(() => calculatePreDeliveryOrderCashExposure(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow();
  });
});

describe("cash-free order transition schemas (O-8)", () => {
  const dates = {
    occurredAt: "2026-07-20T14:00:00.000Z",
    businessDate: "2026-07-20",
  };

  it("confirms without payment fields and rejects attempts to include them", () => {
    expect(confirmOrderCommandSchema.safeParse({}).success).toBe(true);
    expect(
      confirmOrderCommandSchema.safeParse({ depositAmount: 100, accountId: "acc_cash" }).success,
    ).toBe(false);
  });

  it("accepts delivery date and R-5 flag only; rejects payment and risk fields", () => {
    expect(
      deliverOrderCommandSchema.safeParse({
        ...dates,
        confirm: true,
      }).success,
    ).toBe(true);
    expect(
      deliverOrderCommandSchema.safeParse({
        ...dates,
        balancePaymentStatus: "PAID",
        accountId: "acc_cash",
      }).success,
    ).toBe(false);
  });
});

describe("updateOrderCommandSchema (KOK-205)", () => {
  const command = {
    expectedUpdatedAt: "2026-07-20T14:00:00.000Z",
    customerId: "cus_1",
    description: "Pedido actualizado",
    agreedTotal: 1_000,
    additionalCharge: 125,
    deliveryDate: null,
    deliveryPlace: null,
    notes: null,
    lines: [{ itemId: "itm_1", qty: 1000, lineTotal: null }],
  };

  it("accepts explicit nullable clears and a zero subtotal", () => {
    expect(updateOrderCommandSchema.safeParse({ ...command, agreedTotal: 0 }).success).toBe(true);
  });

  it("rejects negative charges and missing optimistic version", () => {
    expect(updateOrderCommandSchema.safeParse({ ...command, additionalCharge: -1 }).success).toBe(
      false,
    );
    expect(
      updateOrderCommandSchema.safeParse({ ...command, expectedUpdatedAt: undefined }).success,
    ).toBe(false);
  });

  it("rejects a customer amount that cannot be represented as safe integer centavos", () => {
    expect(
      updateOrderCommandSchema.safeParse({
        ...command,
        agreedTotal: Number.MAX_SAFE_INTEGER,
        additionalCharge: 1,
      }).success,
    ).toBe(false);
  });
});

describe("orderLineCommandSchema", () => {
  it("accepts an item-linked line with no description", () => {
    const parsed = orderLineCommandSchema.parse({ itemId: "itm_1" });
    expect(parsed).toMatchObject({ itemId: "itm_1", qty: 1000 });
  });

  it("accepts a free-text line with a description and no item", () => {
    const parsed = orderLineCommandSchema.parse({ description: "Torta de 3 pisos" });
    expect(parsed).toMatchObject({ description: "Torta de 3 pisos", qty: 1000 });
  });

  it("rejects a line with neither an item nor a description", () => {
    expect(() => orderLineCommandSchema.parse({ qty: 2000 })).toThrow();
    expect(() => orderLineCommandSchema.parse({ description: "   " })).toThrow();
  });

  it("defaults qty to one whole unit (1000 milli-units), matching the DDL", () => {
    expect(orderLineCommandSchema.parse({ itemId: "itm_1" }).qty).toBe(1000);
  });
});

describe("listOrdersFiltersSchema cursor pagination (O-5)", () => {
  it("parses the shared JSON cursor query representation", () => {
    const cursor = {
      deliveryDate: null,
      createdAt: "2026-07-20T14:00:00.000Z",
      id: "order-1",
    };
    const query = new URLSearchParams({ cursor: serializeOrderListCursor(cursor) });

    expect(listOrdersFiltersSchema.parse(Object.fromEntries(query)).cursor).toEqual(cursor);
  });

  it("rejects malformed cursor values instead of restarting at the first page", () => {
    expect(listOrdersFiltersSchema.safeParse({ cursor: "not-json" }).success).toBe(false);
    expect(
      listOrdersFiltersSchema.safeParse({
        cursor: JSON.stringify({ deliveryDate: "2026-07-20", createdAt: "now" }),
      }).success,
    ).toBe(false);
  });
});

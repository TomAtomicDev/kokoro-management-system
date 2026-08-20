// Read-only source-event lookup for Finance's system-owned transactions (KOK-147).
//
// `financial_transactions.source_event_id` points at different tables depending on
// `source_event_type`. Session cost rows are the one indirect case: their source id is a
// `session_costs.id`, while the user needs the owning session's code and drawer link.

import type { FinancialTransactionSourceEventDto } from "@kokoro/shared";

import type { Db } from "../../db/index.js";

type TransactionSourceRef = {
  id: string;
  businessDate: string;
  sourceEventType: string | null;
  sourceEventId: string | null;
};

type SourceEventMap = Map<string, FinancialTransactionSourceEventDto>;

function idsFor(rows: readonly TransactionSourceRef[], sourceEventType: string): string[] {
  return rows
    .filter((row) => row.sourceEventType === sourceEventType && row.sourceEventId !== null)
    .map((row) => row.sourceEventId as string);
}

function key(sourceEventType: string, sourceEventId: string): string {
  return `${sourceEventType}\u0000${sourceEventId}`;
}

/** Loads only the source rows referenced by the requested Finance page. */
export async function loadTransactionSourceEvents(
  db: Db,
  rows: readonly TransactionSourceRef[],
): Promise<SourceEventMap> {
  const purchaseIds = idsFor(rows, "purchase");
  const saleIds = idsFor(rows, "sale");
  const orderIds = idsFor(rows, "custom_order");
  const sessionCostIds = idsFor(rows, "session_cost");

  const [purchaseRows, saleRows, orderRows, sessionCostRows] = await Promise.all([
    purchaseIds.length === 0
      ? []
      : db.query.purchases.findMany({
          where: (table, { inArray: inArrayOp }) => inArrayOp(table.id, purchaseIds),
          columns: { id: true, code: true, businessDate: true },
        }),
    saleIds.length === 0
      ? []
      : db.query.sales.findMany({
          where: (table, { inArray: inArrayOp }) => inArrayOp(table.id, saleIds),
          columns: { id: true, code: true, businessDate: true },
        }),
    orderIds.length === 0
      ? []
      : db.query.customOrders.findMany({
          where: (table, { inArray: inArrayOp }) => inArrayOp(table.id, orderIds),
          columns: { id: true, code: true },
        }),
    sessionCostIds.length === 0
      ? []
      : db.query.sessionCosts.findMany({
          where: (table, { inArray: inArrayOp }) => inArrayOp(table.id, sessionCostIds),
          columns: { id: true, sessionId: true },
        }),
  ]);

  const sessionIds = sessionCostRows.map((row) => row.sessionId);
  const sessionRows =
    sessionIds.length === 0
      ? []
      : await db.query.sessions.findMany({
          where: (table, { inArray: inArrayOp }) => inArrayOp(table.id, sessionIds),
          columns: { id: true, code: true, businessDate: true },
        });

  const sourceEvents: SourceEventMap = new Map();
  for (const row of purchaseRows) {
    sourceEvents.set(key("purchase", row.id), {
      type: "purchase",
      id: row.id,
      code: row.code,
      businessDate: row.businessDate,
    });
  }
  for (const row of saleRows) {
    sourceEvents.set(key("sale", row.id), {
      type: "sale",
      id: row.id,
      code: row.code,
      businessDate: row.businessDate,
    });
  }
  for (const row of orderRows) {
    const transaction = rows.find(
      (candidate) =>
        candidate.sourceEventType === "custom_order" && candidate.sourceEventId === row.id,
    );
    if (!transaction) continue;
    sourceEvents.set(key("custom_order", row.id), {
      type: "custom_order",
      id: row.id,
      code: row.code,
      // custom_orders has no business_date; its owning transaction carries the posting date.
      businessDate: transaction.businessDate,
    });
  }

  const sessionById = new Map(sessionRows.map((row) => [row.id, row]));
  for (const row of sessionCostRows) {
    const session = sessionById.get(row.sessionId);
    if (!session) continue;
    sourceEvents.set(key("session_cost", row.id), {
      type: "session",
      id: session.id,
      code: session.code,
      businessDate: session.businessDate,
    });
  }

  return sourceEvents;
}

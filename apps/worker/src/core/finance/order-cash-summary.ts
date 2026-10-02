// Shared Finance/Dashboard/snapshot read for receivables and pre-delivery order cash exposure.

import type { FinanceSummaryDto } from "@kokoro/shared";

import type { Db } from "../../db/index.js";
import { getReceivablesProjection } from "./receivables.js";

/** All amounts are derived at read time; order transactions remain the only source of cash. */
export async function getOrderCashReceivableSummary(db: Db): Promise<FinanceSummaryDto> {
  const projection = await getReceivablesProjection(db);
  return {
    preDeliveryOrderCashExposure: projection.preDeliveryOrderCashExposure,
    receivablesTotal: projection.receivablesTotal,
  };
}

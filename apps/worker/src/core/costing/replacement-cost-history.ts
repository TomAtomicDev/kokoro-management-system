import { generateUuidV7, type MilliCentavosPerUnit } from "@kokoro/shared";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { replacementCostHistory } from "../../db/schema.js";

export type ReplacementCostHistorySource = "PURCHASE" | "NIGHTLY" | "MANUAL";

interface ReplacementCostObservation {
  itemId: string;
  replacementCostMc: MilliCentavosPerUnit;
  observedAt: string;
  businessDate: string;
  source: ReplacementCostHistorySource;
}

type Statement = BatchItem<"sqlite">;

/** Builds the append-only KOK-073 observation inserted beside its matching item write (D-3). */
export function buildReplacementCostHistoryInsert(
  db: Db,
  observation: ReplacementCostObservation,
): Statement {
  return db.insert(replacementCostHistory).values({
    id: generateUuidV7(),
    itemId: observation.itemId,
    replacementCostMc: observation.replacementCostMc,
    observedAt: observation.observedAt,
    businessDate: observation.businessDate,
    source: observation.source,
  });
}

export type { CostingAdjustmentEntry, CostingAdjustmentTrigger } from "./adjustments.js";
export { buildCostingAdjustmentInsert } from "./adjustments.js";
export type { RecipeEdge } from "./dependency-graph.js";
export { topoOrderAffectedItems } from "./dependency-graph.js";
export type { WacDrift } from "./repair.js";
export { detectWacDrift, getCurrentWac } from "./repair.js";
export type { CostingReplayInput, CostingReplayPlan, PendingMovementChange } from "./replay.js";
export { planCostingReplay } from "./replay.js";
export type { ReplayMovement, WacState, WacTraceStep } from "./wac.js";
export {
  applyWacEntry,
  computePurchaseLineUnitCost,
  recomputeWacFromMovements,
  replayWacFrom,
  replayWacWithTrace,
  snapshotUnitCost,
} from "./wac.js";

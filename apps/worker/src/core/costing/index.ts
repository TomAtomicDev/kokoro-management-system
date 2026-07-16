export type { ReplayMovement } from "./wac.js";
export {
  applyWacEntry,
  computePurchaseLineUnitCost,
  recomputeWacFromMovements,
  snapshotUnitCost,
} from "./wac.js";
export { buildWacRepairIfDrifted, getCurrentWac } from "./repair.js";

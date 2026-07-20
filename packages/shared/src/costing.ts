// Backdated-replay contract (KOK-024 Phase A, R-4 / ADR-016, Doc 04 §3.4 `costing_adjustments`).
// Single-contract rule (D-4): the edit/delete API routes, the web confirmation dialog, and any
// future AI draft tool that mutates a past event import these same schemas — never redeclare this
// shape elsewhere.
//
// Why a "impact preview" DTO exists at all: editing or deleting a purchase, production run, or
// stock exit that sits in the PAST re-weights C-1's WAC for every later kardex entry of the same
// item, which retroactively changes the cost of consumption already booked against sales and
// exits. Doc 04 §3.4 forbids rewriting the frozen `unit_cost_snapshot` values; the correction is
// booked forward as a single `costing_adjustments` row instead. This DTO is what the server
// computes BEFORE writing anything, so the UI can show the owner what the correction will cost her
// and ask for confirmation.
//
// Mirrors packages/shared/src/exits.ts / counts.ts's shape (field schemas -> object schema ->
// inferred type).

import { z } from "zod";

/** A list of entity ids touched by a replay. Order is the server's (chronological); the schema
 * does not enforce uniqueness — the replay produces each id at most once by construction. */
const affectedIdsSchema = z.array(z.string().min(1));

/**
 * SIGNED integer centavos (D-5 — never a float, never `parseFloat`ed): the cumulative change in
 * cost-of-goods that the replay would book, i.e. what lands in `costing_adjustments.cost_delta`.
 *
 * Sign convention is Doc 04 §3.4's, stated from the MARGIN's point of view:
 * NEGATIVE = accumulated margin FELL (the recomputed cost is higher than what was frozen at event
 * time), POSITIVE = margin rose. Zero is legitimate and common — a backdated edit that lands after
 * every consumption of that item moves no downstream cost at all.
 */
const costDeltaSchema = z
  .number()
  .int("El ajuste de costo debe ser un entero (centavos).")
  .refine(Number.isSafeInteger, "El ajuste de costo excede el rango entero seguro.");

/**
 * What a backdated edit/delete WOULD do, computed before any write (R-4). Returned by the
 * impact-preview endpoint and echoed back by the mutation itself.
 */
export const replayImpactSchema = z.object({
  /** `sale_lines.id`s whose frozen cost snapshot the replay would correct. */
  affectedSaleLineIds: affectedIdsSchema,
  /** `stock_exits.id`s whose frozen cost snapshot the replay would correct. */
  affectedStockExitIds: affectedIdsSchema,
  /** `production_runs.id`s whose output cost the replay would correct — a run consumes inputs at
   * their WAC, so a re-weighted input cascades into the run's own output cost. */
  affectedProductionRunIds: affectedIdsSchema,
  /** Every `items.id` whose WAC the replay would move, including the items reached only
   * transitively through an affected production run's output. */
  affectedItemIds: affectedIdsSchema,
  /** Signed centavos — see `costDeltaSchema`. */
  costDelta: costDeltaSchema,
  /** True when the impact is large enough that the server refuses to proceed without an explicit
   * `confirm: true` from the caller. The THRESHOLD is a server-side business rule and lives in
   * `core/costing/`, never in the client — this flag is only the server's answer. */
  requiresConfirmation: z.boolean(),
});
export type ReplayImpactDto = z.infer<typeof replayImpactSchema>;

/**
 * The opt-in acknowledgement flag, to be spread into every mutating command that can trigger a
 * backdated replay (`.extend({ confirm: confirmFlagSchema })` or inline in the object literal).
 *
 * Defaults to FALSE deliberately: a caller that omits the field gets the safe behaviour (the
 * server computes the impact and refuses with a 409 carrying a `ReplayImpactDto`), so forgetting
 * to send it can never silently book a large correction.
 */
export const confirmFlagSchema = z.boolean().optional().default(false);

/**
 * The `details.reason` discriminator a service puts on the CONFLICT `DomainError` it throws when
 * `confirm` was required but not given (KOK-024 D1/D2). Deliberately a `details` field and NOT a new
 * `DomainErrorCode`: Doc 08 §2's code list is a closed set of HTTP-status CATEGORIES, not a business
 * error catalogue, and 409 is already the right status for "your command is fine, the STATE says
 * ask first". Widening the enum would force a Doc 08 amendment for zero routing benefit.
 *
 * The full shape a caller can rely on:
 *   `{ reason: REPLAY_CONFIRMATION_REQUIRED, impact: ReplayImpactDto }`
 * which is everything the confirmation dialog needs to render the preview and re-submit with
 * `confirm: true`.
 */
export const REPLAY_CONFIRMATION_REQUIRED = "REPLAY_CONFIRMATION_REQUIRED" as const;

/** `details` payload of the 409 above — see `REPLAY_CONFIRMATION_REQUIRED`. */
export interface ReplayConfirmationRequiredDetails {
  reason: typeof REPLAY_CONFIRMATION_REQUIRED;
  impact: ReplayImpactDto;
}

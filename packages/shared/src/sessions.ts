// Session command DTOs (KOK-027, Doc 03 §6 S-1/S-2/S-3, Doc 04 §3.2 `sessions`/`session_costs`).
// Single-contract rule (D-4): the API route and any future web form / AI draft tool for sessions
// import these same schemas — never redeclare field validation elsewhere.
//
// Mirrors packages/shared/src/purchasing.ts's shape (field schemas -> command schema -> hand
// -written DTOs), simplified where sessions genuinely differ from every other event vertical:
//   - NO costing replay (R-5 / ADR-016) is exposed on THIS CONTRACT — there is no `confirm` field
//     on `updateSessionCommandSchema` and no impact-preview endpoint anywhere in this module, since
//     a session row itself touches no kardex, no WAC, no `unit_cost_snapshot`. KOK-028 (S-3) is a
//     caveat on that claim at the SERVICE level, not the schema level: closing a PRODUCTION session
//     (`status: "CLOSED"` on this same command) does trigger a costing replay of its linked
//     production runs inside `apps/worker/src/core/sessions`'s `updateSession` — deliberately
//     without a confirmation gate (see that module's header for why) — but nothing about that
//     behavior is visible on this schema; the command a caller sends is identical either way.
//   - A session has no `occurred_at` column of its own (Doc 04 §3.2: only `business_date` +
//     required `started_at` and optional `ended_at`/`duration_min`) — apps/worker/src/core/sessions derives one for its
//     cost-line `financial_transactions` rows (see that module's `sessionTransactionOccurredAt`).
//   - `session_costs` lines are NOT all cash: `is_estimate` lines never create a
//     `financial_transactions` row or touch an account balance (Doc 03 §6 S-2) — they exist purely
//     for KOK-051's later profitability analysis. `accountId` is therefore required only when
//     `isEstimate` is false (enforced below by `.superRefine`, the same pattern
//     `core/finance/transactions.ts`'s `assertLegalCategoryForType` / finance.ts's
//     `recordTransactionCommandSchema` use for their own type/category pairing).
//
// KOK-028 (S-3, ADR-010c, shared-cost allocation on a PRODUCTION session's close) is implemented
// (see above), but entirely on the SERVICE side: nothing here names
// `production_runs.allocated_session_cost` and no DTO in this file changed shape for it.

import { z } from "zod";
import { businessDateSchema, calendarDateSchema } from "./dates.js";
import type { SessionStatus, SessionType } from "./enums.js";
import { sessionStatusSchema, sessionTypeSchema } from "./enums.js";
import { safeText } from "./text.js";

export const SESSION_COST_LABEL_MAX_LENGTH = 200;
export const SESSION_NOTES_MAX_LENGTH = 2000;

/** UTC ISO-8601 instant (Doc 04 §1) — the representation `startedAt`/`endedAt` share with every
 * other event vertical's `occurredAt`. */
const instantSchema = z
  .string()
  .datetime({ offset: true, message: "Debe ser una fecha ISO-8601." });
/** Minutes, matching `sessions.duration_min` (Doc 04 §3.2). Always positive — a session that took
 * zero minutes has nothing to record. */
const durationMinSchema = z
  .number()
  .int()
  .positive("La duración debe ser un entero positivo (minutos).");
/** Centavos (INV-6) for one shared-cost line. May be zero (Doc 04 §3.2's `amount >= 0` CHECK,
 * mirroring `purchaseLineCommandSchema`'s `lineTotal` allowing a free/promotional line) but never
 * negative. */
const costLineAmountSchema = z
  .number()
  .int()
  .nonnegative("El monto debe ser un entero no negativo (centavos).");

export const sessionCostLineCommandSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "La etiqueta del costo es obligatoria.")
      .pipe(safeText(SESSION_COST_LABEL_MAX_LENGTH)),
    amount: costLineAmountSchema,
    isEstimate: z.boolean().optional().default(false),
    // Required only when isEstimate is false (Doc 03 §6 S-2: estimates never touch cash). This is
    // the Zod-level half of the rule; core/sessions re-checks it at the service boundary (D-2:
    // core/ never trusts a caller already ran Zod) using the exact same condition.
    accountId: z.string().min(1).optional(),
  })
  .superRefine((line, ctx) => {
    if (!line.isEstimate && !line.accountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountId"],
        message: "Se requiere una cuenta cuando el costo no es una estimación.",
      });
    }
  });
/** `z.input`, not `z.infer`: `isEstimate`'s `.default()` would otherwise make the field required on
 * every literal (web mutation hooks, tests) that legitimately omits it and means "false" — same
 * reasoning as purchasing.ts's `RecordPurchaseCommand`. */
export type SessionCostLineCommand = z.input<typeof sessionCostLineCommandSchema>;

const recordSessionCommandObjectSchema = z.object({
  type: sessionTypeSchema,
  businessDate: businessDateSchema,
  startedAt: instantSchema,
  endedAt: instantSchema.optional(),
  durationMin: durationMinSchema.optional(),
  notes: z.string().trim().pipe(safeText(SESSION_NOTES_MAX_LENGTH)).optional(),
  // Empty is legitimate — a session may be opened with no shared costs yet and have lines added
  // later via an edit (unlike purchaseLineCommandSchema's lines, Doc 03 §6 states no "at least one
  // cost line" rule for sessions).
  costLines: z.array(sessionCostLineCommandSchema).optional().default([]),
});

export const recordSessionCommandSchema = recordSessionCommandObjectSchema.superRefine(
  (command, ctx) => {
    if (command.endedAt !== undefined && command.durationMin !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMin"],
        message: "Indica la hora de fin o la duración, no ambas.",
      });
    }
    if (
      command.endedAt !== undefined &&
      new Date(command.endedAt).getTime() <= new Date(command.startedAt).getTime()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endedAt"],
        message: "La hora de fin debe ser posterior al inicio.",
      });
    }
  },
);
/** `z.input` — `costLines`'s and its own lines' `.default()`s, same reasoning throughout this
 * module. There is intentionally no `status` field: core derives CLOSED when an end or duration is
 * supplied, while the start-now path (neither supplied) creates the session OPEN. */
export type RecordSessionCommand = z.input<typeof recordSessionCommandSchema>;

/** Doc 03 S-1b: atomically close the current OPEN session and start its same-type replacement. */
export const closeAndStartSessionCommandSchema = z.object({
  closeSessionId: z.string().min(1),
  newSession: recordSessionCommandSchema,
});
export type CloseAndStartSessionCommand = z.input<typeof closeAndStartSessionCommandSchema>;

/**
 * UC-14 edit / close (Doc 03 §6 S-2/S-3). Full replacement, same convention as
 * `updatePurchaseCommandSchema`: the caller sends the session's complete post-state, cost lines
 * included, never a patch. `status` is the one field this schema adds over the create shape.
 * Closing (`status: "CLOSED"`) additionally requires `endedAt` or `durationMin` to be resolvable —
 * a cross-field rule that reads as "the post-edit state", so `core/sessions` enforces it against
 * THIS command's own fields, not against the row being replaced.
 */
export const updateSessionCommandSchema = recordSessionCommandSchema.and(
  z.object({ status: sessionStatusSchema }),
);
export type UpdateSessionCommand = z.input<typeof updateSessionCommandSchema>;

/** DELETE/restore body (D-8 soft delete). No `confirm` flag anywhere in this module — unlike every
 * other event vertical, a session triggers no costing replay (see this file's header), so there is
 * nothing to confirm. An explicit empty object, not a bare inline `{}`, so the type has a name at
 * the call site. */
export const deleteSessionCommandSchema = z.object({});
export type DeleteSessionCommand = z.infer<typeof deleteSessionCommandSchema>;

/** GET /sessions query filters — mirrors listPurchasesFiltersSchema's shape. Filter boundaries use
 * `calendarDateSchema`, not `businessDateSchema`: a future-dated range is a legitimate (if empty)
 * query, unlike a session's own `businessDate` above. */
export const listSessionsFiltersSchema = z.object({
  type: sessionTypeSchema.optional(),
  status: sessionStatusSchema.optional(),
  fromDate: calendarDateSchema.optional(),
  toDate: calendarDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListSessionsFilters = z.infer<typeof listSessionsFiltersSchema>;

export interface SessionCostLineDto {
  id: string;
  label: string;
  /** Centavos (INV-6). */
  amount: number;
  isEstimate: boolean;
  /** Null only when `isEstimate` is true (the command schema's `.superRefine` requires it
   * otherwise). */
  accountId: string | null;
}

export interface SessionDto {
  id: string;
  type: SessionType;
  businessDate: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Minutes, exactly as stored (Doc 04 §3.2) — NOT the COALESCEd/computed value
   * `SessionListItemDto.durationMin` exposes for the list screen. */
  durationMin: number | null;
  status: SessionStatus;
  /** KOK-185: human-readable code (SES-NNNN-YYYY) — see packages/shared/src/sales.ts's
   * SaleDto.code for the full contract. */
  code: string | null;
  notes: string | null;
  costLines: SessionCostLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordSessionResult {
  session: SessionDto;
}

/** Doc 03 S-1b composite result: both states committed by the same atomic command batch. */
export interface CloseAndStartSessionResult {
  closedSession: SessionDto;
  newSession: SessionDto;
}

export interface UpdateSessionResult {
  session: SessionDto;
}

/** Mirrors `DeleteStockExitResult`/`DeleteProductionRunResult` (exits.ts/production-runs.ts) — no
 * account, unlike `DeletePurchaseResult`: a session's shared costs can touch MANY accounts (one per
 * non-estimate cost line), never exactly one. */
export interface DeleteSessionResult {
  session: SessionDto;
  deletedAt: string;
}

/** Mirrors `UpdateSessionResult` — same shape purchasing.ts's `restorePurchase` reuses
 * `UpdatePurchaseResult` for. */
export type RestoreSessionResult = UpdateSessionResult;

/** One linked-event row for the "linked events viewer" (Doc 07 SC-09). Deliberately minimal — id,
 * instant, a short label — never a generic polymorphic type across the four event tables. */
export interface SessionLinkedEventDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  label: string;
}

export interface SessionLinkedEventsDto {
  purchases: SessionLinkedEventDto[];
  productionRuns: SessionLinkedEventDto[];
  sales: SessionLinkedEventDto[];
  stockExits: SessionLinkedEventDto[];
}

export interface GetSessionResult {
  session: SessionDto;
  linkedEvents: SessionLinkedEventsDto;
}

/** One row of the sessions list (Doc 07 SC-09), backed by `v_session_hours`
 * (apps/worker/migrations/0001_init.sql) for duration/linked-event count, joined in application
 * code with each session's cost-lines total. */
export interface SessionListItemDto {
  id: string;
  type: SessionType;
  businessDate: string;
  status: SessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  /** Minutes, COALESCEd from the stored value or computed from `started_at`/`ended_at` by
   * `v_session_hours` — null when neither is resolvable. */
  durationMin: number | null;
  /** Count of non-deleted purchases/production_runs/sales/stock_exits referencing this session
   * (`v_session_hours.linked_event_count`). */
  linkedEventCount: number;
  /** Centavos (INV-6): Σ `session_costs.amount` across ALL lines, estimates included — Doc 03 §6
   * distinguishes estimates only for cash creation, never for this display total. */
  costsTotal: number;
  /** KOK-185: human-readable code (SES-NNNN-YYYY) — see SessionDto.code. */
  code: string | null;
}

export interface ListSessionsResult {
  sessions: SessionListItemDto[];
}

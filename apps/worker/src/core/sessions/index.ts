// core/sessions — UC-14 "Open/close session" (KOK-027, Doc 03 §6 S-1/S-2/S-3, Doc 04 §3.2
// `sessions`/`session_costs`). Mirrors core/purchasing/index.ts's TEMPLATE shape (that module's own
// header): `recordSession`/`updateSession`/`deleteSession`/`restoreSession` are top-level command
// entry points, not building blocks — each does its own defensive validation, builds every row
// itself, and executes exactly ONE atomic `db.batch()` (D-3).
//
// Simpler than every other event vertical in one structural way, with one KOK-028 exception:
//   - A session touches no kardex/WAC of its OWN — there is no `confirm` flag on this module's own
//     command schemas, no impact-preview endpoint, nothing to refuse-then-confirm for the session
//     row itself; every command here either succeeds or throws outright. KOK-028 (S-3, ADR-010c)
//     is the one place `core/costing` gets pulled in anyway: closing a PRODUCTION session can
//     change its linked production runs' `allocated_session_cost`, which cascades into the kardex
//     exactly as an edit of one of those runs would (see `updateSession`'s own doc comment and
//     `core/production`'s `planSessionCostAllocation`, which does the actual work). JUDGMENT CALL:
//     that cascade is applied UNCONDITIONALLY, never gated behind a confirmation the caller lacks a
//     field to carry — a session-close-triggered recompute is a system-derived, deterministic
//     consequence of S-3, not a free-form edit a human is proposing, so `planCostingReplay`'s
//     `confirmationRequired` (R-5, meant for a human edit that surprises an already-reported
//     number) is read for its statements but its confirmation gate is intentionally not enforced
//     here. Doc 07 SC-09 describes the UI result as "shows the resulting per-run cost updates",
//     not "may ask to confirm", which reads as the same judgment.
//   - `session_costs` lines, not a single aggregate total: each line owns its OWN
//     `financial_transactions` row (system-owned, `sourceEventType: "session_cost"`,
//     `sourceEventId: <session_costs.id>` — mirrors core/purchasing's `SUPPLY_PURCHASE` row
//     convention of "sourceEventId set here, unlike core/finance/transactions.ts's standalone
//     commands", except here the "event" a row is sourced from is the cost LINE, not the session
//     aggregate). `is_estimate` lines create NEITHER a transaction NOR a balance delta (Doc 03 §6
//     S-2) — they exist purely for KOK-051's later profitability analysis.
//
// Cost-line edits (`updateSession`) reverse the OLD lines' transactions and create NEW ones for a
// full-replacement cost-line list — the same "regenerate derived rows from the post-state"
// technique `core/purchasing`'s `commitPurchaseMutation` uses for its single `SUPPLY_PURCHASE` row,
// generalized here to a SET of source ids (one per cost line, since `session_costs` rows are fully
// replaced on every edit exactly like `purchase_lines` are) via this module's own
// `buildSessionCostTransactionReplacementStatements`, built from `core/finance/accounts.ts`'s
// `buildAccountBalanceDelta` — the shared primitive `buildReplaceTransactionsForSourceStatements`
// is keyed on exactly ONE `(sourceEventType, sourceEventId)`, which does not fit a per-line source
// id set, so this module composes the same idea itself rather than force-fitting that primitive.
//
// KOK-028 (S-3, ADR-010c: shared-cost allocation on a PRODUCTION session's close) IS wired in here
// — see `updateSession`'s own doc comment — but the actual allocation/replay mechanics live in
// `core/production`'s `planSessionCostAllocation`, not in this file: this module only decides WHEN
// to call it (post-edit `type === "PRODUCTION" && status === "CLOSED"`) and sums the cost-line
// total it passes in. Nothing in `packages/shared/src/sessions.ts` changed for this — the
// allocation is a pure side effect of the existing `updateSession` command, not a new field.

import type {
  AuditActor,
  CloseAndStartSessionCommand,
  CloseAndStartSessionResult,
  DeleteSessionCommand,
  DeleteSessionResult,
  GetSessionResult,
  ListSessionsFilters,
  ListSessionsResult,
  RecordSessionCommand,
  RecordSessionResult,
  RestoreSessionResult,
  SessionCostLineDto,
  SessionDto,
  SessionLinkedEventsDto,
  SessionStatus,
  SessionType,
  UpdateSessionCommand,
  UpdateSessionResult,
} from "@kokoro/shared";
import { generateUuidV7, nowIso } from "@kokoro/shared";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { financialTransactions, sessionCosts, sessions } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { conflict, notFound, validationError } from "../errors.js";
import type { FinancialTransactionInput } from "../finance/accounts.js";
import { buildAccountBalanceDelta, findActiveAccountRowOrThrow } from "../finance/accounts.js";
import { planSessionCostAllocation } from "../production/index.js";

type Statement = BatchItem<"sqlite">;
type SessionRow = typeof sessions.$inferSelect;
type SessionCostRow = typeof sessionCosts.$inferSelect;

/** `financial_transactions.source_event_type` for every row this module writes (Doc 04 §5). The
 * "event" a row is sourced from is one `session_costs` line, not the session aggregate — see this
 * module's header. */
const SOURCE_EVENT_TYPE = "session_cost";

function toSessionCostLineDto(row: SessionCostRow): SessionCostLineDto {
  return {
    id: row.id,
    label: row.label,
    amount: row.amount,
    isEstimate: row.isEstimate === 1,
    accountId: row.accountId,
  };
}

function toSessionDto(row: SessionRow, costRows: readonly SessionCostRow[]): SessionDto {
  return {
    id: row.id,
    type: row.type,
    businessDate: row.businessDate,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMin: row.durationMin,
    status: row.status,
    notes: row.notes,
    costLines: costRows.map(toSessionCostLineDto),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * `financial_transactions.occurred_at` for a session's cost-line rows. Sessions have no
 * `occurred_at` column of their own (Doc 04 §3.2 — only `business_date` +
 * `started_at`/`ended_at`/`duration_min`, unlike every other event vertical), so this derives one:
 * `started_at` (the session's own beginning) when known, else `ended_at`, else midday UTC on
 * `business_date` as a neutral anchor for a session captured as a bare duration with no wall-clock
 * timestamp at all.
 *
 * JUDGMENT CALL — Doc 03 §6 does not specify this; any of the three reads honestly as "when this
 * session's shared cost was incurred," and `financial_transactions.occurred_at` is NOT NULL
 * (Doc 04 §3.4) so something must be chosen.
 */
function sessionTransactionOccurredAt(session: {
  businessDate: string;
  startedAt: string | null;
  endedAt: string | null;
}): string {
  return session.startedAt ?? session.endedAt ?? `${session.businessDate}T12:00:00.000Z`;
}

/** Defensive re-check of `sessionCostLineCommandSchema`'s `.superRefine` (D-2: core/ services never
 * trust a caller already ran Zod). */
function assertCostLinesValid(
  lines: readonly { isEstimate?: boolean; accountId?: string }[],
): void {
  for (const line of lines) {
    if (!line.isEstimate && !line.accountId) {
      throw validationError("Se requiere una cuenta cuando el costo no es una estimación.", {
        line,
      });
    }
  }
}

/**
 * The `financial_transactions` input one non-estimate cost line projects, or null. Two cases skip
 * a row entirely, both mirroring core/purchasing/index.ts's identical guards:
 *   - `isEstimate`: Doc 03 §6 S-2 — estimates never touch cash.
 *   - `amount <= 0`: `financial_transactions.amount > 0` is a CHECK (Doc 04 §3.4); `session_costs`'s
 *     own CHECK only requires `>= 0` (a zero-cost line is legitimate, e.g. a placeholder row added
 *     before its real amount is known), so a zero-amount non-estimate line is skipped exactly like
 *     a zero-total purchase skips its row.
 */
function buildSessionCostTransactionInput(
  session: { businessDate: string; startedAt: string | null; endedAt: string | null },
  costLineId: string,
  // `isEstimate` is the STORED 0/1 representation (SessionCostRow, `session_costs.is_estimate`'s
  // own column type), not the DTO's boolean — every call site passes an actual cost row (freshly
  // built or read back from the DB), never the command's `SessionCostLineCommand` shape directly.
  line: { amount: number; isEstimate: number; accountId: string | null },
): FinancialTransactionInput | null {
  if (line.isEstimate === 1) return null;
  if (line.amount <= 0) return null;
  const accountId = line.accountId;
  if (!accountId) {
    // Unreachable given assertCostLinesValid already ran on every command path that reaches here —
    // fails loudly rather than silently if that invariant is ever broken by a future edit.
    throw validationError("Se requiere una cuenta cuando el costo no es una estimación.", { line });
  }
  return {
    occurredAt: sessionTransactionOccurredAt(session),
    businessDate: session.businessDate,
    accountId,
    type: "EXPENSE",
    category: "OPERATING_EXPENSE",
    amount: line.amount,
    description: null,
    sourceEventType: SOURCE_EVENT_TYPE,
    sourceEventId: costLineId,
  };
}

/**
 * Builds (does not execute) the cost-line transaction regeneration for an update/delete/restore:
 * reverses every `oldCostLineIds` row's `financial_transactions` effect (a no-op for ids that never
 * had one, e.g. an estimate line) and inserts `newTransactionInputs`, netting exactly ONE
 * `buildAccountBalanceDelta` per touched account — the same netting-by-account discipline
 * `buildReplaceTransactionsForSourceStatements` (core/finance/accounts.ts) uses for purchases'
 * single `SUPPLY_PURCHASE` row, generalized here to a SET of source ids (see this module's header
 * for why that shared primitive itself isn't reused directly).
 *
 * Every row this reverses is, by construction, `type: "EXPENSE"` (the only type this module ever
 * writes — `buildSessionCostTransactionInput` never produces anything else), so reversing one is
 * always "add the amount back" — there is no need to read `type` per row and branch on direction
 * the way `core/finance/accounts.ts`'s `signedBalanceEffect` does for its general-purpose caller.
 */
async function buildSessionCostTransactionReplacementStatements(
  db: Db,
  oldCostLineIds: readonly string[],
  newTransactionInputs: readonly FinancialTransactionInput[],
): Promise<{ statements: Statement[] }> {
  const existingRows =
    oldCostLineIds.length > 0
      ? await db.query.financialTransactions.findMany({
          where: (t, { and: andOp, eq: eqOp, inArray: inArrayOp }) =>
            andOp(
              eqOp(t.sourceEventType, SOURCE_EVENT_TYPE),
              inArrayOp(t.sourceEventId, [...oldCostLineIds]),
            ),
        })
      : [];

  const statements: Statement[] = [];
  if (oldCostLineIds.length > 0) {
    statements.push(
      db
        .delete(financialTransactions)
        .where(
          and(
            eq(financialTransactions.sourceEventType, SOURCE_EVENT_TYPE),
            inArray(financialTransactions.sourceEventId, [...oldCostLineIds]),
          ),
        ),
    );
  }

  const now = nowIso();
  const net = new Map<string, number>();
  for (const row of existingRows) {
    // Soft-deleted rows were already subtracted from the balance when they were soft-deleted
    // (mirrors buildReplaceTransactionsForSourceStatements's identical guard) — not reachable today
    // (nothing soft-deletes a session_cost-sourced transaction independently of its session), kept
    // for the same defensive reason that primitive keeps it.
    if (row.deletedAt !== null) continue;
    net.set(row.accountId, (net.get(row.accountId) ?? 0) + row.amount);
  }
  for (const input of newTransactionInputs) {
    statements.push(
      db.insert(financialTransactions).values({
        id: generateUuidV7(),
        occurredAt: input.occurredAt,
        businessDate: input.businessDate,
        accountId: input.accountId,
        type: input.type,
        category: input.category,
        amount: input.amount,
        counterpartTxId: null,
        sourceEventType: input.sourceEventType,
        sourceEventId: input.sourceEventId,
        description: input.description ?? null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
    net.set(input.accountId, (net.get(input.accountId) ?? 0) - input.amount);
  }

  for (const [accountId, delta] of net) {
    if (delta !== 0) statements.push(buildAccountBalanceDelta(db, accountId, delta));
  }

  return { statements };
}

/** Doc 03 S-1: resolve an event's mandatory session without executing a batch. Any minimal
 * session insert is returned for the caller to place before its FK-dependent event statement. */
export async function resolveSessionForEvent(
  db: Db,
  params: {
    type: SessionType;
    occurredAt: string;
    businessDate: string;
    explicitSessionId?: string | null;
  },
): Promise<{ sessionId: string; status: SessionStatus; statements: Statement[] }> {
  if (params.explicitSessionId) {
    const explicit = await db.query.sessions.findFirst({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.id, params.explicitSessionId as string), isNullOp(t.deletedAt)),
    });
    if (!explicit) {
      throw notFound("No se encontró la sesión.", { id: params.explicitSessionId });
    }
    if (explicit.type !== params.type) {
      throw validationError(
        `La sesión es de tipo ${explicit.type} pero el evento requiere tipo ${params.type}.`,
        { sessionId: explicit.id, actualType: explicit.type, requiredType: params.type },
      );
    }
    return { sessionId: explicit.id, status: explicit.status, statements: [] };
  }

  const open = await db.query.sessions.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(t.type, params.type), eqOp(t.status, "OPEN"), isNullOp(t.deletedAt)),
  });
  if (open) return { sessionId: open.id, status: "OPEN", statements: [] };

  const sessionId = generateUuidV7();
  const now = nowIso();
  const row: SessionRow = {
    id: sessionId,
    type: params.type,
    businessDate: params.businessDate,
    startedAt: params.occurredAt,
    endedAt: null,
    durationMin: null,
    status: "OPEN",
    notes: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return { sessionId, status: "OPEN", statements: [db.insert(sessions).values(row)] };
}

/** Doc 03 S-1b service guard mirroring the partial unique index with a typed domain conflict. */
export async function assertNoConflictingOpenSession(
  db: Db,
  type: SessionType,
  excludeSessionId?: string,
): Promise<void> {
  const existing = await db.query.sessions.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp, ne: neOp }) =>
      andOp(
        eqOp(t.type, type),
        eqOp(t.status, "OPEN"),
        isNullOp(t.deletedAt),
        ...(excludeSessionId ? [neOp(t.id, excludeSessionId)] : []),
      ),
  });
  if (existing) {
    throw conflict(`Ya existe una sesión abierta de tipo ${type}.`, {
      type,
      existingSessionId: existing.id,
    });
  }
}

/**
 * UC-14 create (Doc 03 §6 S-1/S-2): a session + its shared-cost lines + one `financial_transactions`
 * row per non-estimate line (+ its account balance delta) + the audit_log row, in ONE atomic batch
 * (D-3). Status is derived rather than accepted from the caller: an end or direct duration creates
 * the session CLOSED; otherwise the start-now path creates it OPEN.
 */
export async function recordSession(
  db: Db,
  command: RecordSessionCommand,
  actor: AuditActor,
): Promise<RecordSessionResult> {
  const costLines = command.costLines ?? [];
  assertCostLinesValid(costLines);

  // Every distinct account a non-estimate line references must be active — the same "destination
  // account must be active" check every other command runs before batching.
  const accountIds = new Set(
    costLines.filter((l) => !l.isEstimate && l.accountId).map((l) => l.accountId as string),
  );
  for (const accountId of accountIds) {
    await findActiveAccountRowOrThrow(db, accountId);
  }

  const status: SessionStatus = hasResolvableDuration(command) ? "CLOSED" : "OPEN";
  if (status === "OPEN") {
    await assertNoConflictingOpenSession(db, command.type);
  }

  const sessionId = generateUuidV7();
  const now = nowIso();

  const sessionRow: SessionRow = {
    id: sessionId,
    type: command.type,
    businessDate: command.businessDate,
    startedAt: command.startedAt,
    endedAt: command.endedAt ?? null,
    durationMin: command.durationMin ?? null,
    status,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const costRows: SessionCostRow[] = costLines.map((line) => ({
    id: generateUuidV7(),
    sessionId,
    label: line.label,
    amount: line.amount,
    isEstimate: line.isEstimate ? 1 : 0,
    accountId: line.accountId ?? null,
  }));

  const transactionInputs = costRows
    .map((row) => buildSessionCostTransactionInput(sessionRow, row.id, row))
    .filter((input): input is FinancialTransactionInput => input !== null);

  const balanceDeltas = new Map<string, number>();
  for (const input of transactionInputs) {
    balanceDeltas.set(input.accountId, (balanceDeltas.get(input.accountId) ?? 0) - input.amount);
  }

  const allocationStatements: Statement[] = [];
  if (sessionRow.type === "PRODUCTION" && sessionRow.status === "CLOSED") {
    let totalSharedCost = 0;
    for (const row of costRows) totalSharedCost += row.amount;
    // Keep the S-3 trigger uniform across every CLOSED production-session write; a new id has no
    // linked runs yet, so the planner normally returns no statements here.
    const allocation = await planSessionCostAllocation(
      db,
      sessionId,
      totalSharedCost,
      sessionRow.businessDate,
      sessionTransactionOccurredAt(sessionRow),
      actor,
    );
    allocationStatements.push(...allocation.statements);
  }

  const statements: Statement[] = [
    db.insert(sessions).values(sessionRow),
    ...costRows.map((row) => db.insert(sessionCosts).values(row)),
    ...transactionInputs.map((input) =>
      db.insert(financialTransactions).values({
        id: generateUuidV7(),
        occurredAt: input.occurredAt,
        businessDate: input.businessDate,
        accountId: input.accountId,
        type: input.type,
        category: input.category,
        amount: input.amount,
        counterpartTxId: null,
        sourceEventType: input.sourceEventType,
        sourceEventId: input.sourceEventId,
        description: input.description ?? null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    ),
    ...[...balanceDeltas.entries()].map(([accountId, delta]) =>
      buildAccountBalanceDelta(db, accountId, delta),
    ),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "sessions",
      entityId: sessionId,
      before: null,
      after: { ...sessionRow, costLines: costRows },
    }),
    ...allocationStatements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return { session: toSessionDto(sessionRow, costRows) };
}

/** Loads a session and its cost lines for mutation, refusing one that is missing or already
 * soft-deleted (INV-10: a reverted event is not editable — re-recording is the correction path). */
async function loadSessionForMutation(
  db: Db,
  id: string,
): Promise<{ row: SessionRow; costRows: SessionCostRow[] }> {
  const row = await db.query.sessions.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(t.id, id), isNullOp(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la sesión.", { id });
  }
  const costRows = await db.query.sessionCosts.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.sessionId, id),
  });
  return { row, costRows };
}

/**
 * Doc 03 §6 S-2: closing a session (`status: "CLOSED"`) requires its duration to be resolvable —
 * either a direct `durationMin` or both `startedAt`/`endedAt` to compute one from (mirrors
 * `v_session_hours`'s own COALESCE, apps/worker/migrations/0001_init.sql). Evaluated against the
 * POST-EDIT command fields (this command is a full replacement, same convention as every other
 * command in this codebase), not against the row being replaced.
 */
function hasResolvableDuration(command: {
  startedAt: string;
  endedAt?: string;
  durationMin?: number;
}): boolean {
  return command.durationMin !== undefined || command.endedAt !== undefined;
}

function assertClosableDuration(command: UpdateSessionCommand): void {
  if (command.status !== "CLOSED") return;
  if (!hasResolvableDuration(command)) {
    throw validationError(
      "Para cerrar una sesión se requiere la duración: indica minutos directos o inicio y fin.",
      {},
    );
  }
}

/**
 * UC-14 edit / close (Doc 03 §6 S-2, R-1-style full replacement): replaces a session's content and
 * its cost lines, regenerating every row derived from the cost lines — their
 * `financial_transactions` rows and account balances — in ONE atomic batch (D-3).
 *
 * `command.costLines` becomes the session's COMPLETE post-edit cost-line set, exactly like
 * `updatePurchase`'s `command.lines` — old `session_costs` rows are deleted and replaced wholesale
 * (they carry no independent identity a client edits incrementally; Doc 04 §3.2 has no `deleted_at`
 * on `session_costs` at all), and the OLD lines' transactions are reversed / the NEW lines' created
 * via `buildSessionCostTransactionReplacementStatements`.
 *
 * KOK-028 (S-3, ADR-010c): whenever the POST-EDIT session is `type: "PRODUCTION"` and
 * `status: "CLOSED"`, this also re-runs the shared-cost allocation across the session's linked
 * production runs (`core/production`'s `planSessionCostAllocation`) and folds its statements into
 * this SAME batch. Every time, not only on the OPEN->CLOSED transition — re-saving an
 * already-CLOSED PRODUCTION session (e.g. after correcting a cost line, or linking another run) is
 * the correction path, and the allocation call is idempotent: a run whose share hasn't actually
 * moved emits no statement for it (see that function's header). The basis passed is Σ
 * `session_costs.amount` across ALL of `newCostRows` — cash AND `is_estimate` lines alike (Doc 03
 * §6 does not carve estimates out of the allocation basis, only out of cash creation; this mirrors
 * `listSessions`'s own `costsTotal` display for the same reason).
 */
export async function updateSession(
  db: Db,
  id: string,
  command: UpdateSessionCommand,
  actor: AuditActor,
): Promise<UpdateSessionResult> {
  assertClosableDuration(command);
  const costLines = command.costLines ?? [];
  assertCostLinesValid(costLines);

  const { row: existing, costRows: existingCostRows } = await loadSessionForMutation(db, id);

  if (command.status === "OPEN") {
    await assertNoConflictingOpenSession(db, command.type, id);
  }

  const accountIds = new Set(
    costLines.filter((l) => !l.isEstimate && l.accountId).map((l) => l.accountId as string),
  );
  for (const accountId of accountIds) {
    await findActiveAccountRowOrThrow(db, accountId);
  }

  const now = nowIso();
  const newRow: SessionRow = {
    ...existing,
    type: command.type,
    businessDate: command.businessDate,
    startedAt: command.startedAt ?? null,
    endedAt: command.endedAt ?? null,
    durationMin: command.durationMin ?? null,
    status: command.status,
    notes: command.notes ?? null,
    updatedAt: now,
  };

  const newCostRows: SessionCostRow[] = costLines.map((line) => ({
    id: generateUuidV7(),
    sessionId: id,
    label: line.label,
    amount: line.amount,
    isEstimate: line.isEstimate ? 1 : 0,
    accountId: line.accountId ?? null,
  }));

  const newTransactionInputs = newCostRows
    .map((row) => buildSessionCostTransactionInput(newRow, row.id, row))
    .filter((input): input is FinancialTransactionInput => input !== null);

  const { statements: transactionStatements } =
    await buildSessionCostTransactionReplacementStatements(
      db,
      existingCostRows.map((r) => r.id),
      newTransactionInputs,
    );

  // KOK-028 (S-3): see this function's own doc comment. Computed from `newCostRows` (the post-edit
  // set), not `costLines`, so it reads the same normalized shape (isEstimate as 0/1) every other
  // total in this module reads.
  const allocationStatements: Statement[] = [];
  if (newRow.type === "PRODUCTION" && newRow.status === "CLOSED") {
    let totalSharedCost = 0;
    for (const row of newCostRows) totalSharedCost += row.amount;
    const allocation = await planSessionCostAllocation(
      db,
      id,
      totalSharedCost,
      newRow.businessDate,
      sessionTransactionOccurredAt(newRow),
      actor,
    );
    allocationStatements.push(...allocation.statements);
  }

  const statements: Statement[] = [
    db
      .update(sessions)
      .set({
        type: newRow.type,
        businessDate: newRow.businessDate,
        startedAt: newRow.startedAt,
        endedAt: newRow.endedAt,
        durationMin: newRow.durationMin,
        status: newRow.status,
        notes: newRow.notes,
        updatedAt: newRow.updatedAt,
      })
      .where(eq(sessions.id, id)),
    db.delete(sessionCosts).where(eq(sessionCosts.sessionId, id)),
    ...newCostRows.map((row) => db.insert(sessionCosts).values(row)),
    ...transactionStatements,
    buildAuditLogInsert(db, {
      actor,
      action: "update",
      entityType: "sessions",
      entityId: id,
      before: { ...existing, costLines: existingCostRows },
      after: { ...newRow, costLines: newCostRows },
    }),
    // LAST: KOK-028's own statements already end with planCostingReplay's, which must be the very
    // last thing in the whole batch (replay.ts's own ordering note) — nothing here depends on
    // ordering relative to them, so the whole block is appended as-is.
    ...allocationStatements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return { session: toSessionDto(newRow, newCostRows) };
}

/** Doc 03 S-1b: close one OPEN session and start its same-type replacement in one atomic batch.
 * This is the conflict-resolution action for the hard one-OPEN-per-type invariant. */
export async function closeAndStartSession(
  db: Db,
  command: CloseAndStartSessionCommand,
  actor: AuditActor,
): Promise<CloseAndStartSessionResult> {
  const { row: existing, costRows: existingCostRows } = await loadSessionForMutation(
    db,
    command.closeSessionId,
  );
  if (existing.status === "CLOSED") {
    throw validationError("La sesión que deseas cerrar ya está cerrada.", {
      id: command.closeSessionId,
    });
  }
  if (existing.type !== command.newSession.type) {
    throw validationError(
      `La sesión que se cierra es de tipo ${existing.type} pero la nueva sesión es de tipo ${command.newSession.type}.`,
      { closeType: existing.type, newType: command.newSession.type },
    );
  }

  const newCostLines = command.newSession.costLines ?? [];
  assertCostLinesValid(newCostLines);
  const accountIds = new Set(
    newCostLines
      .filter((line) => !line.isEstimate && line.accountId)
      .map((line) => line.accountId as string),
  );
  for (const accountId of accountIds) {
    await findActiveAccountRowOrThrow(db, accountId);
  }

  const now = nowIso();
  const durationResolvable =
    existing.durationMin !== null || (existing.startedAt !== null && existing.endedAt !== null);
  const closedRow: SessionRow = {
    ...existing,
    endedAt: durationResolvable ? existing.endedAt : (existing.endedAt ?? now),
    status: "CLOSED",
    updatedAt: now,
  };

  const newSessionId = generateUuidV7();
  const newRow: SessionRow = {
    id: newSessionId,
    type: command.newSession.type,
    businessDate: command.newSession.businessDate,
    startedAt: command.newSession.startedAt,
    endedAt: command.newSession.endedAt ?? null,
    durationMin: command.newSession.durationMin ?? null,
    status: "OPEN",
    notes: command.newSession.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const newCostRows: SessionCostRow[] = newCostLines.map((line) => ({
    id: generateUuidV7(),
    sessionId: newSessionId,
    label: line.label,
    amount: line.amount,
    isEstimate: line.isEstimate ? 1 : 0,
    accountId: line.accountId ?? null,
  }));
  const transactionInputs = newCostRows
    .map((row) => buildSessionCostTransactionInput(newRow, row.id, row))
    .filter((input): input is FinancialTransactionInput => input !== null);
  const balanceDeltas = new Map<string, number>();
  for (const input of transactionInputs) {
    balanceDeltas.set(input.accountId, (balanceDeltas.get(input.accountId) ?? 0) - input.amount);
  }

  const allocationStatements: Statement[] = [];
  if (closedRow.type === "PRODUCTION") {
    let totalSharedCost = 0;
    for (const row of existingCostRows) totalSharedCost += row.amount;
    const allocation = await planSessionCostAllocation(
      db,
      existing.id,
      totalSharedCost,
      closedRow.businessDate,
      sessionTransactionOccurredAt(closedRow),
      actor,
    );
    allocationStatements.push(...allocation.statements);
  }

  const statements: Statement[] = [
    db
      .update(sessions)
      .set({ endedAt: closedRow.endedAt, status: closedRow.status, updatedAt: closedRow.updatedAt })
      .where(eq(sessions.id, existing.id)),
    buildAuditLogInsert(db, {
      actor,
      action: "update",
      entityType: "sessions",
      entityId: existing.id,
      before: { ...existing, costLines: existingCostRows },
      after: { ...closedRow, costLines: existingCostRows },
    }),
    db.insert(sessions).values(newRow),
    ...newCostRows.map((row) => db.insert(sessionCosts).values(row)),
    ...transactionInputs.map((input) =>
      db.insert(financialTransactions).values({
        id: generateUuidV7(),
        occurredAt: input.occurredAt,
        businessDate: input.businessDate,
        accountId: input.accountId,
        type: input.type,
        category: input.category,
        amount: input.amount,
        counterpartTxId: null,
        sourceEventType: input.sourceEventType,
        sourceEventId: input.sourceEventId,
        description: input.description ?? null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    ),
    ...[...balanceDeltas.entries()].map(([accountId, delta]) =>
      buildAccountBalanceDelta(db, accountId, delta),
    ),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "sessions",
      entityId: newSessionId,
      before: null,
      after: { ...newRow, costLines: newCostRows },
    }),
    ...allocationStatements,
  ];

  await db.batch(statements as [Statement, ...Statement[]]);
  return {
    closedSession: toSessionDto(closedRow, existingCostRows),
    newSession: toSessionDto(newRow, newCostRows),
  };
}

/**
 * JUDGMENT CALL (Doc 03 §6 leaves this unspecified either way): a session with live (non-deleted)
 * linked events is NOT deletable. `purchases`/`production_runs`/`sales`/`stock_exits.session_id`
 * are all `ON DELETE restrict` against `sessions` (schema.ts), so this mirrors the DB's own stance
 * on the FK at the business-rule layer — the safer of the two options, since silently soft-deleting
 * a session out from under events that still point to it would leave the "linked events viewer"
 * (Doc 07 SC-09) pointing at a retired session with no way for the owner to have seen that coming.
 * Blocked with a 409 CONFLICT and a clear `message_es`; the owner unlinks or deletes those events
 * first (D-8's soft-delete already lets any of them be reassigned via edit).
 */
async function assertNoLiveLinkedEvents(db: Db, sessionId: string): Promise<void> {
  const [purchaseRow, productionRunRow, saleRow, stockExitRow] = await Promise.all([
    db.query.purchases.findFirst({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.sessionId, sessionId), isNullOp(t.deletedAt)),
    }),
    db.query.productionRuns.findFirst({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.sessionId, sessionId), isNullOp(t.deletedAt)),
    }),
    db.query.sales.findFirst({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.sessionId, sessionId), isNullOp(t.deletedAt)),
    }),
    db.query.stockExits.findFirst({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.sessionId, sessionId), isNullOp(t.deletedAt)),
    }),
  ]);
  if (purchaseRow || productionRunRow || saleRow || stockExitRow) {
    throw conflict(
      "No se puede eliminar la sesión: todavía tiene eventos vinculados activos. " +
        "Desvincula o elimina esos eventos primero.",
      { sessionId },
    );
  }
}

/**
 * UC-14 delete (D-8 soft delete): soft-deletes the session and reverses every non-estimate cost
 * line's `financial_transactions` row + account balance delta, in ONE atomic batch (D-3). Blocked
 * (409 CONFLICT) while any live event still references this session — see
 * `assertNoLiveLinkedEvents`'s doc comment for why.
 *
 * `session_costs` rows themselves survive untouched — the same R-3 precedent `purchase_lines`
 * follows across a purchase's soft delete, so the 10s "Deshacer" undo toast (Doc 06 principle 6)
 * can restore them exactly via `restoreSession`.
 */
export async function deleteSession(
  db: Db,
  id: string,
  _command: DeleteSessionCommand,
  actor: AuditActor,
): Promise<DeleteSessionResult> {
  const { row: existing, costRows } = await loadSessionForMutation(db, id);
  await assertNoLiveLinkedEvents(db, id);

  const now = nowIso();
  const newRow: SessionRow = { ...existing, deletedAt: now, updatedAt: now };

  const { statements: transactionStatements } =
    await buildSessionCostTransactionReplacementStatements(
      db,
      costRows.map((r) => r.id),
      [],
    );

  const statements: Statement[] = [
    db
      .update(sessions)
      .set({ deletedAt: newRow.deletedAt, updatedAt: newRow.updatedAt })
      .where(eq(sessions.id, id)),
    ...transactionStatements,
    buildAuditLogInsert(db, {
      actor,
      action: "delete",
      entityType: "sessions",
      entityId: id,
      before: { ...existing, costLines: costRows },
      after: { ...newRow, costLines: costRows },
    }),
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return { session: toSessionDto(newRow, costRows), deletedAt: now };
}

/** Loads a session and its cost lines for a restore, refusing one that is MISSING or already LIVE
 * (i.e. not currently soft-deleted) — the mirror image of `loadSessionForMutation`'s guard. */
async function loadSessionForRestore(
  db: Db,
  id: string,
): Promise<{ row: SessionRow; costRows: SessionCostRow[] }> {
  const row = await db.query.sessions.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNotNull }) =>
      andOp(eqOp(t.id, id), isNotNull(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la sesión eliminada.", { id });
  }
  const costRows = await db.query.sessionCosts.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.sessionId, id),
  });
  return { row, costRows };
}

/**
 * Server side of the "Deshacer" 10s-undo toast (Doc 06 principle 6): un-deletes a soft-deleted
 * session and recreates every non-estimate cost line's `financial_transactions` row + balance delta
 * that `deleteSession` reversed, in ONE atomic batch (D-3). `session_costs` rows were never touched
 * by the delete, so this reuses them unchanged — no re-validation of account activity (mirrors
 * `restorePurchase`, which likewise does not re-check `findActiveAccountRowOrThrow` on restore).
 */
export async function restoreSession(
  db: Db,
  id: string,
  _command: DeleteSessionCommand,
  actor: AuditActor,
): Promise<RestoreSessionResult> {
  const { row: existing, costRows } = await loadSessionForRestore(db, id);

  const now = nowIso();
  const newRow: SessionRow = { ...existing, deletedAt: null, updatedAt: now };

  const newTransactionInputs = costRows
    .map((row) => buildSessionCostTransactionInput(newRow, row.id, row))
    .filter((input): input is FinancialTransactionInput => input !== null);

  const { statements: transactionStatements } =
    await buildSessionCostTransactionReplacementStatements(db, [], newTransactionInputs);

  const statements: Statement[] = [
    db.update(sessions).set({ deletedAt: null, updatedAt: now }).where(eq(sessions.id, id)),
    ...transactionStatements,
    buildAuditLogInsert(db, {
      actor,
      action: "restore",
      entityType: "sessions",
      entityId: id,
      before: { ...existing, costLines: costRows },
      after: { ...newRow, costLines: costRows },
    }),
  ];

  await db.batch(statements as [Statement, ...Statement[]]);

  return { session: toSessionDto(newRow, costRows) };
}

/**
 * UC-14 read: a session, its cost lines, and the "linked events viewer" (Doc 07 SC-09) — the four
 * event tables' non-deleted rows referencing this session, each reduced to `(id, occurredAt,
 * businessDate, label)`. Kept as four flat lists (not a generic polymorphic type) per this task's
 * own scope note: simple is enough for a viewer that just needs to identify and link to each row.
 */
export async function getSession(db: Db, id: string): Promise<GetSessionResult> {
  const row = await db.query.sessions.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(t.id, id), isNullOp(t.deletedAt)),
  });
  if (!row) {
    throw notFound("No se encontró la sesión.", { id });
  }
  const costRows = await db.query.sessionCosts.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.sessionId, id),
  });

  const [purchaseRows, productionRunRows, saleRows, stockExitRows] = await Promise.all([
    db.query.purchases.findMany({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.sessionId, id), isNullOp(t.deletedAt)),
    }),
    db.query.productionRuns.findMany({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.sessionId, id), isNullOp(t.deletedAt)),
    }),
    db.query.sales.findMany({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.sessionId, id), isNullOp(t.deletedAt)),
    }),
    db.query.stockExits.findMany({
      where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
        andOp(eqOp(t.sessionId, id), isNullOp(t.deletedAt)),
    }),
  ]);

  const linkedEvents: SessionLinkedEventsDto = {
    purchases: purchaseRows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      businessDate: r.businessDate,
      label: r.supplierName ?? "Compra",
    })),
    productionRuns: productionRunRows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      businessDate: r.businessDate,
      label: "Producción",
    })),
    sales: saleRows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      businessDate: r.businessDate,
      label: r.channel === "CUSTOM_ORDER" ? "Venta (pedido)" : "Venta",
    })),
    stockExits: stockExitRows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      businessDate: r.businessDate,
      label: r.reason,
    })),
  };

  return { session: toSessionDto(row, costRows), linkedEvents };
}

/** Raw `v_session_hours` row shape (snake_case, exactly the view's SELECT list — Doc 04 §4),
 * mirroring core/inventory/waste.ts's identical technique for querying a view Drizzle's SQLite
 * dialect has no table binding for. */
interface SessionHoursViewRow {
  session_id: string;
  type: SessionRow["type"];
  business_date: string;
  status: SessionStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_min: number | null;
  linked_event_count: number;
}

/**
 * Read query for the sessions list (Doc 07 SC-09): `v_session_hours` (duration/linked-event count)
 * joined, in application code (two queries, not a raw SQL join — this task's own scope note), with
 * each session's cost-lines total (Σ `amount`, ALL lines including estimates — Doc 03 §6 does not
 * distinguish estimates for this display total, only for cash creation).
 */
export async function listSessions(
  db: Db,
  filters: ListSessionsFilters = {},
): Promise<ListSessionsResult> {
  const conditions: SQL[] = [];
  if (filters.type) conditions.push(sql`type = ${filters.type}`);
  if (filters.status) conditions.push(sql`status = ${filters.status}`);
  if (filters.fromDate) conditions.push(sql`business_date >= ${filters.fromDate}`);
  if (filters.toDate) conditions.push(sql`business_date <= ${filters.toDate}`);
  const limit = filters.limit ?? 200;

  const whereClause =
    conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

  const rows = await db.all<SessionHoursViewRow>(sql`
    SELECT * FROM v_session_hours
    ${whereClause}
    ORDER BY business_date DESC, started_at DESC
    LIMIT ${limit}
  `);

  const sessionIds = rows.map((r) => r.session_id);
  const costRows =
    sessionIds.length > 0
      ? await db.query.sessionCosts.findMany({
          where: (t, { inArray: inArrayOp }) => inArrayOp(t.sessionId, sessionIds),
        })
      : [];
  const costsBySession = new Map<string, number>();
  for (const row of costRows) {
    costsBySession.set(row.sessionId, (costsBySession.get(row.sessionId) ?? 0) + row.amount);
  }

  return {
    sessions: rows.map((row) => ({
      id: row.session_id,
      type: row.type,
      businessDate: row.business_date,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMin: row.duration_min,
      linkedEventCount: row.linked_event_count,
      costsTotal: costsBySession.get(row.session_id) ?? 0,
    })),
  };
}

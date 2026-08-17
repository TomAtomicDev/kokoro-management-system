import type {
  AssemblyDto,
  AssemblyImpactRequest,
  AssemblyLineDto,
  AuditActor,
  DeleteAssemblyCommand,
  DeleteAssemblyResult,
  GetAssemblyResult,
  ListAssembliesFilters,
  ListAssembliesResult,
  MilliCentavosPerUnit,
  RecordAssemblyCommand,
  RecordAssemblyResult,
  ReplayImpactDto,
  UpdateAssemblyCommand,
  UpdateAssemblyResult,
} from "@kokoro/shared";
import {
  generateUuidV7,
  nowIso,
  REPLAY_CONFIRMATION_REQUIRED,
  rateFromTotal,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
} from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import {
  assemblies,
  assemblyConsumptions,
  type assemblyDefinitions,
  items,
} from "../../db/schema.js";
import { validateAssemblyItemKinds } from "../assemblies/index.js";
import { buildAuditLogInsert } from "../audit.js";
import { getCurrentWac } from "../costing/repair.js";
import type { CostingReplayPlan } from "../costing/replay.js";
import { planCostingReplay } from "../costing/replay.js";
import type { ReplayMovement } from "../costing/wac.js";
import { applyWacEntry, replayWacFrom, snapshotUnitCost } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
import {
  buildReplaceMovementsForSourceStatements,
  buildStockMovementStatements,
} from "../inventory/movements.js";
import type { StockMovementInput } from "../inventory/types.js";
import { assertOrderLinkable } from "../orders/index.js";
import { resolveSessionForEvent } from "../sessions/index.js";
import { computeAssemblyCost } from "./cost.js";

type Statement = BatchItem<"sqlite">;
type AssemblyRow = typeof assemblies.$inferSelect;
type AssemblyConsumptionRow = typeof assemblyConsumptions.$inferSelect;
type AssemblyDefinitionRow = typeof assemblyDefinitions.$inferSelect;

function toAssemblyDto(
  row: AssemblyRow,
  consumptionRows: readonly AssemblyConsumptionRow[],
): AssemblyDto {
  const lines: AssemblyLineDto[] = consumptionRows.map((consumption) => ({
    id: consumption.id,
    itemId: consumption.itemId,
    qty: consumption.qty,
    unitCostSnapshotMc: consumption.unitCostSnapshotMc,
  }));
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    businessDate: row.businessDate,
    definitionId: row.definitionId,
    sessionId: row.sessionId,
    customOrderId: row.customOrderId,
    outputItemId: row.outputItemId,
    plannedOutputQty: row.plannedOutputQty,
    actualOutputQty: row.actualOutputQty,
    directCost: row.directCost,
    outputUnitCostMc: rateFromTotal(toCentavos(row.directCost), toMilliUnits(row.actualOutputQty)),
    notes: row.notes,
    lines,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function validateDefinition(
  db: Db,
  definitionId: string | undefined,
  outputItemId: string,
): Promise<AssemblyDefinitionRow | undefined> {
  if (definitionId === undefined) return undefined;
  const definition = await db.query.assemblyDefinitions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, definitionId),
  });
  if (definition?.isActive !== 1) {
    throw notFound("No se encontró una definición de armado activa.", { definitionId });
  }
  if (definition.outputItemId !== outputItemId) {
    throw validationError("La definición no coincide con el ítem de salida indicado.", {
      definitionId,
      definitionOutputItemId: definition.outputItemId,
      outputItemId,
    });
  }
  return definition;
}

function buildAssemblyMovementsFromConsumptions(
  assemblyId: string,
  consumptions: readonly AssemblyConsumptionRow[],
  outputItemId: string,
  actualOutputQty: number,
  outputUnitCostMc: MilliCentavosPerUnit,
  occurredAt: string,
  businessDate: string,
): StockMovementInput[] {
  const movements: StockMovementInput[] = consumptions.map((consumption) => ({
    itemId: consumption.itemId,
    occurredAt,
    businessDate,
    type: "ASSEMBLY_OUT",
    qty: -consumption.qty,
    unitCostMc: toMilliCentavosPerUnit(consumption.unitCostSnapshotMc),
    sourceEventType: "assembly",
    sourceEventId: assemblyId,
  }));
  movements.push({
    itemId: outputItemId,
    occurredAt,
    businessDate,
    type: "ASSEMBLY_IN",
    qty: actualOutputQty,
    unitCostMc: outputUnitCostMc,
    sourceEventType: "assembly",
    sourceEventId: assemblyId,
  });
  return movements;
}

async function buildAssemblyCreateInputs(
  db: Db,
  command: RecordAssemblyCommand,
): Promise<{
  assemblyId: string;
  now: string;
  movements: StockMovementInput[];
  consumptionRows: AssemblyConsumptionRow[];
  newOutputWacMc: MilliCentavosPerUnit;
  assemblyRow: AssemblyRow;
  sessionStatements: Statement[];
}> {
  if (command.customOrderId) await assertOrderLinkable(db, command.customOrderId);
  if (command.lines.length === 0) {
    throw validationError("Se requiere al menos un componente consumido.", {});
  }
  await validateDefinition(db, command.definitionId, command.outputItemId);
  const resolvedSession = await resolveSessionForEvent(db, {
    type: "PRODUCTION",
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    explicitSessionId: command.sessionId ?? null,
  });
  await validateAssemblyItemKinds(db, command.outputItemId, command.lines);

  const assemblyId = generateUuidV7();
  const now = nowIso();
  const consumptionRows: AssemblyConsumptionRow[] = [];
  for (const line of command.lines) {
    const unitCostSnapshotMc = snapshotUnitCost(await getCurrentWac(db, line.itemId));
    consumptionRows.push({
      id: generateUuidV7(),
      assemblyId,
      itemId: line.itemId,
      qty: line.qty,
      unitCostSnapshotMc,
    });
  }

  const { directCost, outputUnitCostMc } = computeAssemblyCost(
    consumptionRows.map((consumption) => ({
      qty: consumption.qty,
      unitCostSnapshotMc: toMilliCentavosPerUnit(consumption.unitCostSnapshotMc),
    })),
    command.actualOutputQty,
  );

  const outputItem = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.outputItemId),
  });
  if (!outputItem) {
    throw notFound("No se encontró el ítem de salida.", { id: command.outputItemId });
  }
  const outputStock = await db.query.itemStock.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, command.outputItemId),
  });
  const newOutputWacMc = applyWacEntry(
    toMilliCentavosPerUnit(outputItem.wacMc),
    outputStock?.qtyOnHand ?? 0,
    command.actualOutputQty,
    outputUnitCostMc,
  );

  const movements = buildAssemblyMovementsFromConsumptions(
    assemblyId,
    consumptionRows,
    command.outputItemId,
    command.actualOutputQty,
    outputUnitCostMc,
    command.occurredAt,
    command.businessDate,
  );
  const assemblyRow: AssemblyRow = {
    id: assemblyId,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    definitionId: command.definitionId ?? null,
    sessionId: resolvedSession.sessionId,
    customOrderId: command.customOrderId ?? null,
    outputItemId: command.outputItemId,
    plannedOutputQty: command.plannedOutputQty ?? null,
    actualOutputQty: command.actualOutputQty,
    directCost,
    notes: command.notes ?? null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return {
    assemblyId,
    now,
    movements,
    consumptionRows,
    newOutputWacMc,
    assemblyRow,
    sessionStatements: resolvedSession.statements,
  };
}

export async function recordAssembly(
  db: Db,
  command: RecordAssemblyCommand,
  actor: AuditActor,
): Promise<RecordAssemblyResult> {
  const built = await buildAssemblyCreateInputs(db, command);
  const plan = await planCostingReplay(db, {
    trigger: {
      eventType: "assembly",
      eventId: built.assemblyId,
      businessDate: command.businessDate,
      occurredAt: command.occurredAt,
    },
    changes: [
      {
        sourceEventType: "assembly",
        sourceEventId: built.assemblyId,
        newMovements: built.movements,
      },
    ],
    actor,
  });
  if (plan.confirmationRequired && command.confirm !== true) {
    throw conflict(
      "Este armado tiene fecha anterior a movimientos ya registrados y cambia costos ya calculados. Revisa el impacto y confirma para guardarlo.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: plan.impact },
    );
  }

  const { statements: movementStatements } = buildStockMovementStatements(db, built.movements);
  const replayOwnedItemIds = new Set(plan.replayedItemIds);
  const itemUpdateStatements: Statement[] = replayOwnedItemIds.has(built.assemblyRow.outputItemId)
    ? []
    : [
        db
          .update(items)
          .set({ wacMc: built.newOutputWacMc, updatedAt: built.now })
          .where(eq(items.id, built.assemblyRow.outputItemId)),
      ];
  const statements: Statement[] = [
    ...built.sessionStatements,
    db.insert(assemblies).values(built.assemblyRow),
    ...built.consumptionRows.map((row) => db.insert(assemblyConsumptions).values(row)),
    ...movementStatements,
    ...itemUpdateStatements,
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "assembly",
      entityId: built.assemblyId,
      before: null,
      after: { ...built.assemblyRow, lines: built.consumptionRows },
    }),
    ...plan.statements,
  ];
  await db.batch(statements as [Statement, ...Statement[]]);
  return { assembly: toAssemblyDto(built.assemblyRow, built.consumptionRows) };
}

interface ProjectedKardexRow extends ReplayMovement {
  occurredAt: string;
  createdAt: string;
}

function compareKardexRows(a: ProjectedKardexRow, b: ProjectedKardexRow): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}

async function computeProjectedOutputWac(
  db: Db,
  itemId: string,
  assemblyId: string,
  newMovements: readonly StockMovementInput[],
  pendingCreatedAt: string,
): Promise<MilliCentavosPerUnit> {
  const existingRows = await db.query.stockMovements.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.itemId, itemId),
  });
  const projected: ProjectedKardexRow[] = existingRows
    .filter((row) => !(row.sourceEventType === "assembly" && row.sourceEventId === assemblyId))
    .map((row) => ({
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      type: row.type,
      qty: row.qty,
      unitCostMc: toMilliCentavosPerUnit(row.unitCostMc),
    }));
  for (const movement of newMovements) {
    if (movement.itemId !== itemId) continue;
    projected.push({
      occurredAt: movement.occurredAt,
      createdAt: pendingCreatedAt,
      type: movement.type,
      qty: movement.qty,
      unitCostMc: movement.unitCostMc,
    });
  }
  projected.sort(compareKardexRows);
  return replayWacFrom({ onHand: 0, wac: toMilliCentavosPerUnit(0) }, projected).wac;
}

function movementKey(movement: {
  itemId: string;
  occurredAt: string;
  businessDate: string;
  type: string;
  qty: number;
  unitCostMc: number;
}): string {
  return [
    movement.itemId,
    movement.occurredAt,
    movement.businessDate,
    movement.type,
    movement.qty,
    movement.unitCostMc,
  ].join("|");
}

function movementSetsEqual(
  existingRows: readonly {
    itemId: string;
    occurredAt: string;
    businessDate: string;
    type: string;
    qty: number;
    unitCostMc: number;
  }[],
  newMovements: readonly StockMovementInput[],
): boolean {
  if (existingRows.length !== newMovements.length) return false;
  const existingKeys = existingRows.map(movementKey).sort();
  const newKeys = newMovements.map(movementKey).sort();
  return existingKeys.every((key, index) => key === newKeys[index]);
}

const NO_KARDEX_CHANGE_PLAN: CostingReplayPlan = {
  required: false,
  impact: {
    affectedSaleLineIds: [],
    affectedStockExitIds: [],
    affectedProductionRunIds: [],
    affectedAssemblyIds: [],
    affectedItemIds: [],
    costDelta: 0,
    requiresConfirmation: false,
  },
  replayedItemIds: [],
  confirmationRequired: false,
  statements: [],
};

interface AssemblyMutationPlan {
  action: "update" | "delete" | "restore";
  existing: AssemblyRow;
  existingConsumptions: readonly AssemblyConsumptionRow[];
  newRow: AssemblyRow;
  newConsumptions: readonly AssemblyConsumptionRow[];
  newMovements: StockMovementInput[];
  confirm: boolean;
  actor: AuditActor;
  sessionStatements?: readonly Statement[];
}

async function planAssemblyMutationCostingImpact(
  db: Db,
  assemblyId: string,
  newRow: Pick<AssemblyRow, "businessDate" | "occurredAt">,
  newMovements: readonly StockMovementInput[],
  actor: AuditActor,
): Promise<{ kardexUnchanged: boolean; costingPlan: CostingReplayPlan }> {
  const existingMovementRows = await db.query.stockMovements.findMany({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.sourceEventType, "assembly"), eqOp(t.sourceEventId, assemblyId)),
  });
  const kardexUnchanged = movementSetsEqual(existingMovementRows, newMovements);
  const costingPlan = kardexUnchanged
    ? NO_KARDEX_CHANGE_PLAN
    : await planCostingReplay(db, {
        trigger: {
          eventType: "assembly",
          eventId: assemblyId,
          businessDate: newRow.businessDate,
          occurredAt: newRow.occurredAt,
        },
        changes: [
          {
            sourceEventType: "assembly",
            sourceEventId: assemblyId,
            newMovements: [...newMovements],
          },
        ],
        actor,
      });
  return { kardexUnchanged, costingPlan };
}

async function commitAssemblyMutation(db: Db, plan: AssemblyMutationPlan): Promise<void> {
  const { existing, newRow, newMovements } = plan;
  const assemblyId = existing.id;
  const { kardexUnchanged, costingPlan } = await planAssemblyMutationCostingImpact(
    db,
    assemblyId,
    newRow,
    newMovements,
    plan.actor,
  );
  if (costingPlan.confirmationRequired && plan.confirm !== true) {
    throw conflict(
      plan.action === "delete"
        ? "Eliminar este armado cambia costos ya calculados de ventas, salidas, producciones u otros armados registrados. Revisa el impacto y confirma para eliminarlo."
        : plan.action === "restore"
          ? "Restaurar este armado cambia costos ya calculados de ventas, salidas, producciones u otros armados registrados. Revisa el impacto y confirma para restaurarlo."
          : "Esta edición cambia costos ya calculados de ventas, salidas, producciones u otros armados registrados. Revisa el impacto y confirma para guardarla.",
      { reason: REPLAY_CONFIRMATION_REQUIRED, impact: costingPlan.impact },
    );
  }

  const movementStatements = kardexUnchanged
    ? []
    : (
        await buildReplaceMovementsForSourceStatements(db, "assembly", assemblyId, [
          ...newMovements,
        ])
      ).statements;
  const replayOwnedItemIds = new Set(costingPlan.replayedItemIds);
  const pendingCreatedAt = nowIso();
  const touchedItemIds = kardexUnchanged
    ? new Set<string>()
    : new Set<string>([existing.outputItemId, newRow.outputItemId]);
  const itemUpdateStatements: Statement[] = [];
  for (const itemId of touchedItemIds) {
    if (replayOwnedItemIds.has(itemId)) continue;
    const wacMc = await computeProjectedOutputWac(
      db,
      itemId,
      assemblyId,
      newMovements,
      pendingCreatedAt,
    );
    itemUpdateStatements.push(
      db.update(items).set({ wacMc, updatedAt: newRow.updatedAt }).where(eq(items.id, itemId)),
    );
  }

  const statements: Statement[] = [
    ...(plan.sessionStatements ?? []),
    db
      .update(assemblies)
      .set({
        occurredAt: newRow.occurredAt,
        businessDate: newRow.businessDate,
        definitionId: newRow.definitionId,
        sessionId: newRow.sessionId,
        customOrderId: newRow.customOrderId,
        outputItemId: newRow.outputItemId,
        plannedOutputQty: newRow.plannedOutputQty,
        actualOutputQty: newRow.actualOutputQty,
        directCost: newRow.directCost,
        notes: newRow.notes,
        deletedAt: newRow.deletedAt,
        updatedAt: newRow.updatedAt,
      })
      .where(eq(assemblies.id, assemblyId)),
    ...(plan.action === "update"
      ? [
          db.delete(assemblyConsumptions).where(eq(assemblyConsumptions.assemblyId, assemblyId)),
          ...plan.newConsumptions.map((row) => db.insert(assemblyConsumptions).values(row)),
        ]
      : []),
    ...movementStatements,
    ...itemUpdateStatements,
    buildAuditLogInsert(db, {
      actor: plan.actor,
      action: plan.action,
      entityType: "assembly",
      entityId: assemblyId,
      before: { ...existing, lines: plan.existingConsumptions },
      after: { ...newRow, lines: plan.newConsumptions },
    }),
    ...costingPlan.statements,
  ];
  await db.batch(statements as [Statement, ...Statement[]]);
}

async function loadAssemblyForMutation(
  db: Db,
  id: string,
): Promise<{ row: AssemblyRow; consumptions: AssemblyConsumptionRow[] }> {
  const row = await db.query.assemblies.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(t.id, id), isNullOp(t.deletedAt)),
  });
  if (!row) throw notFound("No se encontró el armado.", { id });
  const consumptions = await db.query.assemblyConsumptions.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.assemblyId, id),
  });
  return { row, consumptions };
}

async function buildAssemblyUpdateInputs(
  db: Db,
  id: string,
  command: UpdateAssemblyCommand,
): Promise<{
  existing: AssemblyRow;
  existingConsumptions: AssemblyConsumptionRow[];
  newRow: AssemblyRow;
  newConsumptions: AssemblyConsumptionRow[];
  newMovements: StockMovementInput[];
  sessionStatements: Statement[];
}> {
  if (command.lines.length === 0) {
    throw validationError("Se requiere al menos un componente consumido.", {});
  }
  const { row: existing, consumptions: existingConsumptions } = await loadAssemblyForMutation(
    db,
    id,
  );
  // KOK-137: only validate when the link is actually CHANGING — see the identical rationale in
  // core/production/index.ts's buildProductionRunUpdateInputs.
  // `undefined` means leave the existing link unchanged; `null` explicitly unlinks it.
  if (
    typeof command.customOrderId === "string" &&
    command.customOrderId !== existing.customOrderId
  ) {
    await assertOrderLinkable(db, command.customOrderId);
  }
  await validateDefinition(db, command.definitionId, command.outputItemId);
  const resolvedSession = await resolveSessionForEvent(db, {
    type: "PRODUCTION",
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    explicitSessionId: command.sessionId ?? null,
  });
  await validateAssemblyItemKinds(db, command.outputItemId, command.lines);
  const now = nowIso();

  // unit_cost_snapshot-on-edit policy: a line whose item MATCHES an existing consumption line
  // (matched by itemId, first-available-first-matched) keeps that line's FROZEN
  // unitCostSnapshotMc regardless of a qty/date change — R-4's spirit arriving through the edit
  // door. A line for an item that was not in the assembly before (or an extra occurrence beyond
  // what already existed) snapshots fresh at that item's CURRENT WAC (C-10); there is no old
  // snapshot to preserve for it.
  const unmatchedExisting = [...existingConsumptions];
  const newConsumptions: AssemblyConsumptionRow[] = [];
  for (const line of command.lines) {
    const matchIndex = unmatchedExisting.findIndex(
      (consumption) => consumption.itemId === line.itemId,
    );
    let unitCostSnapshotMc: MilliCentavosPerUnit;
    if (matchIndex >= 0) {
      const [matched] = unmatchedExisting.splice(matchIndex, 1);
      unitCostSnapshotMc =
        matched === undefined
          ? snapshotUnitCost(await getCurrentWac(db, line.itemId))
          : toMilliCentavosPerUnit(matched.unitCostSnapshotMc);
    } else {
      unitCostSnapshotMc = snapshotUnitCost(await getCurrentWac(db, line.itemId));
    }
    newConsumptions.push({
      id: generateUuidV7(),
      assemblyId: id,
      itemId: line.itemId,
      qty: line.qty,
      unitCostSnapshotMc,
    });
  }

  const { directCost, outputUnitCostMc } = computeAssemblyCost(
    newConsumptions.map((consumption) => ({
      qty: consumption.qty,
      unitCostSnapshotMc: toMilliCentavosPerUnit(consumption.unitCostSnapshotMc),
    })),
    command.actualOutputQty,
  );
  const newRow: AssemblyRow = {
    ...existing,
    occurredAt: command.occurredAt,
    businessDate: command.businessDate,
    definitionId: command.definitionId ?? null,
    sessionId: resolvedSession.sessionId,
    customOrderId:
      command.customOrderId === undefined ? existing.customOrderId : command.customOrderId,
    outputItemId: command.outputItemId,
    plannedOutputQty: command.plannedOutputQty ?? null,
    actualOutputQty: command.actualOutputQty,
    directCost,
    notes: command.notes ?? null,
    deletedAt: null,
    updatedAt: now,
  };
  const newMovements = buildAssemblyMovementsFromConsumptions(
    id,
    newConsumptions,
    newRow.outputItemId,
    newRow.actualOutputQty,
    outputUnitCostMc,
    newRow.occurredAt,
    newRow.businessDate,
  );
  return {
    existing,
    existingConsumptions,
    newRow,
    newConsumptions,
    newMovements,
    sessionStatements: resolvedSession.statements,
  };
}

async function buildAssemblyDeleteInputs(
  db: Db,
  id: string,
): Promise<{
  existing: AssemblyRow;
  existingConsumptions: AssemblyConsumptionRow[];
  newRow: AssemblyRow;
}> {
  const { row: existing, consumptions: existingConsumptions } = await loadAssemblyForMutation(
    db,
    id,
  );
  const now = nowIso();
  return {
    existing,
    existingConsumptions,
    newRow: { ...existing, deletedAt: now, updatedAt: now },
  };
}

export async function updateAssembly(
  db: Db,
  id: string,
  command: UpdateAssemblyCommand,
  actor: AuditActor,
): Promise<UpdateAssemblyResult> {
  const {
    existing,
    existingConsumptions,
    newRow,
    newConsumptions,
    newMovements,
    sessionStatements,
  } = await buildAssemblyUpdateInputs(db, id, command);
  await commitAssemblyMutation(db, {
    action: "update",
    existing,
    existingConsumptions,
    newRow,
    newConsumptions,
    newMovements,
    sessionStatements,
    confirm: command.confirm === true,
    actor,
  });
  return { assembly: toAssemblyDto(newRow, newConsumptions) };
}

export async function deleteAssembly(
  db: Db,
  id: string,
  command: DeleteAssemblyCommand,
  actor: AuditActor,
): Promise<DeleteAssemblyResult> {
  const { existing, existingConsumptions, newRow } = await buildAssemblyDeleteInputs(db, id);
  await commitAssemblyMutation(db, {
    action: "delete",
    existing,
    existingConsumptions,
    newRow,
    newConsumptions: existingConsumptions,
    newMovements: [],
    confirm: command.confirm === true,
    actor,
  });
  return {
    assembly: toAssemblyDto(newRow, existingConsumptions),
    deletedAt: newRow.deletedAt as string,
  };
}

async function loadAssemblyForRestore(
  db: Db,
  id: string,
): Promise<{ row: AssemblyRow; consumptions: AssemblyConsumptionRow[] }> {
  const row = await db.query.assemblies.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNotNull }) =>
      andOp(eqOp(t.id, id), isNotNull(t.deletedAt)),
  });
  if (!row) throw notFound("No se encontró el armado eliminado.", { id });
  const consumptions = await db.query.assemblyConsumptions.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.assemblyId, id),
  });
  return { row, consumptions };
}

export async function restoreAssembly(
  db: Db,
  id: string,
  command: DeleteAssemblyCommand,
  actor: AuditActor,
): Promise<UpdateAssemblyResult> {
  const { row: existing, consumptions: existingConsumptions } = await loadAssemblyForRestore(
    db,
    id,
  );
  const newRow: AssemblyRow = { ...existing, deletedAt: null, updatedAt: nowIso() };
  const outputUnitCostMc = rateFromTotal(
    toCentavos(existing.directCost),
    toMilliUnits(existing.actualOutputQty),
  );
  const newMovements = buildAssemblyMovementsFromConsumptions(
    id,
    existingConsumptions,
    existing.outputItemId,
    existing.actualOutputQty,
    outputUnitCostMc,
    existing.occurredAt,
    existing.businessDate,
  );
  await commitAssemblyMutation(db, {
    action: "restore",
    existing,
    existingConsumptions,
    newRow,
    newConsumptions: existingConsumptions,
    newMovements,
    confirm: command.confirm === true,
    actor,
  });
  return { assembly: toAssemblyDto(newRow, existingConsumptions) };
}

export async function getAssembly(db: Db, id: string): Promise<GetAssemblyResult> {
  const row = await db.query.assemblies.findFirst({
    where: (t, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(t.id, id), isNullOp(t.deletedAt)),
  });
  if (!row) throw notFound("No se encontró el armado.", { id });
  const consumptionRows = await db.query.assemblyConsumptions.findMany({
    where: (t, { eq: eqOp }) => eqOp(t.assemblyId, id),
  });
  return { assembly: toAssemblyDto(row, consumptionRows) };
}

export async function listAssemblies(
  db: Db,
  filters: ListAssembliesFilters = {},
): Promise<ListAssembliesResult> {
  const rows = await db.query.assemblies.findMany({
    where: (t, { and: andOp, eq: eqOp, gte: gteOp, lte: lteOp, isNull: isNullOp }) => {
      const conditions = [isNullOp(t.deletedAt)];
      if (filters.outputItemId) conditions.push(eqOp(t.outputItemId, filters.outputItemId));
      if (filters.customOrderId) conditions.push(eqOp(t.customOrderId, filters.customOrderId));
      if (filters.fromDate) conditions.push(gteOp(t.businessDate, filters.fromDate));
      if (filters.toDate) conditions.push(lteOp(t.businessDate, filters.toDate));
      return andOp(...conditions);
    },
    orderBy: (t, { desc }) => [desc(t.businessDate), desc(t.createdAt)],
    limit: filters.limit ?? 200,
  });
  const ids = rows.map((row) => row.id);
  const consumptions =
    ids.length > 0
      ? await db.query.assemblyConsumptions.findMany({
          where: (t, { inArray }) => inArray(t.assemblyId, ids),
        })
      : [];
  const byAssembly = new Map<string, AssemblyConsumptionRow[]>();
  for (const consumption of consumptions) {
    const current = byAssembly.get(consumption.assemblyId) ?? [];
    current.push(consumption);
    byAssembly.set(consumption.assemblyId, current);
  }
  return {
    assemblies: rows.map((row) => toAssemblyDto(row, byAssembly.get(row.id) ?? [])),
  };
}

const PREVIEW_ACTOR: AuditActor = "SYSTEM";

export async function previewAssemblyImpact(
  db: Db,
  request: AssemblyImpactRequest,
): Promise<ReplayImpactDto> {
  if (request.op === "create") {
    const built = await buildAssemblyCreateInputs(db, request.command);
    const plan = await planCostingReplay(db, {
      trigger: {
        eventType: "assembly",
        eventId: built.assemblyId,
        businessDate: request.command.businessDate,
        occurredAt: request.command.occurredAt,
      },
      changes: [
        {
          sourceEventType: "assembly",
          sourceEventId: built.assemblyId,
          newMovements: built.movements,
        },
      ],
      actor: PREVIEW_ACTOR,
    });
    return plan.impact;
  }
  if (request.op === "update") {
    const { newRow, newMovements } = await buildAssemblyUpdateInputs(
      db,
      request.id,
      request.command,
    );
    const { costingPlan } = await planAssemblyMutationCostingImpact(
      db,
      request.id,
      newRow,
      newMovements,
      PREVIEW_ACTOR,
    );
    return costingPlan.impact;
  }
  const { newRow } = await buildAssemblyDeleteInputs(db, request.id);
  const { costingPlan } = await planAssemblyMutationCostingImpact(
    db,
    request.id,
    newRow,
    [],
    PREVIEW_ACTOR,
  );
  return costingPlan.impact;
}

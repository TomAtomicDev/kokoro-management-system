import type {
  AuditActor,
  GetAssemblyDefinitionResult,
  ListAssemblyDefinitionsFilters,
  ListAssemblyDefinitionsResult,
  RecordAssemblyDefinitionCommand,
  RecordAssemblyDefinitionResult,
  SetAssemblyDefinitionActiveCommand,
  SetAssemblyDefinitionActiveResult,
  UpdateAssemblyDefinitionCommand,
  UpdateAssemblyDefinitionResult,
} from "@kokoro/shared";
import { generateUuidV7, nowIso } from "@kokoro/shared";
import { and, eq, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { assemblyDefinitionLines, assemblyDefinitions } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { conflict, notFound, validationError } from "../errors.js";
import { wouldCreateAssemblyCycle } from "./cycle-check.js";
import {
  fetchAssemblyDefinitionLines,
  getAssemblyDefinitionSettingsDto,
  toAssemblyDefinitionDto,
} from "./dto.js";

type Statement = BatchItem<"sqlite">;
type AssemblyDefinitionRow = typeof assemblyDefinitions.$inferSelect;
type AssemblyDefinitionLineRow = typeof assemblyDefinitionLines.$inferSelect;

export async function validateAssemblyItemKinds(
  db: Db,
  outputItemId: string,
  lines: readonly { itemId: string }[],
): Promise<void> {
  const outputItem = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, outputItemId),
  });
  if (!outputItem) {
    throw notFound("No se encontró el ítem de salida.", { id: outputItemId });
  }
  if (outputItem.kind !== "FINISHED" || outputItem.unit !== "UNIT") {
    throw validationError(
      "El ítem de salida debe ser un producto terminado con unidad de medida UNIT.",
      { outputItemId, kind: outputItem.kind, unit: outputItem.unit },
    );
  }

  for (const line of lines) {
    const item = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, line.itemId),
    });
    if (!item) {
      throw notFound("No se encontró el ítem de la línea de definición.", { id: line.itemId });
    }
    if (item.kind !== "SEMI_FINISHED" && item.kind !== "FINISHED" && item.kind !== "PACKAGING") {
      throw validationError(
        "Un componente de definición debe ser un semielaborado, producto terminado o empaque.",
        { itemId: line.itemId, kind: item.kind },
      );
    }
  }
}

async function loadComponentsByOutput(db: Db): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      outputItemId: assemblyDefinitions.outputItemId,
      itemId: assemblyDefinitionLines.itemId,
    })
    .from(assemblyDefinitions)
    .innerJoin(
      assemblyDefinitionLines,
      eq(assemblyDefinitionLines.definitionId, assemblyDefinitions.id),
    )
    .where(eq(assemblyDefinitions.isActive, 1));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.outputItemId);
    if (existing) {
      if (!existing.includes(row.itemId)) existing.push(row.itemId);
    } else {
      map.set(row.outputItemId, [row.itemId]);
    }
  }
  return map;
}

function assertNoAssemblyCycle(
  componentsByOutput: ReadonlyMap<string, readonly string[]>,
  outputItemId: string,
  lines: readonly { itemId: string }[],
): void {
  const candidateComponentItemIds = lines.map((line) => line.itemId);
  if (wouldCreateAssemblyCycle(componentsByOutput, outputItemId, candidateComponentItemIds)) {
    throw conflict(
      "Esta definición formaría un ciclo: un componente terminaría conteniéndose a sí mismo, directa o indirectamente. Corrige las definiciones antes de guardar.",
      { outputItemId, candidateComponentItemIds },
    );
  }
}

async function findActiveAssemblyDefinitionRowByName(
  db: Db,
  name: string,
  excludeId?: string,
): Promise<AssemblyDefinitionRow | undefined> {
  return db.query.assemblyDefinitions.findFirst({
    where: (t, { and, eq: eqOp, ne }) => {
      const base = and(eqOp(t.name, name), eqOp(t.isActive, 1));
      return excludeId ? and(base, ne(t.id, excludeId)) : base;
    },
  });
}

function buildClearOtherDefaultsStatement(
  db: Db,
  outputItemId: string,
  excludeDefinitionId: string,
  now: string,
): Statement {
  return db
    .update(assemblyDefinitions)
    .set({ isDefault: 0, updatedAt: now })
    .where(
      and(
        eq(assemblyDefinitions.outputItemId, outputItemId),
        eq(assemblyDefinitions.isDefault, 1),
        eq(assemblyDefinitions.isActive, 1),
        ne(assemblyDefinitions.id, excludeDefinitionId),
      ),
    );
}

export async function recordAssemblyDefinition(
  db: Db,
  command: RecordAssemblyDefinitionCommand,
  actor: AuditActor,
): Promise<RecordAssemblyDefinitionResult> {
  await validateAssemblyItemKinds(db, command.outputItemId, command.lines);
  assertNoAssemblyCycle(await loadComponentsByOutput(db), command.outputItemId, command.lines);
  const duplicate = await findActiveAssemblyDefinitionRowByName(db, command.name);
  if (duplicate) {
    throw conflict(`Ya existe una definición activa llamada "${command.name}".`, { field: "name" });
  }

  const now = nowIso();
  const definitionId = generateUuidV7();
  const row: AssemblyDefinitionRow = {
    id: definitionId,
    name: command.name,
    outputItemId: command.outputItemId,
    outputQty: command.outputQty,
    isDefault: command.isDefault ? 1 : 0,
    isActive: 1,
    notes: command.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const lineRows: AssemblyDefinitionLineRow[] = command.lines.map((line) => ({
    id: generateUuidV7(),
    definitionId,
    itemId: line.itemId,
    qty: line.qty,
  }));

  const statements: Statement[] = [
    ...(command.isDefault
      ? [buildClearOtherDefaultsStatement(db, command.outputItemId, definitionId, now)]
      : []),
    db.insert(assemblyDefinitions).values(row),
    ...lineRows.map((line) => db.insert(assemblyDefinitionLines).values(line)),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "assembly_definition",
      entityId: definitionId,
      before: null,
      after: { ...row, lines: lineRows },
    }),
  ];
  await db.batch(statements as [Statement, ...Statement[]]);

  const assemblyDefinition = await toAssemblyDefinitionDto(db, row, lineRows);
  const settings = await getAssemblyDefinitionSettingsDto(db);
  return { assemblyDefinition, settings };
}

export async function updateAssemblyDefinition(
  db: Db,
  id: string,
  command: UpdateAssemblyDefinitionCommand,
  actor: AuditActor,
): Promise<UpdateAssemblyDefinitionResult> {
  const existingRow = await db.query.assemblyDefinitions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!existingRow) throw notFound("No se encontró la definición de armado.", { id });
  const existingLines = await fetchAssemblyDefinitionLines(db, id);

  await validateAssemblyItemKinds(db, command.outputItemId, command.lines);
  assertNoAssemblyCycle(await loadComponentsByOutput(db), command.outputItemId, command.lines);
  const duplicate = await findActiveAssemblyDefinitionRowByName(db, command.name, id);
  if (duplicate) {
    throw conflict(`Ya existe una definición activa llamada "${command.name}".`, { field: "name" });
  }

  const now = nowIso();
  const updatedRow: AssemblyDefinitionRow = {
    ...existingRow,
    name: command.name,
    outputItemId: command.outputItemId,
    outputQty: command.outputQty,
    isDefault: command.isDefault ? 1 : 0,
    notes: command.notes ?? null,
    updatedAt: now,
  };
  const newLineRows: AssemblyDefinitionLineRow[] = command.lines.map((line) => ({
    id: generateUuidV7(),
    definitionId: id,
    itemId: line.itemId,
    qty: line.qty,
  }));
  const willBeActiveDefault = command.isDefault && updatedRow.isActive === 1;

  const statements: Statement[] = [
    ...(willBeActiveDefault
      ? [buildClearOtherDefaultsStatement(db, command.outputItemId, id, now)]
      : []),
    db
      .update(assemblyDefinitions)
      .set({
        name: updatedRow.name,
        outputItemId: updatedRow.outputItemId,
        outputQty: updatedRow.outputQty,
        isDefault: updatedRow.isDefault,
        notes: updatedRow.notes,
        updatedAt: now,
      })
      .where(eq(assemblyDefinitions.id, id)),
    // Lines are aggregate components, not independently addressable: replace the complete set.
    db.delete(assemblyDefinitionLines).where(eq(assemblyDefinitionLines.definitionId, id)),
    ...newLineRows.map((line) => db.insert(assemblyDefinitionLines).values(line)),
    buildAuditLogInsert(db, {
      actor,
      action: "update",
      entityType: "assembly_definition",
      entityId: id,
      before: { ...existingRow, lines: existingLines },
      after: { ...updatedRow, lines: newLineRows },
    }),
  ];
  await db.batch(statements as [Statement, ...Statement[]]);

  const assemblyDefinition = await toAssemblyDefinitionDto(db, updatedRow, newLineRows);
  const settings = await getAssemblyDefinitionSettingsDto(db);
  return { assemblyDefinition, settings };
}

export async function setAssemblyDefinitionActive(
  db: Db,
  command: SetAssemblyDefinitionActiveCommand,
  actor: AuditActor,
): Promise<SetAssemblyDefinitionActiveResult> {
  const existingRow = await db.query.assemblyDefinitions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.id),
  });
  if (!existingRow) throw notFound("No se encontró la definición de armado.", { id: command.id });
  if (command.isActive) {
    const duplicate = await findActiveAssemblyDefinitionRowByName(db, existingRow.name, command.id);
    if (duplicate) {
      throw conflict(`Ya existe una definición activa llamada "${existingRow.name}".`, {
        field: "name",
      });
    }
  }

  const now = nowIso();
  const newIsActive = command.isActive ? 1 : 0;
  const statements: Statement[] = [
    ...(command.isActive && existingRow.isDefault === 1
      ? [buildClearOtherDefaultsStatement(db, existingRow.outputItemId, command.id, now)]
      : []),
    db
      .update(assemblyDefinitions)
      .set({ isActive: newIsActive, updatedAt: now })
      .where(eq(assemblyDefinitions.id, command.id)),
    buildAuditLogInsert(db, {
      actor,
      action: command.isActive ? "activate" : "deactivate",
      entityType: "assembly_definition",
      entityId: command.id,
      before: { isActive: existingRow.isActive === 1 },
      after: { isActive: command.isActive },
    }),
  ];
  await db.batch(statements as [Statement, ...Statement[]]);

  const updatedRow = { ...existingRow, isActive: newIsActive, updatedAt: now };
  const lineRows = await fetchAssemblyDefinitionLines(db, command.id);
  const assemblyDefinition = await toAssemblyDefinitionDto(db, updatedRow, lineRows);
  const settings = await getAssemblyDefinitionSettingsDto(db);
  return { assemblyDefinition, settings };
}

export async function getAssemblyDefinition(
  db: Db,
  id: string,
): Promise<GetAssemblyDefinitionResult> {
  const row = await db.query.assemblyDefinitions.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!row) throw notFound("No se encontró la definición de armado.", { id });
  const assemblyDefinition = await toAssemblyDefinitionDto(
    db,
    row,
    await fetchAssemblyDefinitionLines(db, id),
  );
  return { assemblyDefinition, settings: await getAssemblyDefinitionSettingsDto(db) };
}

export async function listAssemblyDefinitions(
  db: Db,
  filters: ListAssemblyDefinitionsFilters,
): Promise<ListAssemblyDefinitionsResult> {
  const rows = await db.query.assemblyDefinitions.findMany({
    where: (t, { and: andOp, eq: eqOp }) => {
      const conditions = [];
      if (filters.outputItemId) conditions.push(eqOp(t.outputItemId, filters.outputItemId));
      if (filters.isActive !== undefined) {
        conditions.push(eqOp(t.isActive, filters.isActive ? 1 : 0));
      }
      return conditions.length > 0 ? andOp(...conditions) : undefined;
    },
    orderBy: (t, { asc }) => asc(t.name),
  });
  const assemblyDefinitionDtos = await Promise.all(
    rows.map(async (row) =>
      toAssemblyDefinitionDto(db, row, await fetchAssemblyDefinitionLines(db, row.id)),
    ),
  );
  return {
    assemblyDefinitions: assemblyDefinitionDtos,
    settings: await getAssemblyDefinitionSettingsDto(db),
  };
}

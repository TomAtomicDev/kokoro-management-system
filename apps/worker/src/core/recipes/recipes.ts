// Recipe CRUD (KOK-025, Doc 03 §3/§4 C-3b, Doc 04 §3.1, Doc 07 SC-06). Every mutation is its own
// db.batch() (D-3): the row write(s) + its audit_log entry, executed together so a failure leaves
// nothing persisted. Modeled on core/catalog/items.ts (plain CRUD, not core/purchasing/index.ts's
// replay/backdate machinery — recipes are catalog/config, not a movement-affecting business event).
//
// The is_default invariant (Doc 03: only one is_default among an output item's ACTIVE recipes) is
// enforced by `ux_recipes_default`, a PARTIAL UNIQUE INDEX SQLite checks at EACH statement, not
// deferred — so two rows racing to be `is_default=1` inside the same batch would surface as a raw
// SQLITE_CONSTRAINT error. `buildClearOtherDefaultsStatement` avoids that by clearing every OTHER
// active default FIRST, in the same batch, before the statement that sets/keeps this recipe's own
// is_default=1. D1's `db.batch()` executes its statements sequentially inside one transaction —
// evidenced by core/purchasing/index.ts's own batches, which rely on statement ORDER throughout
// (e.g. "movementStatements" must precede the costing replay's own item_stock write, "LAST on
// purpose... must land last to win"); if D1 batches were not strictly sequential, purchasing's own
// ordering comments would be meaningless. This module follows the same discipline.

import type {
  AuditActor,
  GetRecipeResult,
  ListRecipesFilters,
  ListRecipesResult,
  RecordRecipeCommand,
  RecordRecipeResult,
  SetRecipeActiveCommand,
  SetRecipeActiveResult,
  UpdateRecipeCommand,
  UpdateRecipeResult,
} from "@kokoro/shared";
import { generateUuidV7, nowIso } from "@kokoro/shared";
import { and, eq, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { recipeLines, recipes } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { conflict, notFound, validationError } from "../errors.js";
import { fetchRecipeLines, getRecipeSettingsDto, toRecipeDto } from "./dto.js";

type Statement = BatchItem<"sqlite">;
type RecipeRow = typeof recipes.$inferSelect;
type RecipeLineRow = typeof recipeLines.$inferSelect;

/**
 * Doc 04 §5 integrity rule (not a DB CHECK — enforced here): the output item must exist and be
 * SEMI_FINISHED or FINISHED (never RAW_MATERIAL — a raw material is not something you produce —
 * nor PACKAGING, Doc 03 §3's Item aggregate row); every line item must exist and be RAW_MATERIAL
 * or SEMI_FINISHED (never FINISHED — a finished product is not consumed as an ingredient — nor
 * PACKAGING, same rule: it is only ever a `sale_lines` row); and no line may reference the recipe's own
 * `outputItemId` — a direct self-reference always makes the recipe graph cyclical (KOK-029's
 * `topoOrderAffectedItems` would otherwise only catch it later, at nightly C-3 refresh time, as an
 * opaque "recetas forman un ciclo" 409 covering every FINISHED/SEMI_FINISHED item, not just the
 * offending one — see the incident this guarded against: a SEMI_FINISHED item like a sourdough
 * starter listing itself as an ingredient of its own "feed the starter" recipe).
 */
async function validateRecipeItemKinds(
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
  if (outputItem.kind !== "SEMI_FINISHED" && outputItem.kind !== "FINISHED") {
    throw validationError("El ítem de salida debe ser un semielaborado o un producto terminado.", {
      outputItemId,
      kind: outputItem.kind,
    });
  }

  for (const line of lines) {
    if (line.itemId === outputItemId) {
      throw validationError("Un ítem no puede ser ingrediente de su propia receta.", {
        itemId: line.itemId,
      });
    }
    const itemRow = await db.query.items.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.id, line.itemId),
    });
    if (!itemRow) {
      throw notFound("No se encontró el ítem de la línea de receta.", { id: line.itemId });
    }
    if (itemRow.kind !== "RAW_MATERIAL" && itemRow.kind !== "SEMI_FINISHED") {
      throw validationError(
        "Un ingrediente de receta debe ser una materia prima o un semielaborado.",
        { itemId: line.itemId, kind: itemRow.kind },
      );
    }
  }
}

/**
 * Doc 03 "Recipe" row / Doc 04 §3.1 (KOK-025 KB amendment): no two ACTIVE recipes may share a
 * `name`, mirroring `findItemRowByName` (core/catalog/items.ts). Scoped to active rows only —
 * matching `ux_recipes_name`'s partial index — so a deactivated recipe's name stays free to
 * reuse. `excludeId` lets `updateRecipe`/`setRecipeActive` check against every OTHER row.
 */
async function findActiveRecipeRowByName(
  db: Db,
  name: string,
  excludeId?: string,
): Promise<RecipeRow | undefined> {
  return db.query.recipes.findFirst({
    where: (t, { and, eq: eqOp, ne }) => {
      const base = and(eqOp(t.name, name), eqOp(t.isActive, 1));
      return excludeId ? and(base, ne(t.id, excludeId)) : base;
    },
  });
}

/**
 * Clears `is_default` on every OTHER active recipe for `outputItemId` (this module's header) — must
 * be spliced into the caller's batch BEFORE the statement that sets/keeps `excludeRecipeId`'s own
 * is_default=1, or the partial unique index can see two `is_default=1` rows mid-batch.
 */
function buildClearOtherDefaultsStatement(
  db: Db,
  outputItemId: string,
  excludeRecipeId: string,
  now: string,
): Statement {
  return db
    .update(recipes)
    .set({ isDefault: 0, updatedAt: now })
    .where(
      and(
        eq(recipes.outputItemId, outputItemId),
        eq(recipes.isDefault, 1),
        eq(recipes.isActive, 1),
        ne(recipes.id, excludeRecipeId),
      ),
    );
}

export async function recordRecipe(
  db: Db,
  command: RecordRecipeCommand,
  actor: AuditActor,
): Promise<RecordRecipeResult> {
  await validateRecipeItemKinds(db, command.outputItemId, command.lines);
  const duplicate = await findActiveRecipeRowByName(db, command.name);
  if (duplicate) {
    throw conflict(`Ya existe una receta activa llamada "${command.name}".`, { field: "name" });
  }

  const now = nowIso();
  const recipeId = generateUuidV7();
  const row: RecipeRow = {
    id: recipeId,
    name: command.name,
    outputItemId: command.outputItemId,
    expectedYieldQty: command.expectedYieldQty,
    estLaborMin: command.estLaborMin ?? null,
    isDefault: command.isDefault ? 1 : 0,
    isActive: 1,
    notes: command.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const lineRows: RecipeLineRow[] = command.lines.map((line) => ({
    id: generateUuidV7(),
    recipeId,
    itemId: line.itemId,
    qty: line.qty,
  }));

  const statements: Statement[] = [
    // Must precede the insert below (this module's header) — an isActive=1/isDefault=1 row being
    // created can otherwise collide with an existing default under the partial unique index.
    ...(command.isDefault
      ? [buildClearOtherDefaultsStatement(db, command.outputItemId, recipeId, now)]
      : []),
    db.insert(recipes).values(row),
    ...lineRows.map((line) => db.insert(recipeLines).values(line)),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "recipe",
      entityId: recipeId,
      before: null,
      after: { ...row, lines: lineRows },
    }),
  ];
  await db.batch(statements as [Statement, ...Statement[]]);

  const recipe = await toRecipeDto(db, row, lineRows);
  const settings = await getRecipeSettingsDto(db);
  return { recipe, settings };
}

/**
 * Full replacement (same field set as `recordRecipe`, per updateRecipeCommandSchema's own doc
 * comment): the caller sends the complete edited recipe, not a patch. `id` travels via the `id`
 * parameter (routes merge it in from the URL, mirroring purchasing's PATCH), never the body.
 */
export async function updateRecipe(
  db: Db,
  id: string,
  command: UpdateRecipeCommand,
  actor: AuditActor,
): Promise<UpdateRecipeResult> {
  const existingRow = await db.query.recipes.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!existingRow) {
    throw notFound("No se encontró la receta.", { id });
  }
  const existingLines = await fetchRecipeLines(db, id);

  await validateRecipeItemKinds(db, command.outputItemId, command.lines);
  const duplicate = await findActiveRecipeRowByName(db, command.name, id);
  if (duplicate) {
    throw conflict(`Ya existe una receta activa llamada "${command.name}".`, { field: "name" });
  }

  const now = nowIso();
  // `isActive` is not part of this command (setRecipeActive owns it exclusively) — it survives
  // unchanged from existingRow, which is exactly what the is_default clear-guard below needs to
  // decide whether the POST-update row will actually be an active default.
  const updatedRow: RecipeRow = {
    ...existingRow,
    name: command.name,
    outputItemId: command.outputItemId,
    expectedYieldQty: command.expectedYieldQty,
    estLaborMin: command.estLaborMin ?? null,
    isDefault: command.isDefault ? 1 : 0,
    notes: command.notes ?? null,
    updatedAt: now,
  };
  const newLineRows: RecipeLineRow[] = command.lines.map((line) => ({
    id: generateUuidV7(),
    recipeId: id,
    itemId: line.itemId,
    qty: line.qty,
  }));

  const willBeActiveDefault = command.isDefault === true && updatedRow.isActive === 1;

  const statements: Statement[] = [
    ...(willBeActiveDefault
      ? [buildClearOtherDefaultsStatement(db, command.outputItemId, id, now)]
      : []),
    db
      .update(recipes)
      .set({
        name: updatedRow.name,
        outputItemId: updatedRow.outputItemId,
        expectedYieldQty: updatedRow.expectedYieldQty,
        estLaborMin: updatedRow.estLaborMin,
        isDefault: updatedRow.isDefault,
        notes: updatedRow.notes,
        updatedAt: now,
      })
      .where(eq(recipes.id, id)),
    // Recipe lines are components of the recipe aggregate, not independently-addressable rows
    // (mirrors purchase_lines' treatment in core/purchasing/index.ts) — full replace, not a diff.
    db.delete(recipeLines).where(eq(recipeLines.recipeId, id)),
    ...newLineRows.map((line) => db.insert(recipeLines).values(line)),
    buildAuditLogInsert(db, {
      actor,
      action: "update",
      entityType: "recipe",
      entityId: id,
      before: { ...existingRow, lines: existingLines },
      after: { ...updatedRow, lines: newLineRows },
    }),
  ];
  await db.batch(statements as [Statement, ...Statement[]]);

  const recipe = await toRecipeDto(db, updatedRow, newLineRows);
  const settings = await getRecipeSettingsDto(db);
  return { recipe, settings };
}

/**
 * Deactivate/reactivate — the ONLY "delete" a recipe ever gets (soft, mirroring items.is_active;
 * Doc 03's Recipe aggregate row says so explicitly). Reactivating a recipe whose STORED is_default
 * is still 1 must clear whichever other recipe became the default while this one was inactive, or
 * it would silently collide with it under the partial unique index (this module's header) —
 * deactivating never needs the clear-guard, since isActive=0/isDefault=1 never matches the index's
 * WHERE clause in the first place.
 */
export async function setRecipeActive(
  db: Db,
  command: SetRecipeActiveCommand,
  actor: AuditActor,
): Promise<SetRecipeActiveResult> {
  const existingRow = await db.query.recipes.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.id),
  });
  if (!existingRow) {
    throw notFound("No se encontró la receta.", { id: command.id });
  }
  if (command.isActive) {
    // Reactivating can collide with a same-named recipe created WHILE this one was inactive —
    // ux_recipes_name only guards active rows, so this gap is invisible until now.
    const duplicate = await findActiveRecipeRowByName(db, existingRow.name, command.id);
    if (duplicate) {
      throw conflict(`Ya existe una receta activa llamada "${existingRow.name}".`, {
        field: "name",
      });
    }
  }

  const now = nowIso();
  const newIsActive = command.isActive ? 1 : 0;
  const needsClear = command.isActive && existingRow.isDefault === 1;

  const statements: Statement[] = [
    ...(needsClear
      ? [buildClearOtherDefaultsStatement(db, existingRow.outputItemId, command.id, now)]
      : []),
    db
      .update(recipes)
      .set({ isActive: newIsActive, updatedAt: now })
      .where(eq(recipes.id, command.id)),
    buildAuditLogInsert(db, {
      actor,
      action: command.isActive ? "activate" : "deactivate",
      entityType: "recipe",
      entityId: command.id,
      before: { isActive: existingRow.isActive === 1 },
      after: { isActive: command.isActive },
    }),
  ];
  await db.batch(statements as [Statement, ...Statement[]]);

  const updatedRow: RecipeRow = { ...existingRow, isActive: newIsActive, updatedAt: now };
  const lineRows = await fetchRecipeLines(db, command.id);
  const recipe = await toRecipeDto(db, updatedRow, lineRows);
  const settings = await getRecipeSettingsDto(db);
  return { recipe, settings };
}

export async function getRecipe(db: Db, id: string): Promise<GetRecipeResult> {
  const row = await db.query.recipes.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!row) {
    throw notFound("No se encontró la receta.", { id });
  }
  const lineRows = await fetchRecipeLines(db, id);
  const recipe = await toRecipeDto(db, row, lineRows);
  const settings = await getRecipeSettingsDto(db);
  return { recipe, settings };
}

export async function listRecipes(db: Db, filters: ListRecipesFilters): Promise<ListRecipesResult> {
  const rows = await db.query.recipes.findMany({
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

  const recipeDtos = await Promise.all(
    rows.map(async (row) => toRecipeDto(db, row, await fetchRecipeLines(db, row.id))),
  );
  const settings = await getRecipeSettingsDto(db);
  return { recipes: recipeDtos, settings };
}

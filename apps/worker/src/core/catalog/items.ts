// Item CRUD (KOK-011, Doc 04 Ãƒâ€šÃ‚Â§3.1, Doc 07 SC-15). Every mutation is its own db.batch() (D-3):
// the row write + its audit_log entry, executed together so a failure leaves nothing persisted.

import type {
  AuditActor,
  CreateItemCommand,
  ItemDto,
  ListItemsFilters,
  ListItemsResult,
  MilliCentavosPerUnit,
  SetItemActiveCommand,
  UpdateItemCommand,
} from "@kokoro/shared";
import { generateUuidV7, nowIso, toBusinessDate, toMilliCentavosPerUnit } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { Db } from "../../db/index.js";
import { inventoryCountLines, inventoryCounts, items, priceHistory } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { buildReplacementCostHistoryInsert } from "../costing/replacement-cost-history.js";
import { applyWacEntry } from "../costing/wac.js";
import { conflict, notFound, validationError } from "../errors.js";
import { buildStockMovementStatements } from "../inventory/movements.js";
import type { StockMovementInput } from "../inventory/types.js";
import { fetchAliasesForItem, fetchAliasesForItems, toItemDto } from "./dto.js";

type Statement = BatchItem<"sqlite">;

/** KOK-035, Doc 07 SC-12: "Actualizar precio" (and a price set at creation) writes `price_history`
 * in the same batch as the `items.sale_price` write (D-3) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â never as a separate follow-up call. */
function buildPriceHistoryInsert(
  db: Db,
  itemId: string,
  priceMc: MilliCentavosPerUnit,
  now: string,
) {
  return db.insert(priceHistory).values({
    id: generateUuidV7(),
    itemId,
    priceMc,
    effectiveFrom: toBusinessDate(now),
    note: null,
  });
}

// Exported for core/catalog/bulk-import.ts's per-item duplicate check (KOK-020) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â same query,
// reused rather than re-declared, so the two duplicate-name checks never drift apart.
export async function findItemRowByName(db: Db, name: string, excludeId?: string) {
  return db.query.items.findFirst({
    where: (t, { and, eq: eqOp, ne }) =>
      excludeId ? and(eqOp(t.name, name), ne(t.id, excludeId)) : eqOp(t.name, name),
  });
}

export async function createItem(
  db: Db,
  command: CreateItemCommand,
  actor: AuditActor,
): Promise<ItemDto> {
  const duplicate = await findItemRowByName(db, command.name);
  if (duplicate) {
    throw conflict(`Ya existe un ítem llamado "${command.name}".`, { field: "name" });
  }

  const now = nowIso();
  const hasOpeningQty = command.openingQty !== undefined;
  const hasOpeningUnitCostMc = command.openingUnitCostMc !== undefined;
  if (hasOpeningQty !== hasOpeningUnitCostMc) {
    throw validationError("El stock inicial necesita cantidad y costo unitario.", {
      openingQty: command.openingQty,
      openingUnitCostMc: command.openingUnitCostMc,
    });
  }
  if ((hasOpeningQty || hasOpeningUnitCostMc) && command.isUnmetered) {
    throw validationError("Los ítems no medidos no pueden tener stock inicial.", {
      openingQty: command.openingQty,
      openingUnitCostMc: command.openingUnitCostMc,
    });
  }
  if (
    command.openingQty !== undefined &&
    (!Number.isSafeInteger(command.openingQty) || command.openingQty <= 0)
  ) {
    throw validationError(
      "La cantidad de stock inicial debe ser un entero seguro mayor que cero.",
      {
        openingQty: command.openingQty,
      },
    );
  }
  if (
    command.openingUnitCostMc !== undefined &&
    (!Number.isSafeInteger(command.openingUnitCostMc) || command.openingUnitCostMc <= 0)
  ) {
    throw validationError(
      "El costo unitario de stock inicial debe ser un entero seguro mayor que cero.",
      { openingUnitCostMc: command.openingUnitCostMc },
    );
  }

  const openingQty = command.openingQty;
  const openingUnitCostMc =
    command.openingUnitCostMc === undefined
      ? undefined
      : toMilliCentavosPerUnit(command.openingUnitCostMc);
  const openingWacMc =
    openingQty !== undefined && openingUnitCostMc !== undefined
      ? applyWacEntry(toMilliCentavosPerUnit(0), 0, openingQty, openingUnitCostMc)
      : toMilliCentavosPerUnit(0);
  const row = {
    id: generateUuidV7(),
    name: command.name,
    kind: command.kind,
    category: command.category,
    unit: command.unit,
    wacMc: openingWacMc,
    replacementCostMc: command.replacementCostMc ?? 0,
    replacementCostUpdatedAt: command.replacementCostMc != null ? now : null,
    salePriceMc: command.salePriceMc ?? null,
    minStockQty: command.minStockQty ?? null,
    isUnmetered: command.isUnmetered ? 1 : 0,
    isActive: 1,
    notes: command.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const statements: Statement[] = [
    db.insert(items).values(row),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "item",
      entityId: row.id,
      before: null,
      after: row,
    }),
  ];
  if (row.salePriceMc !== null) {
    statements.push(buildPriceHistoryInsert(db, row.id, row.salePriceMc, now));
  }
  if (command.replacementCostMc != null) {
    statements.push(
      buildReplacementCostHistoryInsert(db, {
        itemId: row.id,
        replacementCostMc: command.replacementCostMc,
        observedAt: now,
        businessDate: toBusinessDate(now),
        source: "MANUAL",
      }),
    );
  }

  if (openingQty !== undefined && openingUnitCostMc !== undefined) {
    const countId = generateUuidV7();
    const countRow = {
      id: countId,
      occurredAt: now,
      businessDate: toBusinessDate(now),
      status: "COMMITTED" as const,
      code: null,
      notes: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const countLine = {
      id: generateUuidV7(),
      countId,
      itemId: row.id,
      expectedQty: 0,
      countedQty: openingQty,
    };
    const openingMovement: StockMovementInput = {
      itemId: row.id,
      occurredAt: now,
      businessDate: countRow.businessDate,
      type: "OPENING_IN",
      qty: openingQty,
      unitCostMc: openingUnitCostMc,
      sourceEventType: "inventory_count",
      sourceEventId: countId,
    };
    const { statements: movementStatements } = buildStockMovementStatements(db, [openingMovement]);
    statements.push(
      db.insert(inventoryCounts).values(countRow),
      db.insert(inventoryCountLines).values(countLine),
      ...movementStatements,
      buildAuditLogInsert(db, {
        actor,
        action: "commit",
        entityType: "inventory_counts",
        entityId: countId,
        before: { status: "DRAFT" },
        after: { status: "COMMITTED", adjustments: [{ itemId: row.id, delta: openingQty }] },
      }),
    );
  }
  await db.batch(statements as [Statement, ...Statement[]]);

  return toItemDto(row, []);
}

export async function updateItem(
  db: Db,
  command: UpdateItemCommand,
  actor: AuditActor,
): Promise<ItemDto> {
  const existingRow = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.id),
  });
  if (!existingRow) {
    throw notFound("No se encontró el ítem.", { id: command.id });
  }

  if (command.name !== undefined && command.name !== existingRow.name) {
    const duplicate = await findItemRowByName(db, command.name, command.id);
    if (duplicate) {
      throw conflict(`Ya existe un ítem llamado "${command.name}".`, { field: "name" });
    }
  }

  const now = nowIso();
  const patch = {
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.kind !== undefined ? { kind: command.kind } : {}),
    ...(command.category !== undefined ? { category: command.category } : {}),
    ...(command.unit !== undefined ? { unit: command.unit } : {}),
    ...(command.salePriceMc !== undefined ? { salePriceMc: command.salePriceMc } : {}),
    ...(command.minStockQty !== undefined ? { minStockQty: command.minStockQty } : {}),
    ...(command.isUnmetered !== undefined ? { isUnmetered: command.isUnmetered ? 1 : 0 } : {}),
    ...(command.replacementCostMc !== undefined
      ? {
          replacementCostMc: command.replacementCostMc ?? 0,
          replacementCostUpdatedAt: command.replacementCostMc === null ? null : now,
        }
      : {}),
    ...(command.notes !== undefined ? { notes: command.notes } : {}),
    updatedAt: now,
  };
  const updatedRow = { ...existingRow, ...patch };

  const statements: Statement[] = [
    db.update(items).set(patch).where(eq(items.id, command.id)),
    buildAuditLogInsert(db, {
      actor,
      action: "update",
      entityType: "item",
      entityId: command.id,
      before: existingRow,
      after: updatedRow,
    }),
  ];
  // Doc 07 SC-12: only a genuine price CHANGE gets a price_history row ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â not a no-op resubmit of
  // the same value, and not a price being cleared to null (price_history.price is NOT NULL; there
  // is no normative KB rule for logging a price removal, so this simply doesn't log one, D-1).
  if (
    command.salePriceMc !== undefined &&
    command.salePriceMc !== null &&
    command.salePriceMc !== existingRow.salePriceMc
  ) {
    statements.push(buildPriceHistoryInsert(db, command.id, command.salePriceMc, now));
  }
  if (command.replacementCostMc != null) {
    statements.push(
      buildReplacementCostHistoryInsert(db, {
        itemId: command.id,
        replacementCostMc: command.replacementCostMc,
        observedAt: now,
        businessDate: toBusinessDate(now),
        source: "MANUAL",
      }),
    );
  }
  await db.batch(statements as [Statement, ...Statement[]]);

  const aliases = await fetchAliasesForItem(db, command.id);
  return toItemDto(updatedRow, aliases);
}

export async function setItemActive(
  db: Db,
  command: SetItemActiveCommand,
  actor: AuditActor,
): Promise<ItemDto> {
  const existingRow = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.id),
  });
  if (!existingRow) {
    throw notFound("No se encontró el ítem.", { id: command.id });
  }

  const now = nowIso();
  const patch = { isActive: command.isActive ? 1 : 0, updatedAt: now };
  const updatedRow = { ...existingRow, ...patch };

  await db.batch([
    db.update(items).set(patch).where(eq(items.id, command.id)),
    buildAuditLogInsert(db, {
      actor,
      action: command.isActive ? "activate" : "deactivate",
      entityType: "item",
      entityId: command.id,
      before: { isActive: existingRow.isActive === 1 },
      after: { isActive: command.isActive },
    }),
  ]);

  const aliases = await fetchAliasesForItem(db, command.id);
  return toItemDto(updatedRow, aliases);
}

export async function getItem(db: Db, id: string): Promise<ItemDto> {
  const row = await db.query.items.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!row) {
    throw notFound("No se encontró el ítem.", { id });
  }
  const aliases = await fetchAliasesForItem(db, id);
  return toItemDto(row, aliases);
}

export async function listItems(db: Db, filters: ListItemsFilters): Promise<ListItemsResult> {
  let aliasMatchItemIds: string[] = [];
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    const aliasMatches = await db.query.itemAliases.findMany({
      where: (t, { like }) => like(t.alias, pattern),
    });
    aliasMatchItemIds = aliasMatches.map((a) => a.itemId);
  }

  const rows = await db.query.items.findMany({
    where: (t, { and, eq: eqOp, like, or, inArray }) => {
      const conditions = [];
      if (filters.kind) conditions.push(eqOp(t.kind, filters.kind));
      if (filters.category) conditions.push(eqOp(t.category, filters.category));
      if (filters.isActive !== undefined) {
        conditions.push(eqOp(t.isActive, filters.isActive ? 1 : 0));
      }
      if (filters.search) {
        const pattern = `%${filters.search}%`;
        conditions.push(
          aliasMatchItemIds.length > 0
            ? or(like(t.name, pattern), inArray(t.id, aliasMatchItemIds))
            : like(t.name, pattern),
        );
      }
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    orderBy: (t, { asc, sql: sqlOp }) => [
      sqlOp`CASE ${t.kind}
        WHEN 'RAW_MATERIAL' THEN 0
        WHEN 'SEMI_FINISHED' THEN 1
        WHEN 'FINISHED' THEN 2
        WHEN 'PACKAGING' THEN 3
        ELSE 4
      END`,
      asc(t.name),
    ],
  });

  const aliasesByItem = await fetchAliasesForItems(
    db,
    rows.map((r) => r.id),
  );
  return { items: rows.map((row) => toItemDto(row, aliasesByItem.get(row.id) ?? [])) };
}

import { env } from "cloudflare:test";
import {
  rateFromTotal,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
} from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordAssemblyDefinition } from "../src/core/assemblies/index.js";
import {
  deleteAssembly,
  getAssembly,
  listAssemblies,
  previewAssemblyImpact,
  recordAssembly,
  restoreAssembly,
  updateAssembly,
} from "../src/core/assembly-events/index.js";
import { createItem } from "../src/core/catalog/index.js";
import { recordPurchase } from "../src/core/purchasing/index.js";
import { recordSession } from "../src/core/sessions/index.js";
import { createDb } from "../src/db/index.js";
import { costingAdjustments, financialTransactions, items } from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
const BUSINESS_DATE = "2026-08-12";
const OCCURRED_AT = "2026-08-12T15:00:00.000Z";
type Db = ReturnType<typeof createDb>;

async function createFinished(db: Db, name: string, unit: "UNIT" | "KG" = "UNIT") {
  return createItem(
    db,
    {
      name: `${name} ${crypto.randomUUID()}`,
      kind: "FINISHED",
      category: "OTHER",
      unit,
      salePriceMc: toMilliCentavosPerUnit(50_000_000),
      minStockQty: null,
    },
    ACTOR,
  );
}

async function createComponent(
  db: Db,
  name: string,
  kind: "FINISHED" | "PACKAGING",
  wacCentavos: number,
) {
  const item = await createItem(
    db,
    kind === "FINISHED"
      ? {
          name: `${name} ${crypto.randomUUID()}`,
          kind,
          category: "OTHER",
          unit: "UNIT",
          salePriceMc: toMilliCentavosPerUnit(20_000_000),
          minStockQty: null,
        }
      : {
          name: `${name} ${crypto.randomUUID()}`,
          kind,
          category: "NOT_EATABLE",
          unit: "UNIT",
          minStockQty: 0,
        },
    ACTOR,
  );
  const wacMc = rateFromTotal(toCentavos(wacCentavos), toMilliUnits(1000));
  await db.update(items).set({ wacMc }).where(eq(items.id, item.id));
  return { ...item, wacMc };
}

async function createProductionSession(db: Db): Promise<string> {
  const result = await recordSession(
    db,
    { type: "PRODUCTION", businessDate: BUSINESS_DATE },
    ACTOR,
  );
  return result.session.id;
}

async function createSemiFinished(db: Db, name: string) {
  return createItem(
    db,
    {
      name: `${name} ${crypto.randomUUID()}`,
      kind: "SEMI_FINISHED",
      category: "OTHER",
      unit: "UNIT",
      minStockQty: null,
    },
    ACTOR,
  );
}

async function recordSimpleAssembly(
  db: Db,
  options: {
    componentId: string;
    outputId: string;
    componentQty?: number;
    actualOutputQty?: number;
    occurredAt?: string;
    businessDate?: string;
  },
) {
  const sessionId = await createProductionSession(db);
  const command = {
    occurredAt: options.occurredAt ?? OCCURRED_AT,
    businessDate: options.businessDate ?? BUSINESS_DATE,
    sessionId,
    outputItemId: options.outputId,
    actualOutputQty: options.actualOutputQty ?? 1000,
    lines: [{ itemId: options.componentId, qty: options.componentQty ?? 1000 }],
  };
  const result = await recordAssembly(db, command, ACTOR);
  return { command, result };
}

describe("recordAssembly", () => {
  it("records the Desayuno Kokoro golden-number value transfer", async () => {
    const db = createDb(env.DB);
    const sessionId = await createProductionSession(db);
    const output = await createFinished(db, "Desayuno Kokoro");
    const components = [
      await createComponent(db, "Pan de masa madre 500 g", "FINISHED", 1300),
      await createComponent(db, "Ghee 200 g", "FINISHED", 1800),
      await createComponent(db, "Kéfir natural 500 ml", "FINISHED", 570),
      await createComponent(db, "Box", "PACKAGING", 300),
      await createComponent(db, "String", "PACKAGING", 50),
      await createComponent(db, "Card", "PACKAGING", 50),
    ];
    const componentWacsBefore = new Map(
      components.map((component) => [component.id, component.wacMc]),
    );

    const result = await recordAssembly(
      db,
      {
        occurredAt: OCCURRED_AT,
        businessDate: BUSINESS_DATE,
        sessionId,
        outputItemId: output.id,
        plannedOutputQty: 5000,
        actualOutputQty: 5000,
        notes: "Armado del combo",
        lines: components.map((component) => ({ itemId: component.id, qty: 5000 })),
      },
      ACTOR,
    );

    expect(result.assembly.definitionId).toBeNull();
    expect(result.assembly.directCost).toBe(20_350);
    expect(result.assembly.outputUnitCostMc).toBe(4_070_000);
    expect(result.assembly.lines).toHaveLength(6);

    const outputAfter = await db.query.items.findFirst({
      where: (table, { eq: eqOp }) => eqOp(table.id, output.id),
    });
    expect(outputAfter?.wacMc).toBe(4_070_000);

    const movements = await db.query.stockMovements.findMany({
      where: (table, { and, eq: eqOp }) =>
        and(eqOp(table.sourceEventType, "assembly"), eqOp(table.sourceEventId, result.assembly.id)),
    });
    const outgoing = movements.filter((movement) => movement.type === "ASSEMBLY_OUT");
    const incoming = movements.filter((movement) => movement.type === "ASSEMBLY_IN");
    expect(outgoing).toHaveLength(6);
    expect(outgoing.every((movement) => movement.qty === -5000)).toBe(true);
    expect(incoming).toEqual([
      expect.objectContaining({
        itemId: output.id,
        qty: 5000,
        unitCostMc: 4_070_000,
        sourceEventType: "assembly",
        sourceEventId: result.assembly.id,
      }),
    ]);

    for (const component of components) {
      const after = await db.query.items.findFirst({
        where: (table, { eq: eqOp }) => eqOp(table.id, component.id),
      });
      expect(after?.wacMc).toBe(componentWacsBefore.get(component.id));
    }

    const inputValue = components.reduce(
      (sum, component) => sum + totalCentavos(component.wacMc, toMilliUnits(5000)),
      0,
    );
    const outputValue = totalCentavos(
      toMilliCentavosPerUnit(result.assembly.outputUnitCostMc),
      toMilliUnits(5000),
    );
    expect(inputValue).toBe(20_350);
    expect(outputValue).toBe(inputValue);

    const fetched = await getAssembly(db, result.assembly.id);
    expect(fetched.assembly.id).toBe(result.assembly.id);
    const listed = await listAssemblies(db, { outputItemId: output.id });
    expect(listed.assemblies.map((assembly) => assembly.id)).toContain(result.assembly.id);

    const financialRows = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.sourceEventId, result.assembly.id));
    expect(financialRows).toHaveLength(0);
  });

  it("rejects a RAW_MATERIAL component", async () => {
    const db = createDb(env.DB);
    const sessionId = await createProductionSession(db);
    const output = await createFinished(db, "Salida válida");
    const raw = await createItem(
      db,
      {
        name: `Harina ${crypto.randomUUID()}`,
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
        minStockQty: 0,
      },
      ACTOR,
    );
    await expect(
      recordAssembly(
        db,
        {
          occurredAt: OCCURRED_AT,
          businessDate: BUSINESS_DATE,
          sessionId,
          outputItemId: output.id,
          actualOutputQty: 1000,
          lines: [{ itemId: raw.id, qty: 1000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects an output that is not FINISHED with unit UNIT", async () => {
    const db = createDb(env.DB);
    const sessionId = await createProductionSession(db);
    const wrongOutput = await createFinished(db, "Salida en kilos", "KG");
    const component = await createComponent(db, "Caja", "PACKAGING", 100);
    await expect(
      recordAssembly(
        db,
        {
          occurredAt: OCCURRED_AT,
          businessDate: BUSINESS_DATE,
          sessionId,
          outputItemId: wrongOutput.id,
          actualOutputQty: 1000,
          lines: [{ itemId: component.id, qty: 1000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("cascades a backdated component purchase into an assembly output", async () => {
    const db = createDb(env.DB);
    const component = await createSemiFinished(db, "Base para combo");
    const output = await createFinished(db, "Combo ensamblado");

    await recordPurchase(
      db,
      {
        accountId: "acc_bank",
        occurredAt: "2026-08-10T10:00:00.000Z",
        businessDate: "2026-08-10",
        lines: [{ itemId: component.id, qty: 10_000, lineTotal: 20_000 }],
      },
      ACTOR,
    );

    // Active definition supplies the R-2 dependency edge, while the event below deliberately
    // exercises KOK-124's definition-free execution path.
    await recordAssemblyDefinition(
      db,
      {
        name: `Definición cascada ${crypto.randomUUID()}`,
        outputItemId: output.id,
        outputQty: 1000,
        isDefault: true,
        lines: [{ itemId: component.id, qty: 5000 }],
      },
      ACTOR,
    );
    const sessionId = await createProductionSession(db);
    const recorded = await recordAssembly(
      db,
      {
        occurredAt: "2026-08-12T10:00:00.000Z",
        businessDate: "2026-08-12",
        sessionId,
        outputItemId: output.id,
        actualOutputQty: 1000,
        lines: [{ itemId: component.id, qty: 5000 }],
      },
      ACTOR,
    );
    expect(recorded.assembly.definitionId).toBeNull();
    expect(recorded.assembly.outputUnitCostMc).toBe(10_000_000);

    const backdatedCommand = {
      accountId: "acc_bank",
      occurredAt: "2026-08-05T10:00:00.000Z",
      businessDate: "2026-08-05",
      lines: [{ itemId: component.id, qty: 10_000, lineTotal: 100_000 }],
    };
    let refusal: unknown;
    try {
      await recordPurchase(db, backdatedCommand, ACTOR);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: {
          affectedAssemblyIds: [recorded.assembly.id],
          affectedProductionRunIds: [],
          requiresConfirmation: true,
        },
      },
    });

    await recordPurchase(db, { ...backdatedCommand, confirm: true }, ACTOR);
    const outputAfter = await db.query.items.findFirst({
      where: (table, { eq: eqOp }) => eqOp(table.id, output.id),
    });
    expect(outputAfter?.wacMc).toBe(30_000_000);
  });

  it("updates costs while preserving matching frozen snapshots and pricing new items at current WAC", async () => {
    const db = createDb(env.DB);
    const existingComponent = await createComponent(db, "Componente existente", "PACKAGING", 1000);
    const newComponent = await createComponent(db, "Componente nuevo", "PACKAGING", 2000);
    const output = await createFinished(db, "Salida editable");
    const { command, result } = await recordSimpleAssembly(db, {
      componentId: existingComponent.id,
      outputId: output.id,
    });

    await db
      .update(items)
      .set({ wacMc: toMilliCentavosPerUnit(9_000_000) })
      .where(eq(items.id, existingComponent.id));
    await db
      .update(items)
      .set({ wacMc: toMilliCentavosPerUnit(3_000_000) })
      .where(eq(items.id, newComponent.id));

    const updated = await updateAssembly(
      db,
      result.assembly.id,
      {
        ...command,
        lines: [
          { itemId: existingComponent.id, qty: 2000 },
          { itemId: newComponent.id, qty: 1000 },
        ],
      },
      ACTOR,
    );

    expect(updated.assembly.directCost).toBe(5000);
    expect(updated.assembly.outputUnitCostMc).toBe(5_000_000);
    expect(updated.assembly.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: existingComponent.id, unitCostSnapshotMc: 1_000_000 }),
        expect.objectContaining({ itemId: newComponent.id, unitCostSnapshotMc: 3_000_000 }),
      ]),
    );
  });

  it("soft-deletes and reverses movements and output WAC", async () => {
    const db = createDb(env.DB);
    const component = await createComponent(db, "Componente a eliminar", "PACKAGING", 1000);
    const output = await createFinished(db, "Salida a eliminar");
    const { result } = await recordSimpleAssembly(db, {
      componentId: component.id,
      outputId: output.id,
    });

    const deleted = await deleteAssembly(db, result.assembly.id, {}, ACTOR);
    expect(deleted.deletedAt).toBeTruthy();
    await expect(getAssembly(db, result.assembly.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const stored = await db.query.assemblies.findFirst({
      where: (table, { eq: eqOp }) => eqOp(table.id, result.assembly.id),
    });
    expect(stored?.deletedAt).toBe(deleted.deletedAt);
    const movements = await db.query.stockMovements.findMany({
      where: (table, { and, eq: eqOp }) =>
        and(eqOp(table.sourceEventType, "assembly"), eqOp(table.sourceEventId, result.assembly.id)),
    });
    expect(movements).toHaveLength(0);
    const outputAfter = await db.query.items.findFirst({
      where: (table, { eq: eqOp }) => eqOp(table.id, output.id),
    });
    expect(outputAfter?.wacMc).toBe(0);
  });

  it("restores using the stored consumption snapshot verbatim", async () => {
    const db = createDb(env.DB);
    const component = await createComponent(db, "Componente a restaurar", "PACKAGING", 1000);
    const output = await createFinished(db, "Salida a restaurar");
    const { result } = await recordSimpleAssembly(db, {
      componentId: component.id,
      outputId: output.id,
    });
    const originalSnapshot = result.assembly.lines[0]?.unitCostSnapshotMc;
    await deleteAssembly(db, result.assembly.id, {}, ACTOR);
    await db
      .update(items)
      .set({ wacMc: toMilliCentavosPerUnit(7_000_000) })
      .where(eq(items.id, component.id));

    const restored = await restoreAssembly(db, result.assembly.id, {}, ACTOR);
    expect(restored.assembly.lines[0]?.unitCostSnapshotMc).toBe(originalSnapshot);
    expect(restored.assembly.directCost).toBe(result.assembly.directCost);
    expect(restored.assembly.outputUnitCostMc).toBe(result.assembly.outputUnitCostMc);
    const movements = await db.query.stockMovements.findMany({
      where: (table, { and, eq: eqOp }) =>
        and(eqOp(table.sourceEventType, "assembly"), eqOp(table.sourceEventId, result.assembly.id)),
    });
    expect(movements.find((movement) => movement.type === "ASSEMBLY_OUT")?.unitCostMc).toBe(
      originalSnapshot,
    );
  });

  it("treats a notes-only edit as kardex-unchanged", async () => {
    const db = createDb(env.DB);
    const component = await createComponent(db, "Componente descriptivo", "PACKAGING", 1000);
    const output = await createFinished(db, "Salida descriptiva");
    const { command, result } = await recordSimpleAssembly(db, {
      componentId: component.id,
      outputId: output.id,
    });
    const updated = await updateAssembly(
      db,
      result.assembly.id,
      { ...command, notes: "Solo cambió la nota" },
      ACTOR,
    );
    expect(updated.assembly.notes).toBe("Solo cambió la nota");
    const adjustments = await db
      .select()
      .from(costingAdjustments)
      .where(eq(costingAdjustments.triggerEventId, result.assembly.id));
    expect(adjustments).toHaveLength(0);
  });

  it("requires R-5 confirmation when a backdated assembly changes a later assembly cost", async () => {
    const db = createDb(env.DB);
    const component = await createComponent(db, "Componente con futuro", "PACKAGING", 1000);
    const laterOutput = await createFinished(db, "Salida futura");
    await recordAssemblyDefinition(
      db,
      {
        name: `Definición futura ${crypto.randomUUID()}`,
        outputItemId: laterOutput.id,
        outputQty: 1000,
        lines: [{ itemId: component.id, qty: 1000 }],
      },
      ACTOR,
    );
    await recordSimpleAssembly(db, {
      componentId: component.id,
      outputId: laterOutput.id,
      occurredAt: "2026-08-12T15:00:00.000Z",
      businessDate: "2026-08-12",
    });
    const backdatedOutput = await createFinished(db, "Salida retroactiva");
    const sessionId = await createProductionSession(db);
    const command = {
      occurredAt: "2026-08-10T15:00:00.000Z",
      businessDate: "2026-08-10",
      sessionId,
      outputItemId: backdatedOutput.id,
      actualOutputQty: 1000,
      lines: [{ itemId: component.id, qty: 1000 }],
    };

    await expect(recordAssembly(db, command, ACTOR)).rejects.toMatchObject({
      code: "CONFLICT",
      details: {
        reason: "REPLAY_CONFIRMATION_REQUIRED",
        impact: { requiresConfirmation: true },
      },
    });
    const confirmed = await recordAssembly(db, { ...command, confirm: true }, ACTOR);
    expect(confirmed.assembly.id).toBeTruthy();
  });

  it("previews create impact identically without writing an assembly", async () => {
    const db = createDb(env.DB);
    const component = await createComponent(db, "Componente preview", "PACKAGING", 1000);
    const laterOutput = await createFinished(db, "Salida preview futura");
    await recordAssemblyDefinition(
      db,
      {
        name: `Definición preview ${crypto.randomUUID()}`,
        outputItemId: laterOutput.id,
        outputQty: 1000,
        lines: [{ itemId: component.id, qty: 1000 }],
      },
      ACTOR,
    );
    const later = await recordSimpleAssembly(db, {
      componentId: component.id,
      outputId: laterOutput.id,
      occurredAt: "2026-08-12T15:00:00.000Z",
      businessDate: "2026-08-12",
    });
    const previewOutput = await createFinished(db, "Salida preview retroactiva");
    const sessionId = await createProductionSession(db);
    const command = {
      occurredAt: "2026-08-10T15:00:00.000Z",
      businessDate: "2026-08-10",
      sessionId,
      outputItemId: previewOutput.id,
      actualOutputQty: 1000,
      lines: [{ itemId: component.id, qty: 1000 }],
    };
    const before = await listAssemblies(db);
    const impact = await previewAssemblyImpact(db, { op: "create", command });
    const after = await listAssemblies(db);
    expect(after.assemblies.map((assembly) => assembly.id)).toEqual(
      before.assemblies.map((assembly) => assembly.id),
    );
    expect(impact).toMatchObject({
      affectedAssemblyIds: expect.arrayContaining([later.result.assembly.id]),
      requiresConfirmation: true,
    });

    let refusal: unknown;
    try {
      await recordAssembly(db, command, ACTOR);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: "CONFLICT" });
    const refusedImpact = (refusal as { details: { impact: typeof impact } }).details.impact;
    const alreadyRecordedIds = new Set(before.assemblies.map((assembly) => assembly.id));
    const normalize = (value: typeof impact) => ({
      ...value,
      // The preview and mutation each allocate their own pending event id. Compare the impact on
      // already-recorded assemblies, which is the owner-visible R-5 fact the preview promises.
      affectedAssemblyIds: value.affectedAssemblyIds.filter((id) => alreadyRecordedIds.has(id)),
    });
    expect(normalize(refusedImpact)).toEqual(normalize(impact));
  });
});

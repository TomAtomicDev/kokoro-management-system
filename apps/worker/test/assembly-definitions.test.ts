import { env } from "cloudflare:test";
import { rateFromTotal, toCentavos, toMilliCentavosPerUnit, toMilliUnits } from "@kokoro/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  getAssemblyDefinition,
  listAssemblyDefinitions,
  recordAssemblyDefinition,
  setAssemblyDefinitionActive,
  updateAssemblyDefinition,
} from "../src/core/assemblies/index.js";
import { createItem } from "../src/core/catalog/index.js";
import { createDb } from "../src/db/index.js";
import { items } from "../src/db/schema.js";

const ACTOR = "OWNER_WEB" as const;
type Db = ReturnType<typeof createDb>;

async function createFinished(db: Db, unit: "UNIT" | "KG" = "UNIT") {
  return createItem(
    db,
    {
      name: `Terminado ${crypto.randomUUID()}`,
      kind: "FINISHED",
      category: "OTHER",
      unit,
      salePriceMc: toMilliCentavosPerUnit(8_000_000),
      minStockQty: null,
    },
    ACTOR,
  );
}

async function createComponent(
  db: Db,
  kind: "SEMI_FINISHED" | "FINISHED" | "PACKAGING" = "PACKAGING",
  wac = 10,
  replacement = 12,
) {
  const name = `Componente ${crypto.randomUUID()}`;
  const item =
    kind === "FINISHED"
      ? await createItem(
          db,
          {
            name,
            kind,
            category: "OTHER",
            unit: "UNIT",
            salePriceMc: toMilliCentavosPerUnit(5_000_000),
            minStockQty: null,
          },
          ACTOR,
        )
      : kind === "PACKAGING"
        ? await createItem(
            db,
            { name, kind, category: "NOT_EATABLE", unit: "UNIT", minStockQty: 0 },
            ACTOR,
          )
        : await createItem(
            db,
            { name, kind, category: "OTHER", unit: "UNIT", minStockQty: null },
            ACTOR,
          );
  await db
    .update(items)
    .set({
      wacMc: rateFromTotal(toCentavos(wac), toMilliUnits(1)),
      replacementCostMc: rateFromTotal(toCentavos(replacement), toMilliUnits(1)),
      replacementCostUpdatedAt: "2026-08-12T00:00:00.000Z",
    })
    .where(eq(items.id, item.id));
  return item;
}

async function createRaw(db: Db) {
  return createItem(
    db,
    {
      name: `Materia prima ${crypto.randomUUID()}`,
      kind: "RAW_MATERIAL",
      category: "INGREDIENT",
      unit: "KG",
      minStockQty: 0,
    },
    ACTOR,
  );
}

describe("assembly definition CRUD", () => {
  it("creates, gets, lists, updates, deactivates, and reactivates a definition", async () => {
    const db = createDb(env.DB);
    const output = await createFinished(db);
    const bottle = await createComponent(db, "PACKAGING", 2, 3);
    const kefir = await createComponent(db, "SEMI_FINISHED", 10, 12);

    const created = await recordAssemblyDefinition(
      db,
      {
        name: `Kéfir 500 ml ${crypto.randomUUID()}`,
        outputItemId: output.id,
        outputQty: 1000,
        isDefault: true,
        notes: null,
        lines: [
          { itemId: bottle.id, qty: 1000 },
          { itemId: kefir.id, qty: 500 },
        ],
      },
      ACTOR,
    );

    expect(created.assemblyDefinition).toMatchObject({
      outputItemId: output.id,
      outputQty: 1000,
      isDefault: true,
      isActive: true,
    });
    expect(created.assemblyDefinition.lines).toHaveLength(2);
    expect(created.assemblyDefinition.costWac.costPerOutputUnit).toBe(7000);
    expect(created.assemblyDefinition.costReplacement.costPerOutputUnit).toBe(9000);
    expect(created.settings.minMarginPct).toBe(3000);

    const fetched = await getAssemblyDefinition(db, created.assemblyDefinition.id);
    expect(fetched.assemblyDefinition.id).toBe(created.assemblyDefinition.id);

    const updated = await updateAssemblyDefinition(
      db,
      created.assemblyDefinition.id,
      {
        name: `${created.assemblyDefinition.name} editado`,
        outputItemId: output.id,
        outputQty: 2000,
        isDefault: false,
        notes: "Nueva presentación",
        lines: [{ itemId: bottle.id, qty: 2000 }],
      },
      ACTOR,
    );
    expect(updated.assemblyDefinition.lines).toHaveLength(1);
    expect(updated.assemblyDefinition.outputQty).toBe(2000);
    expect(updated.assemblyDefinition.costWac.costPerOutputUnit).toBe(2000);

    const deactivated = await setAssemblyDefinitionActive(
      db,
      { id: created.assemblyDefinition.id, isActive: false },
      ACTOR,
    );
    expect(deactivated.assemblyDefinition.isActive).toBe(false);
    const inactive = await listAssemblyDefinitions(db, {
      outputItemId: output.id,
      isActive: false,
    });
    expect(inactive.assemblyDefinitions.map((definition) => definition.id)).toContain(
      created.assemblyDefinition.id,
    );

    const reactivated = await setAssemblyDefinitionActive(
      db,
      { id: created.assemblyDefinition.id, isActive: true },
      ACTOR,
    );
    expect(reactivated.assemblyDefinition.isActive).toBe(true);

    const auditRows = await db.query.auditLog.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.entityId, created.assemblyDefinition.id),
    });
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["create", "update", "deactivate", "activate"]),
    );
    expect(auditRows.every((row) => row.entityType === "assembly_definition")).toBe(true);
  });

  it("clears the previous active default for the same output", async () => {
    const db = createDb(env.DB);
    const output = await createFinished(db);
    const component = await createComponent(db);
    const first = await recordAssemblyDefinition(
      db,
      {
        name: `Primera ${crypto.randomUUID()}`,
        outputItemId: output.id,
        outputQty: 1000,
        isDefault: true,
        lines: [{ itemId: component.id, qty: 1000 }],
      },
      ACTOR,
    );
    const second = await recordAssemblyDefinition(
      db,
      {
        name: `Segunda ${crypto.randomUUID()}`,
        outputItemId: output.id,
        outputQty: 1000,
        isDefault: true,
        lines: [{ itemId: component.id, qty: 1000 }],
      },
      ACTOR,
    );
    expect(
      (await getAssemblyDefinition(db, first.assemblyDefinition.id)).assemblyDefinition.isDefault,
    ).toBe(false);
    expect(second.assemblyDefinition.isDefault).toBe(true);
  });

  it("clears the previous active default when another definition is updated to default", async () => {
    const db = createDb(env.DB);
    const output = await createFinished(db);
    const component = await createComponent(db);
    const first = await recordAssemblyDefinition(
      db,
      {
        name: `Predeterminada ${crypto.randomUUID()}`,
        outputItemId: output.id,
        outputQty: 1000,
        isDefault: true,
        lines: [{ itemId: component.id, qty: 1000 }],
      },
      ACTOR,
    );
    const second = await recordAssemblyDefinition(
      db,
      {
        name: `Alternativa ${crypto.randomUUID()}`,
        outputItemId: output.id,
        outputQty: 1000,
        isDefault: false,
        lines: [{ itemId: component.id, qty: 1000 }],
      },
      ACTOR,
    );

    await updateAssemblyDefinition(
      db,
      second.assemblyDefinition.id,
      {
        name: second.assemblyDefinition.name,
        outputItemId: output.id,
        outputQty: 1000,
        isDefault: true,
        lines: [{ itemId: component.id, qty: 1000 }],
      },
      ACTOR,
    );

    expect(
      (await getAssemblyDefinition(db, first.assemblyDefinition.id)).assemblyDefinition.isDefault,
    ).toBe(false);
    expect(
      (await getAssemblyDefinition(db, second.assemblyDefinition.id)).assemblyDefinition.isDefault,
    ).toBe(true);
  });
});

describe("assembly definition guards", () => {
  it("rejects a duplicate active name but allows reuse after deactivation", async () => {
    const db = createDb(env.DB);
    const output = await createFinished(db);
    const component = await createComponent(db);
    const name = `Desayuno Kokoro ${crypto.randomUUID()}`;
    const first = await recordAssemblyDefinition(
      db,
      { name, outputItemId: output.id, outputQty: 1000, lines: [{ itemId: component.id, qty: 1 }] },
      ACTOR,
    );
    await expect(
      recordAssemblyDefinition(
        db,
        {
          name,
          outputItemId: output.id,
          outputQty: 1000,
          lines: [{ itemId: component.id, qty: 1 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await setAssemblyDefinitionActive(
      db,
      { id: first.assemblyDefinition.id, isActive: false },
      ACTOR,
    );
    await expect(
      recordAssemblyDefinition(
        db,
        {
          name,
          outputItemId: output.id,
          outputQty: 1000,
          lines: [{ itemId: component.id, qty: 1 }],
        },
        ACTOR,
      ),
    ).resolves.toMatchObject({ assemblyDefinition: { name } });
  });

  it("rejects an output that is not FINISHED/UNIT and a RAW_MATERIAL component", async () => {
    const db = createDb(env.DB);
    const wrongUnitOutput = await createFinished(db, "KG");
    const validOutput = await createFinished(db);
    const component = await createComponent(db);
    const raw = await createRaw(db);

    await expect(
      recordAssemblyDefinition(
        db,
        {
          name: `Unidad inválida ${crypto.randomUUID()}`,
          outputItemId: wrongUnitOutput.id,
          outputQty: 1000,
          lines: [{ itemId: component.id, qty: 1 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      recordAssemblyDefinition(
        db,
        {
          name: `Componente inválido ${crypto.randomUUID()}`,
          outputItemId: validOutput.id,
          outputQty: 1000,
          lines: [{ itemId: raw.id, qty: 1 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects direct and transitive cycles with CONFLICT", async () => {
    const db = createDb(env.DB);
    const outputA = await createFinished(db);
    const outputB = await createFinished(db);

    await expect(
      recordAssemblyDefinition(
        db,
        {
          name: `Autociclo ${crypto.randomUUID()}`,
          outputItemId: outputA.id,
          outputQty: 1000,
          lines: [{ itemId: outputA.id, qty: 1000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await recordAssemblyDefinition(
      db,
      {
        name: `B contiene A ${crypto.randomUUID()}`,
        outputItemId: outputB.id,
        outputQty: 1000,
        lines: [{ itemId: outputA.id, qty: 1000 }],
      },
      ACTOR,
    );
    await expect(
      recordAssemblyDefinition(
        db,
        {
          name: `A contiene B ${crypto.randomUUID()}`,
          outputItemId: outputA.id,
          outputQty: 1000,
          lines: [{ itemId: outputB.id, qty: 1000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a cycle introduced by update", async () => {
    const db = createDb(env.DB);
    const outputA = await createFinished(db);
    const outputB = await createFinished(db);
    const packaging = await createComponent(db);
    const definitionA = await recordAssemblyDefinition(
      db,
      {
        name: `A editable ${crypto.randomUUID()}`,
        outputItemId: outputA.id,
        outputQty: 1000,
        lines: [{ itemId: packaging.id, qty: 1 }],
      },
      ACTOR,
    );
    await recordAssemblyDefinition(
      db,
      {
        name: `B contiene A ${crypto.randomUUID()}`,
        outputItemId: outputB.id,
        outputQty: 1000,
        lines: [{ itemId: outputA.id, qty: 1000 }],
      },
      ACTOR,
    );
    await expect(
      updateAssemblyDefinition(
        db,
        definitionA.assemblyDefinition.id,
        {
          name: definitionA.assemblyDefinition.name,
          outputItemId: outputA.id,
          outputQty: 1000,
          isDefault: false,
          lines: [{ itemId: outputB.id, qty: 1000 }],
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

import { describe, expect, it } from "vitest";

import {
  assemblyImpactRequestSchema,
  deleteAssemblyCommandSchema,
  listAssembliesFiltersSchema,
  recordAssemblyCommandSchema,
  updateAssemblyCommandSchema,
} from "./assembly-events.js";

describe("recordAssemblyCommandSchema", () => {
  const valid = {
    occurredAt: "2026-08-12T15:00:00.000Z",
    businessDate: "2026-08-12",
    sessionId: "session_1",
    outputItemId: "output_1",
    actualOutputQty: 5000,
    lines: [{ itemId: "component_1", qty: 5000 }],
  };

  it("accepts a definition-free assembly without a confirm field", () => {
    expect(recordAssemblyCommandSchema.parse(valid)).toEqual({ ...valid, confirm: false });
    expect(recordAssemblyCommandSchema.parse({ ...valid, confirm: true }).confirm).toBe(true);
  });

  it("requires session, actual output, and at least one positive component line", () => {
    expect(recordAssemblyCommandSchema.safeParse({ ...valid, sessionId: "" }).success).toBe(false);
    expect(recordAssemblyCommandSchema.safeParse({ ...valid, actualOutputQty: 0 }).success).toBe(
      false,
    );
    expect(recordAssemblyCommandSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
  });

  it("reuses production's business-date and occurred-at validation", () => {
    expect(
      recordAssemblyCommandSchema.safeParse({ ...valid, businessDate: "12/08/2026" }).success,
    ).toBe(false);
    expect(recordAssemblyCommandSchema.safeParse({ ...valid, occurredAt: "today" }).success).toBe(
      false,
    );
  });
});

describe("assembly mutation schemas", () => {
  const command = {
    occurredAt: "2026-08-12T15:00:00.000Z",
    businessDate: "2026-08-12",
    sessionId: "session_1",
    outputItemId: "output_1",
    actualOutputQty: 5000,
    lines: [{ itemId: "component_1", qty: 5000 }],
  };

  it("defaults confirmation for update and delete", () => {
    expect(updateAssemblyCommandSchema.parse(command).confirm).toBe(false);
    expect(deleteAssemblyCommandSchema.parse({}).confirm).toBe(false);
  });

  it("accepts create, update, and delete impact requests", () => {
    expect(assemblyImpactRequestSchema.safeParse({ op: "create", command }).success).toBe(true);
    expect(
      assemblyImpactRequestSchema.safeParse({ op: "update", id: "assembly_1", command }).success,
    ).toBe(true);
    expect(assemblyImpactRequestSchema.safeParse({ op: "delete", id: "assembly_1" }).success).toBe(
      true,
    );
  });
});

describe("listAssembliesFiltersSchema", () => {
  it("coerces and bounds limit", () => {
    expect(listAssembliesFiltersSchema.parse({ limit: "25" }).limit).toBe(25);
    expect(listAssembliesFiltersSchema.safeParse({ limit: "501" }).success).toBe(false);
  });
});

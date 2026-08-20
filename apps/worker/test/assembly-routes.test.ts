// Route-level tests for assembly-event endpoints (KOK-166): GET/POST /api/assemblies,
// GET/PATCH/DELETE /api/assemblies/:id, POST /api/assemblies/:id/restore, POST /api/assemblies/impact.
// The service-level assertions (cost math, kardex, R-2/R-5 replay) live in test/assemblies.test.ts;
// this file only proves the Hono wiring — auth gate, status codes, body shape. Mirrors
// test/production-runs-routes.test.ts's exact pattern (`SELF.fetch`, the `login()` helper).
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { assemblies, auditLog, items, stockMovements } from "../src/db/schema.js";

const DEV_PASSWORD = "test-password-123";
const OCCURRED_AT = "2026-07-20T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-20";

function getCookieValue(setCookieHeader: string | null, name: string): string | undefined {
  if (!setCookieHeader) return undefined;
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookieHeader);
  return match?.[1];
}

async function login(): Promise<{ cookie: string; csrf: string }> {
  const res = await SELF.fetch("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DEV_PASSWORD }),
  });
  const setCookie = res.headers.get("set-cookie");
  const session = getCookieValue(setCookie, "kokoro_session");
  const csrf = getCookieValue(setCookie, "kokoro_csrf");
  if (!session || !csrf) throw new Error("login did not return session/csrf cookies");
  return { cookie: `kokoro_session=${session}; kokoro_csrf=${csrf}`, csrf };
}

function authHeaders(auth: { cookie: string; csrf: string }) {
  return { "content-type": "application/json", cookie: auth.cookie, "X-CSRF-Token": auth.csrf };
}

async function createOutputItem(
  auth: { cookie: string; csrf: string },
  name: string,
): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/items", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({
      name,
      kind: "FINISHED",
      category: "OTHER",
      unit: "UNIT",
      salePriceMc: 8_000_000,
      minStockQty: null,
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  return created.id;
}

async function createComponentItem(
  auth: { cookie: string; csrf: string },
  name: string,
  wacCentavos: number,
): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/items", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({
      name,
      kind: "PACKAGING",
      category: "NOT_EATABLE",
      unit: "UNIT",
      minStockQty: 0,
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  const db = createDb(env.DB);
  await db
    .update(items)
    // scale-factor-ok: test fixture converts a Centavos input into the milli-centavos DB column
    .set({ wacMc: wacCentavos * 1000 })
    .where(eq(items.id, created.id));
  return created.id;
}

interface AssemblyBody {
  outputItemId: string;
  actualOutputQty: number;
  occurredAt: string;
  businessDate: string;
  lines: { itemId: string; qty: number }[];
  confirm?: boolean;
}

async function recordAssemblyEvent(
  auth: { cookie: string; csrf: string },
  body: AssemblyBody,
): Promise<{ res: Response; json: unknown }> {
  const res = await SELF.fetch("https://example.com/api/assemblies", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

interface AssemblyDtoShape {
  assembly: { id: string; directCost: number; deletedAt?: string | null };
}

async function seedAssemblyCommand(
  auth: { cookie: string; csrf: string },
  namePrefix: string,
): Promise<AssemblyBody> {
  const outputItemId = await createOutputItem(auth, `${namePrefix} — salida`);
  const componentId = await createComponentItem(auth, `${namePrefix} — componente`, 10);
  return {
    outputItemId,
    actualOutputQty: 1000,
    occurredAt: OCCURRED_AT,
    businessDate: BUSINESS_DATE,
    lines: [{ itemId: componentId, qty: 1000 }],
  };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "assembly"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "assembly"));
  await db.delete(assemblies);
});

describe("POST /api/assemblies", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assemblies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("records an assembly and returns its direct cost", async () => {
    const auth = await login();
    const command = await seedAssemblyCommand(auth, "Route assembly record");

    const { res, json } = await recordAssemblyEvent(auth, command);
    expect(res.status).toBe(201);
    const body = json as AssemblyDtoShape;
    // component wac=10 * qty 1000 milli-units (1 whole unit) -> direct cost 10 (centavos).
    expect(body.assembly.directCost).toBe(10);
  });

  it("rejects an empty lines array with 400 VALIDATION", async () => {
    const auth = await login();
    const outputItemId = await createOutputItem(auth, "Route assembly empty lines output");

    const { res, json } = await recordAssemblyEvent(auth, {
      outputItemId,
      actualOutputQty: 1000,
      occurredAt: OCCURRED_AT,
      businessDate: BUSINESS_DATE,
      lines: [],
    });
    expect(res.status).toBe(400);
    expect((json as { code: string }).code).toBe("VALIDATION");
  });
});

describe("GET /api/assemblies/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assemblies/whatever");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent assembly", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/assemblies/does-not-exist", {
      headers: { cookie: auth.cookie },
    });
    expect(res.status).toBe(404);
  });

  it("fetches a recorded assembly by id", async () => {
    const auth = await login();
    const command = await seedAssemblyCommand(auth, "Route assembly get");
    const { json: created } = await recordAssemblyEvent(auth, command);
    const assemblyId = (created as AssemblyDtoShape).assembly.id;

    const res = await SELF.fetch(`https://example.com/api/assemblies/${assemblyId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AssemblyDtoShape;
    expect(body.assembly.id).toBe(assemblyId);
  });
});

describe("PATCH /api/assemblies/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assemblies/whatever", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("edits an assembly and returns the recomputed cost", async () => {
    const auth = await login();
    const command = await seedAssemblyCommand(auth, "Route assembly edit");
    const { json: created } = await recordAssemblyEvent(auth, command);
    const assemblyId = (created as AssemblyDtoShape).assembly.id;

    const res = await SELF.fetch(`https://example.com/api/assemblies/${assemblyId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({ ...command, actualOutputQty: 2000 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AssemblyDtoShape;
    expect(body.assembly.id).toBe(assemblyId);
  });

  it("returns 404 for a nonexistent assembly", async () => {
    const auth = await login();
    const command = await seedAssemblyCommand(auth, "Route assembly edit missing");
    const res = await SELF.fetch("https://example.com/api/assemblies/does-not-exist", {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify(command),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/assemblies/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assemblies/whatever", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("soft-deletes an assembly with no body at all (plain delete, no confirmation needed)", async () => {
    const auth = await login();
    const command = await seedAssemblyCommand(auth, "Route assembly delete");
    const { json: created } = await recordAssemblyEvent(auth, command);
    const assemblyId = (created as AssemblyDtoShape).assembly.id;

    const res = await SELF.fetch(`https://example.com/api/assemblies/${assemblyId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AssemblyDtoShape;
    expect(body.assembly.id).toBe(assemblyId);

    const getRes = await SELF.fetch(`https://example.com/api/assemblies/${assemblyId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for a nonexistent assembly", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/assemblies/does-not-exist", {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/assemblies/:id/restore", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assemblies/whatever/restore", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("restores a soft-deleted assembly, and it becomes visible via GET again", async () => {
    const auth = await login();
    const command = await seedAssemblyCommand(auth, "Route assembly restore");
    const { json: created } = await recordAssemblyEvent(auth, command);
    const assemblyId = (created as AssemblyDtoShape).assembly.id;

    await SELF.fetch(`https://example.com/api/assemblies/${assemblyId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });

    const restoreRes = await SELF.fetch(
      `https://example.com/api/assemblies/${assemblyId}/restore`,
      {
        method: "POST",
        headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
      },
    );
    expect(restoreRes.status).toBe(200);

    const getRes = await SELF.fetch(`https://example.com/api/assemblies/${assemblyId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(200);
  });

  it("returns 404 for an assembly that is not currently deleted", async () => {
    const auth = await login();
    const command = await seedAssemblyCommand(auth, "Route assembly restore not-deleted");
    const { json: created } = await recordAssemblyEvent(auth, command);
    const assemblyId = (created as AssemblyDtoShape).assembly.id;

    const res = await SELF.fetch(`https://example.com/api/assemblies/${assemblyId}/restore`, {
      method: "POST",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/assemblies/impact", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assemblies/impact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "delete", id: "whatever" }),
    });
    expect(res.status).toBe(401);
  });

  it("op=create: returns a sane impact shape and writes nothing", async () => {
    const auth = await login();
    const command = await seedAssemblyCommand(auth, "Route assembly impact create");

    const res = await SELF.fetch("https://example.com/api/assemblies/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ op: "create", command }),
    });
    expect(res.status).toBe(200);
    const impact = (await res.json()) as { requiresConfirmation: boolean; costDelta: number };
    expect(typeof impact.requiresConfirmation).toBe("boolean");
    expect(typeof impact.costDelta).toBe("number");

    const listRes = await SELF.fetch(
      `https://example.com/api/assemblies?outputItemId=${command.outputItemId}`,
      { headers: { cookie: auth.cookie } },
    );
    const { assemblies: listed } = (await listRes.json()) as { assemblies: { id: string }[] };
    expect(listed).toHaveLength(0);
  });

  it("rejects a body with no op with 400 VALIDATION", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/assemblies/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("VALIDATION");
  });
});

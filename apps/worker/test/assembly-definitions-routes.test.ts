// Route-level tests for assembly-definition endpoints (KOK-166): GET/POST /api/assembly-definitions,
// GET/PATCH /api/assembly-definitions/:id, POST /api/assembly-definitions/:id/active. The
// service-level assertions (cost math, default-clearing, audit rows) live in
// test/assembly-definitions.test.ts; this file only proves the Hono wiring — auth gate, status
// codes, body shape. Mirrors test/production-runs-routes.test.ts's exact pattern (`SELF.fetch`, the
// `login()` helper).
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { assemblyDefinitions, items } from "../src/db/schema.js";

const DEV_PASSWORD = "test-password-123";

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

interface DefinitionBody {
  name: string;
  outputItemId: string;
  outputQty: number;
  isDefault?: boolean;
  notes?: string | null;
  lines: { itemId: string; qty: number }[];
}

async function createDefinition(
  auth: { cookie: string; csrf: string },
  body: DefinitionBody,
): Promise<{ res: Response; json: unknown }> {
  const res = await SELF.fetch("https://example.com/api/assembly-definitions", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

interface DefinitionDtoShape {
  assemblyDefinition: { id: string; outputQty: number; isActive: boolean; isDefault: boolean };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(assemblyDefinitions);
});

describe("POST /api/assembly-definitions", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assembly-definitions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("creates a definition and returns its cost breakdown", async () => {
    const auth = await login();
    const outputItemId = await createOutputItem(auth, "Route definition output");
    const componentId = await createComponentItem(auth, "Route definition component", 10);

    const { res, json } = await createDefinition(auth, {
      name: `Route definition ${crypto.randomUUID()}`,
      outputItemId,
      outputQty: 1000,
      isDefault: true,
      lines: [{ itemId: componentId, qty: 1000 }],
    });
    expect(res.status).toBe(201);
    const body = json as DefinitionDtoShape;
    expect(body.assemblyDefinition.outputQty).toBe(1000);
    expect(body.assemblyDefinition.isActive).toBe(true);
    expect(body.assemblyDefinition.isDefault).toBe(true);
  });

  it("rejects an empty lines array with 400 VALIDATION", async () => {
    const auth = await login();
    const outputItemId = await createOutputItem(auth, "Route definition empty lines output");

    const { res, json } = await createDefinition(auth, {
      name: `Route definition ${crypto.randomUUID()}`,
      outputItemId,
      outputQty: 1000,
      lines: [],
    });
    expect(res.status).toBe(400);
    expect((json as { code: string }).code).toBe("VALIDATION");
  });
});

describe("GET /api/assembly-definitions/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assembly-definitions/whatever");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent definition", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/assembly-definitions/does-not-exist", {
      headers: { cookie: auth.cookie },
    });
    expect(res.status).toBe(404);
  });

  it("fetches a created definition by id", async () => {
    const auth = await login();
    const outputItemId = await createOutputItem(auth, "Route definition get output");
    const componentId = await createComponentItem(auth, "Route definition get component", 10);
    const { json: created } = await createDefinition(auth, {
      name: `Route definition get ${crypto.randomUUID()}`,
      outputItemId,
      outputQty: 1000,
      lines: [{ itemId: componentId, qty: 1000 }],
    });
    const definitionId = (created as DefinitionDtoShape).assemblyDefinition.id;

    const res = await SELF.fetch(`https://example.com/api/assembly-definitions/${definitionId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DefinitionDtoShape;
    expect(body.assemblyDefinition.id).toBe(definitionId);
  });
});

describe("GET /api/assembly-definitions", () => {
  it("lists definitions for an output item", async () => {
    const auth = await login();
    const outputItemId = await createOutputItem(auth, "Route definition list output");
    const componentId = await createComponentItem(auth, "Route definition list component", 10);
    await createDefinition(auth, {
      name: `Route definition list ${crypto.randomUUID()}`,
      outputItemId,
      outputQty: 1000,
      lines: [{ itemId: componentId, qty: 1000 }],
    });

    const res = await SELF.fetch(
      `https://example.com/api/assembly-definitions?outputItemId=${outputItemId}`,
      { headers: { cookie: auth.cookie } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assemblyDefinitions: { outputItemId: string }[] };
    expect(body.assemblyDefinitions.length).toBeGreaterThan(0);
    expect(body.assemblyDefinitions.every((d) => d.outputItemId === outputItemId)).toBe(true);
  });
});

describe("PATCH /api/assembly-definitions/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assembly-definitions/whatever", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("edits a definition and returns the recomputed cost", async () => {
    const auth = await login();
    const outputItemId = await createOutputItem(auth, "Route definition edit output");
    const componentId = await createComponentItem(auth, "Route definition edit component", 10);
    const { json: created } = await createDefinition(auth, {
      name: `Route definition edit ${crypto.randomUUID()}`,
      outputItemId,
      outputQty: 1000,
      lines: [{ itemId: componentId, qty: 1000 }],
    });
    const definitionId = (created as DefinitionDtoShape).assemblyDefinition.id;

    const res = await SELF.fetch(`https://example.com/api/assembly-definitions/${definitionId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: "Route definition edited",
        outputItemId,
        outputQty: 2000,
        lines: [{ itemId: componentId, qty: 2000 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DefinitionDtoShape;
    expect(body.assemblyDefinition.outputQty).toBe(2000);
  });

  it("returns 404 for a nonexistent definition", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/assembly-definitions/does-not-exist", {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        name: "irrelevant",
        outputItemId: "irrelevant",
        outputQty: 1000,
        lines: [{ itemId: "irrelevant", qty: 1000 }],
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/assembly-definitions/:id/active", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/assembly-definitions/whatever/active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(401);
  });

  it("deactivates and reactivates a definition", async () => {
    const auth = await login();
    const outputItemId = await createOutputItem(auth, "Route definition toggle output");
    const componentId = await createComponentItem(auth, "Route definition toggle component", 10);
    const { json: created } = await createDefinition(auth, {
      name: `Route definition toggle ${crypto.randomUUID()}`,
      outputItemId,
      outputQty: 1000,
      lines: [{ itemId: componentId, qty: 1000 }],
    });
    const definitionId = (created as DefinitionDtoShape).assemblyDefinition.id;

    const deactivateRes = await SELF.fetch(
      `https://example.com/api/assembly-definitions/${definitionId}/active`,
      { method: "POST", headers: authHeaders(auth), body: JSON.stringify({ isActive: false }) },
    );
    expect(deactivateRes.status).toBe(200);
    expect(((await deactivateRes.json()) as DefinitionDtoShape).assemblyDefinition.isActive).toBe(
      false,
    );

    const reactivateRes = await SELF.fetch(
      `https://example.com/api/assembly-definitions/${definitionId}/active`,
      { method: "POST", headers: authHeaders(auth), body: JSON.stringify({ isActive: true }) },
    );
    expect(reactivateRes.status).toBe(200);
    expect(((await reactivateRes.json()) as DefinitionDtoShape).assemblyDefinition.isActive).toBe(
      true,
    );
  });

  it("returns 404 for a nonexistent definition", async () => {
    const auth = await login();
    const res = await SELF.fetch(
      "https://example.com/api/assembly-definitions/does-not-exist/active",
      { method: "POST", headers: authHeaders(auth), body: JSON.stringify({ isActive: false }) },
    );
    expect(res.status).toBe(404);
  });
});

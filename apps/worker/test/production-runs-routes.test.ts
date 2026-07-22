// Route-level tests for production run endpoints (KOK-026): GET/POST /api/production-runs,
// GET/PATCH/DELETE /api/production-runs/:id, POST /api/production-runs/:id/restore, POST
// /api/production-runs/impact. The service-level assertions (kardex, C-4 math, WAC replay, R-4/R-5
// math) live in test/production-runs.test.ts; this file only proves the Hono wiring — auth/CSRF
// gate, status codes, body shape, and that the R-5 confirmation contract (409 CONFLICT carrying
// `details.impact`, then a `confirm: true` retry) survives the HTTP boundary end to end. Mirrors
// test/purchasing-routes.test.ts's exact pattern (`SELF.fetch`, the `login()` helper).
import { env, SELF } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { auditLog, productionRuns, stockMovements } from "../src/db/schema.js";

const DEV_PASSWORD = "test-password-123";
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

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

async function createItem(
  auth: { cookie: string; csrf: string },
  name: string,
  kind: "RAW_MATERIAL" | "SEMI_FINISHED" | "FINISHED" = "RAW_MATERIAL",
): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/items", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ name, kind, category: "INGREDIENT", unit: "KG" }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  return created.id;
}

async function createRecipe(
  auth: { cookie: string; csrf: string },
  outputItemId: string,
  lines: { itemId: string; qty: number }[],
  expectedYieldQty = 1000,
): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/recipes", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({
      name: `Route recipe for ${outputItemId}`,
      outputItemId,
      expectedYieldQty,
      lines,
    }),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as { recipe: { id: string } };
  return created.recipe.id;
}

interface ProductionRunBody {
  recipeId: string;
  batches: number;
  actualOutputQty: number;
  indirectCost?: number;
  occurredAt: string;
  businessDate: string;
  lines: { itemId: string; qty: number }[];
  confirm?: boolean;
}

async function createProductionRun(
  auth: { cookie: string; csrf: string },
  body: ProductionRunBody,
): Promise<{ res: Response; json: unknown }> {
  const res = await SELF.fetch("https://example.com/api/production-runs", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

interface ProductionRunDtoShape {
  productionRun: {
    id: string;
    directCost: number;
    totalCost: number;
    outputUnitCost: number;
    deletedAt?: string | null;
  };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.delete(auditLog).where(eq(auditLog.entityType, "production_runs"));
  await db.delete(stockMovements).where(eq(stockMovements.sourceEventType, "production_run"));
  await db.delete(productionRuns);
});

describe("POST /api/production-runs", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/production-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("records a run and returns the C-4 costs", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw");
    const outputItemId = await createItem(auth, "Route production output", "SEMI_FINISHED");
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);

    const { res, json } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      indirectCost: 100,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    expect(res.status).toBe(201);
    const body = json as ProductionRunDtoShape;
    // rawItem never purchased -> wac=0 -> direct=0 -> total=indirectCost=100.
    expect(body.productionRun.directCost).toBe(0);
    expect(body.productionRun.totalCost).toBe(100);
    expect(body.productionRun.outputUnitCost).toBe(200); // 100*1000/500
  });

  it("rejects a FINISHED consumption item with 400 VALIDATION", async () => {
    const auth = await login();
    const finishedItemId = await createItem(auth, "Route production finished", "FINISHED");
    const rawItemId = await createItem(auth, "Route production raw for finished check");
    const outputItemId = await createItem(
      auth,
      "Route production output finished",
      "SEMI_FINISHED",
    );
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);

    const { res, json } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: finishedItemId, qty: 100 }],
    });
    expect(res.status).toBe(400);
    expect((json as { code: string }).code).toBe("VALIDATION");
  });

  it("rejects an unknown recipe with 404 NOT_FOUND", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw for missing recipe");

    const { res } = await createProductionRun(auth, {
      recipeId: "does-not-exist",
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/production-runs/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/production-runs/whatever");
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent run", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/production-runs/does-not-exist", {
      headers: { cookie: auth.cookie },
    });
    expect(res.status).toBe(404);
  });

  it("fetches a recorded run by id", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw for get");
    const outputItemId = await createItem(auth, "Route production output for get", "SEMI_FINISHED");
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);
    const { json: created } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    const runId = (created as ProductionRunDtoShape).productionRun.id;

    const res = await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(runId);
  });
});

describe("PATCH /api/production-runs/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/production-runs/whatever", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("edits a run and returns the recomputed costs", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw for edit");
    const outputItemId = await createItem(
      auth,
      "Route production output for edit",
      "SEMI_FINISHED",
    );
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);
    const { json: created } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      indirectCost: 100,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    const runId = (created as ProductionRunDtoShape).productionRun.id;

    const res = await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        recipeId,
        batches: 1,
        actualOutputQty: 500,
        indirectCost: 500,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: rawItemId, qty: 100 }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProductionRunDtoShape;
    expect(body.productionRun.totalCost).toBe(500);
  });

  it("rejects an empty lines array with 400 VALIDATION", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw for empty edit");
    const outputItemId = await createItem(
      auth,
      "Route production output for empty edit",
      "SEMI_FINISHED",
    );
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);
    const { json: created } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    const runId = (created as ProductionRunDtoShape).productionRun.id;

    const res = await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        recipeId,
        batches: 1,
        actualOutputQty: 500,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [],
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("VALIDATION");
  });

  it("returns 404 for a nonexistent run", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/production-runs/does-not-exist", {
      method: "PATCH",
      headers: authHeaders(auth),
      body: JSON.stringify({
        recipeId: "irrelevant",
        batches: 1,
        actualOutputQty: 100,
        occurredAt: NOW,
        businessDate: BUSINESS_DATE,
        lines: [{ itemId: "irrelevant", qty: 100 }],
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/production-runs/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/production-runs/whatever", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("soft-deletes a run with no body at all (plain delete, no confirmation needed)", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw for delete");
    const outputItemId = await createItem(
      auth,
      "Route production output for delete",
      "SEMI_FINISHED",
    );
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);
    const { json: created } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    const runId = (created as ProductionRunDtoShape).productionRun.id;

    const res = await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProductionRunDtoShape;
    expect(body.productionRun.id).toBe(runId);

    const getRes = await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(404);
  });

  it("rejects a non-boolean confirm with 400 VALIDATION", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw for bad confirm");
    const outputItemId = await createItem(
      auth,
      "Route production output for bad confirm",
      "SEMI_FINISHED",
    );
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);
    const { json: created } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    const runId = (created as ProductionRunDtoShape).productionRun.id;

    const res = await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      method: "DELETE",
      headers: authHeaders(auth),
      body: JSON.stringify({ confirm: "yes" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("VALIDATION");
  });

  it("returns 404 for a nonexistent run", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/production-runs/does-not-exist", {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/production-runs/:id/restore", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/production-runs/whatever/restore", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("restores a soft-deleted run, and it becomes visible via GET again", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw for restore");
    const outputItemId = await createItem(
      auth,
      "Route production output for restore",
      "SEMI_FINISHED",
    );
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);
    const { json: created } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    const runId = (created as ProductionRunDtoShape).productionRun.id;

    await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      method: "DELETE",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });

    const restoreRes = await SELF.fetch(
      `https://example.com/api/production-runs/${runId}/restore`,
      { method: "POST", headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf } },
    );
    expect(restoreRes.status).toBe(200);
    const restored = (await restoreRes.json()) as ProductionRunDtoShape;
    expect(restored.productionRun.id).toBe(runId);

    const getRes = await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      headers: { cookie: auth.cookie },
    });
    expect(getRes.status).toBe(200);
  });

  it("returns 404 for a run that is not currently deleted", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production raw for restore not-deleted");
    const outputItemId = await createItem(
      auth,
      "Route production output for restore not-deleted",
      "SEMI_FINISHED",
    );
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);
    const { json: created } = await createProductionRun(auth, {
      recipeId,
      batches: 1,
      actualOutputQty: 500,
      occurredAt: NOW,
      businessDate: BUSINESS_DATE,
      lines: [{ itemId: rawItemId, qty: 100 }],
    });
    const runId = (created as ProductionRunDtoShape).productionRun.id;

    const res = await SELF.fetch(`https://example.com/api/production-runs/${runId}/restore`, {
      method: "POST",
      headers: { cookie: auth.cookie, "X-CSRF-Token": auth.csrf },
    });
    expect(res.status).toBe(404);
  });
});

// R-5 through HTTP: reproduces purchasing-routes.test.ts's scenario, with a production run's
// OUTPUT item standing in for a purchased item (core/costing/wac.ts treats PURCHASE_IN and
// PRODUCTION_IN identically) and a neutral never-purchased consumption item so `indirectCost`
// alone controls each run's booked unit cost.
async function seedReplayScenario(auth: { cookie: string; csrf: string }, namePrefix: string) {
  const neutralItemId = await createItem(auth, `${namePrefix} — insumo neutro`);
  const outputItemId = await createItem(auth, `${namePrefix} — salida`, "SEMI_FINISHED");
  const recipeId = await createRecipe(
    auth,
    outputItemId,
    [{ itemId: neutralItemId, qty: 1 }],
    10_000,
  );

  const { json: pr1 } = await createProductionRun(auth, {
    recipeId,
    batches: 1,
    actualOutputQty: 10_000,
    indirectCost: 20_000, // unit cost 2
    occurredAt: "2026-07-10T10:00:00.000Z",
    businessDate: "2026-07-10",
    lines: [{ itemId: neutralItemId, qty: 1 }],
  });

  const exitRes = await SELF.fetch("https://example.com/api/inventory/exits", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({
      itemId: outputItemId,
      qty: 8_000,
      reason: "WASTE",
      occurredAt: "2026-07-11T10:00:00.000Z",
      businessDate: "2026-07-11",
    }),
  });
  expect(exitRes.status).toBe(201);
  const exit = (await exitRes.json()) as { exit: { id: string } };

  await createProductionRun(auth, {
    recipeId,
    batches: 1,
    actualOutputQty: 10_000,
    indirectCost: 40_000, // unit cost 4
    occurredAt: "2026-07-12T10:00:00.000Z",
    businessDate: "2026-07-12",
    lines: [{ itemId: neutralItemId, qty: 1 }],
  });

  return {
    neutralItemId,
    outputItemId,
    recipeId,
    runId: (pr1 as ProductionRunDtoShape).productionRun.id,
    exitId: exit.exit.id,
  };
}

describe("R-5 confirmation flow through HTTP (POST /api/production-runs)", () => {
  it("refuses a backdated create with 409 carrying the impact, then succeeds when retried with confirm:true", async () => {
    const auth = await login();
    const { neutralItemId, recipeId, exitId } = await seedReplayScenario(
      auth,
      "Route production R-5 create",
    );

    const backdatedCommand: ProductionRunBody = {
      recipeId,
      batches: 1,
      actualOutputQty: 10_000,
      indirectCost: 100_000, // unit cost 10 — lands ahead of the exit
      occurredAt: "2026-07-10T12:00:00.000Z",
      businessDate: "2026-07-10",
      lines: [{ itemId: neutralItemId, qty: 1 }],
    };

    const { res: refuseRes, json: refuseBody } = await createProductionRun(auth, backdatedCommand);
    expect(refuseRes.status).toBe(409);
    const refuse = refuseBody as {
      code: string;
      details: {
        reason: string;
        impact: { requiresConfirmation: boolean; affectedStockExitIds: string[] };
      };
    };
    expect(refuse.code).toBe("CONFLICT");
    expect(refuse.details.reason).toBe("REPLAY_CONFIRMATION_REQUIRED");
    expect(refuse.details.impact.requiresConfirmation).toBe(true);
    expect(refuse.details.impact.affectedStockExitIds).toEqual([exitId]);

    const { res: confirmRes, json: confirmBody } = await createProductionRun(auth, {
      ...backdatedCommand,
      confirm: true,
    });
    expect(confirmRes.status).toBe(201);
    expect((confirmBody as ProductionRunDtoShape).productionRun.totalCost).toBe(100_000);
  });
});

describe("POST /api/production-runs/impact", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/production-runs/impact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "delete", id: "whatever" }),
    });
    expect(res.status).toBe(401);
  });

  it("op=create: returns a sane impact shape and writes nothing", async () => {
    const auth = await login();
    const rawItemId = await createItem(auth, "Route production impact create raw");
    const outputItemId = await createItem(
      auth,
      "Route production impact create output",
      "SEMI_FINISHED",
    );
    const recipeId = await createRecipe(auth, outputItemId, [{ itemId: rawItemId, qty: 100 }]);

    const res = await SELF.fetch("https://example.com/api/production-runs/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        op: "create",
        command: {
          recipeId,
          batches: 1,
          actualOutputQty: 500,
          occurredAt: NOW,
          businessDate: BUSINESS_DATE,
          lines: [{ itemId: rawItemId, qty: 100 }],
        },
      }),
    });
    expect(res.status).toBe(200);
    const impact = (await res.json()) as {
      requiresConfirmation: boolean;
      costDelta: number;
      affectedItemIds: string[];
    };
    expect(typeof impact.requiresConfirmation).toBe("boolean");
    expect(typeof impact.costDelta).toBe("number");
    expect(Array.isArray(impact.affectedItemIds)).toBe(true);

    const listRes = await SELF.fetch(
      `https://example.com/api/production-runs?recipeId=${recipeId}`,
      { headers: { cookie: auth.cookie } },
    );
    const { productionRuns: listed } = (await listRes.json()) as {
      productionRuns: { id: string }[];
    };
    expect(listed).toHaveLength(0);
  });

  it("op=update and op=delete: refuse-then-confirm impact matches the real mutation's, and writes nothing", async () => {
    const auth = await login();
    const { neutralItemId, recipeId, runId, exitId } = await seedReplayScenario(
      auth,
      "Route production impact update/delete",
    );

    const updateImpactRes = await SELF.fetch("https://example.com/api/production-runs/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({
        op: "update",
        id: runId,
        command: {
          recipeId,
          batches: 1,
          actualOutputQty: 10_000,
          indirectCost: 100_000,
          occurredAt: "2026-07-10T10:00:00.000Z",
          businessDate: "2026-07-10",
          lines: [{ itemId: neutralItemId, qty: 1 }],
        },
      }),
    });
    expect(updateImpactRes.status).toBe(200);
    const updateImpact = (await updateImpactRes.json()) as {
      requiresConfirmation: boolean;
      affectedStockExitIds: string[];
    };
    expect(updateImpact.requiresConfirmation).toBe(true);
    expect(updateImpact.affectedStockExitIds).toEqual([exitId]);

    const deleteImpactRes = await SELF.fetch("https://example.com/api/production-runs/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ op: "delete", id: runId }),
    });
    expect(deleteImpactRes.status).toBe(200);
    const deleteImpact = (await deleteImpactRes.json()) as { requiresConfirmation: boolean };
    expect(deleteImpact.requiresConfirmation).toBe(true);

    const getRes = await SELF.fetch(`https://example.com/api/production-runs/${runId}`, {
      headers: { cookie: auth.cookie },
    });
    const fetched = (await getRes.json()) as { totalCost: number };
    expect(fetched.totalCost).toBe(20_000);
  });

  it("rejects a body with no op with 400 VALIDATION", async () => {
    const auth = await login();
    const res = await SELF.fetch("https://example.com/api/production-runs/impact", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("VALIDATION");
  });
});

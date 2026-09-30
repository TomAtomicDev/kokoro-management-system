// Route-level contract test for inventory count reads (KOK-192). Core semantics are asserted in
// counts.test.ts; this file verifies the authenticated Hono boundary carries current item identity
// in the count DTO without requiring a second catalog read.
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createItem, setItemActive, updateItem } from "../src/core/catalog/items.js";
import { startCount } from "../src/core/inventory/counts.js";
import { createDb } from "../src/db/index.js";

const DEV_PASSWORD = "test-password-123";
const NOW = "2026-07-16T10:00:00.000Z";
const BUSINESS_DATE = "2026-07-16";

function getCookieValue(setCookieHeader: string | null, name: string): string | undefined {
  if (!setCookieHeader) return undefined;
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookieHeader);
  return match?.[1];
}

async function login(): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DEV_PASSWORD }),
  });
  const session = getCookieValue(res.headers.get("set-cookie"), "kokoro_session");
  if (!session) throw new Error("login did not return a session cookie");
  return `kokoro_session=${session}`;
}

describe("GET /api/inventory/counts/:id (KOK-192)", () => {
  it("requires authentication and returns current item identity for inactive count items", async () => {
    const unauthenticated = await SELF.fetch("https://example.com/api/inventory/counts/whatever");
    expect(unauthenticated.status).toBe(401);

    const cookie = await login();
    const db = createDb(env.DB);
    const item = await createItem(
      db,
      {
        name: "Count route identity item",
        kind: "RAW_MATERIAL",
        category: "OTHER",
        unit: "L",
        minStockQty: 0,
      },
      "OWNER_WEB",
    );
    const started = await startCount(
      db,
      { kind: "RAW_MATERIAL", category: "OTHER", occurredAt: NOW, businessDate: BUSINESS_DATE },
      "OWNER_WEB",
    );
    await updateItem(db, { id: item.id, name: "Renamed count route item" }, "OWNER_WEB");
    await setItemActive(db, { id: item.id, isActive: false }, "OWNER_WEB");

    const response = await SELF.fetch(
      `https://example.com/api/inventory/counts/${started.count.id}`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    const count = (await response.json()) as {
      id: string;
      lines: Array<{ itemId: string; itemName: string; unit: string; expectedQty: number }>;
    };
    expect(count.id).toBe(started.count.id);
    expect(count.lines.find((line) => line.itemId === item.id)).toMatchObject({
      itemName: "Renamed count route item",
      unit: "L",
      expectedQty: 0,
    });
  });
});

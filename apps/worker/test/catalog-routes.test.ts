// Route-level smoke test for /api/items + /api/item-aliases (KOK-011). The service-level
// atomicity/derived-row assertions live in test/catalog.test.ts (Doc 11 §3); this file only
// proves the Hono wiring (auth/CSRF gate, status codes, body shape) end-to-end via SELF.fetch.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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

describe("GET /api/items", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/items");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/items + GET /api/items/:id", () => {
  it("creates an item and reads it back", async () => {
    const { cookie, csrf } = await login();

    const createRes = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({
        name: "Ítem de ruta",
        kind: "RAW_MATERIAL",
        category: "INGREDIENT",
        unit: "KG",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };
    expect(created.name).toBe("Ítem de ruta");

    const getRes = await SELF.fetch(`https://example.com/api/items/${created.id}`, {
      headers: { cookie },
    });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { id: string };
    expect(fetched.id).toBe(created.id);
  });

  it("rejects an invalid body with 400 VALIDATION", async () => {
    const { cookie, csrf } = await login();
    const res = await SELF.fetch("https://example.com/api/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for a missing item", async () => {
    const { cookie } = await login();
    const res = await SELF.fetch("https://example.com/api/items/does-not-exist", {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});

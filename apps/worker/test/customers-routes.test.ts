// Route-level smoke test for /api/customers (KOK-032). Service-level atomicity assertions live in
// test/customers.test.ts (Doc 11 §3); this file only proves the Hono wiring (auth/CSRF gate,
// status codes, body shape) end-to-end via SELF.fetch — mirrors catalog-routes.test.ts.
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

describe("GET /api/customers", () => {
  it("returns 401 without a session", async () => {
    const res = await SELF.fetch("https://example.com/api/customers");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/customers + GET/PATCH /api/customers/:id", () => {
  it("creates a customer, reads it back, and patches it", async () => {
    const { cookie, csrf } = await login();

    const createRes = await SELF.fetch("https://example.com/api/customers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({ name: "Cliente de ruta", phone: "70000000" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };
    expect(created.name).toBe("Cliente de ruta");

    const getRes = await SELF.fetch(`https://example.com/api/customers/${created.id}`, {
      headers: { cookie },
    });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { id: string };
    expect(fetched.id).toBe(created.id);

    const patchRes = await SELF.fetch(`https://example.com/api/customers/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ notes: "Prefiere entrega en la tarde" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { notes: string | null };
    expect(patched.notes).toBe("Prefiere entrega en la tarde");
  });

  it("rejects an invalid body with 400 VALIDATION", async () => {
    const { cookie, csrf } = await login();
    const res = await SELF.fetch("https://example.com/api/customers", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, "X-CSRF-Token": csrf },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION");
  });

  it("returns 404 for a missing customer", async () => {
    const { cookie } = await login();
    const res = await SELF.fetch("https://example.com/api/customers/does-not-exist", {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});

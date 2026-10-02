// Authenticated API contract tests for KOK-197's read-only /api/receivables route.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const DEV_PASSWORD = "test-password-123";

function getCookieValue(setCookieHeader: string | null, name: string): string | undefined {
  if (!setCookieHeader) return undefined;
  return new RegExp(`${name}=([^;,]+)`).exec(setCookieHeader)?.[1];
}

async function login(): Promise<string> {
  const response = await SELF.fetch("https://example.com/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DEV_PASSWORD }),
  });
  const session = getCookieValue(response.headers.get("set-cookie"), "kokoro_session");
  const csrf = getCookieValue(response.headers.get("set-cookie"), "kokoro_csrf");
  if (!session || !csrf) throw new Error("login did not return session/csrf cookies");
  return `kokoro_session=${session}; kokoro_csrf=${csrf}`;
}

describe("GET /api/receivables (KOK-197)", () => {
  it("requires an authenticated session", async () => {
    const response = await SELF.fetch("https://example.com/api/receivables");
    expect(response.status).toBe(401);
  });

  it("returns the shared grouped response contract and validates query bounds", async () => {
    const cookie = await login();
    const response = await SELF.fetch("https://example.com/api/receivables?page=1&pageSize=20", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      globalSummary: {
        receivablesTotal: expect.any(Number),
        debtorCount: expect.any(Number),
        pendingReceivableCount: expect.any(Number),
      },
      groups: expect.any(Array),
      pagination: {
        page: 1,
        pageSize: 20,
        totalGroups: expect.any(Number),
        totalPages: expect.any(Number),
        hasNextPage: expect.any(Boolean),
      },
    });

    const invalidResponse = await SELF.fetch("https://example.com/api/receivables?pageSize=101", {
      headers: { cookie },
    });
    expect(invalidResponse.status).toBe(400);
  });
});

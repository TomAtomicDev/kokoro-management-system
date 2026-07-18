// End-to-end auth flow against the real Worker app (SELF.fetch), per Doc 11 §7: "route-level
// authz test (every /api/* 401s without session)" + "rate-limit tests". Uses the dev password
// from .dev.vars (OWNER_PASSWORD_HASH is the hash of "test-password-123" — see
// .dev.vars.example's header comment).
//
// @cloudflare/vitest-pool-workers v0.13+ isolates storage per test FILE, not per test (the old
// `isolatedStorage: true` per-test default was removed). Login rate limiting counts recent
// 'login_failed' audit_log rows (see src/auth/rate-limit.ts), so without a reset those rows would
// carry over between tests in this file and trip the limiter early. The `beforeEach` below clears
// them so each test starts with a clean rate-limit window.
import { env, SELF } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";
import { auditLog } from "../src/db/schema.js";

const DEV_PASSWORD = "test-password-123";

beforeEach(async () => {
  const db = createDb(env.DB);
  await db
    .delete(auditLog)
    .where(and(eq(auditLog.action, "login_failed"), eq(auditLog.entityType, "auth")));
});

function getCookieValue(setCookieHeader: string | null, name: string): string | undefined {
  if (!setCookieHeader) return undefined;
  // In tests, `Headers.get("set-cookie")` may return multiple cookies joined by ", " (undici
  // behavior) since Set-Cookie can't be safely comma-split like other headers in general, but
  // our cookie values are base64url/hex-ish with no commas, so a simple split on ", <name>=" is
  // good enough here — real browsers receive each Set-Cookie as a separate header line.
  const match = new RegExp(`${name}=([^;,]+)`).exec(setCookieHeader);
  return match?.[1];
}

describe("POST /api/auth/login", () => {
  it("rejects a missing/invalid body with 400", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects the wrong password with 401 and does not set a session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "definitely-wrong" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("accepts the correct password and sets session + csrf cookies", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: DEV_PASSWORD }),
    });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie");
    expect(getCookieValue(setCookie, "kokoro_session")).toBeTruthy();
    expect(getCookieValue(setCookie, "kokoro_csrf")).toBeTruthy();
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("rate-limits after 5 failed attempts within the window (Doc 11 §7)", async () => {
    const attempt = () =>
      SELF.fetch("https://example.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "still-wrong" }),
      });

    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await attempt();
      results.push(res.status);
    }

    expect(results.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(results[5]).toBe(429);
  });
});

describe("route-level authz on /api/*", () => {
  it("returns 401 for a protected route without a session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 200 for /api/health without a session (public route)", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
  });

  it("rejects a mutation with a valid session but a missing/mismatched CSRF token", async () => {
    const loginRes = await SELF.fetch("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: DEV_PASSWORD }),
    });
    const sessionCookie = getCookieValue(loginRes.headers.get("set-cookie"), "kokoro_session");
    expect(sessionCookie).toBeTruthy();

    const logoutRes = await SELF.fetch("https://example.com/api/auth/logout", {
      method: "POST",
      headers: { cookie: `kokoro_session=${sessionCookie}` }, // no X-CSRF-Token
    });
    expect(logoutRes.status).toBe(401);
  });

  it("accepts a mutation with a valid session and matching CSRF token", async () => {
    const loginRes = await SELF.fetch("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: DEV_PASSWORD }),
    });
    const setCookie = loginRes.headers.get("set-cookie");
    const sessionCookie = getCookieValue(setCookie, "kokoro_session");
    const csrfCookie = getCookieValue(setCookie, "kokoro_csrf");
    expect(sessionCookie && csrfCookie).toBeTruthy();

    const logoutRes = await SELF.fetch("https://example.com/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: `kokoro_session=${sessionCookie}; kokoro_csrf=${csrfCookie}`,
        "X-CSRF-Token": csrfCookie ?? "",
      },
    });
    expect(logoutRes.status).toBe(200);
  });
});

describe("GET /api/auth/session", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/session");
    expect(res.status).toBe(401);
  });

  it("returns 200 with a valid session cookie, without renewing/needing CSRF", async () => {
    const loginRes = await SELF.fetch("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: DEV_PASSWORD }),
    });
    const sessionCookie = getCookieValue(loginRes.headers.get("set-cookie"), "kokoro_session");
    expect(sessionCookie).toBeTruthy();

    const sessionRes = await SELF.fetch("https://example.com/api/auth/session", {
      headers: { cookie: `kokoro_session=${sessionCookie}` },
    });
    expect(sessionRes.status).toBe(200);
    expect(await sessionRes.json()).toEqual({ ok: true });
  });
});

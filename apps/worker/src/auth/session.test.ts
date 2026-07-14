import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  createSessionCookieValue,
  verifySessionCookieValue,
} from "./session.js";

const SECRET = "test-session-secret";

describe("session cookie (HMAC-SHA256)", () => {
  it("round-trips: a freshly created cookie verifies successfully", async () => {
    const value = await createSessionCookieValue(SECRET);
    const payload = await verifySessionCookieValue(value, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.exp).toBe((payload?.iat ?? 0) + SESSION_MAX_AGE_SECONDS);
  });

  it("rejects a cookie signed with a different secret", async () => {
    const value = await createSessionCookieValue(SECRET);
    expect(await verifySessionCookieValue(value, "a-different-secret")).toBeNull();
  });

  it("rejects a tampered payload even if the signature segment is untouched", async () => {
    const value = await createSessionCookieValue(SECRET);
    const [payload, signature] = value.split(".");
    const tampered = `${payload}x.${signature}`;
    expect(await verifySessionCookieValue(tampered, SECRET)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const issuedLongAgo = new Date(Date.now() - (SESSION_MAX_AGE_SECONDS + 3600) * 1000);
    const value = await createSessionCookieValue(SECRET, issuedLongAgo);
    expect(await verifySessionCookieValue(value, SECRET)).toBeNull();
  });

  it("accepts a session at exactly its last valid second and rejects it once expired", async () => {
    const now = new Date();
    const value = await createSessionCookieValue(SECRET, now);
    const justBeforeExpiry = new Date(now.getTime() + (SESSION_MAX_AGE_SECONDS - 1) * 1000);
    const justAfterExpiry = new Date(now.getTime() + (SESSION_MAX_AGE_SECONDS + 1) * 1000);
    expect(await verifySessionCookieValue(value, SECRET, justBeforeExpiry)).not.toBeNull();
    expect(await verifySessionCookieValue(value, SECRET, justAfterExpiry)).toBeNull();
  });

  it("never throws on malformed cookie values — returns null instead", async () => {
    await expect(verifySessionCookieValue("not-a-session", SECRET)).resolves.toBeNull();
    await expect(verifySessionCookieValue("a.b.c", SECRET)).resolves.toBeNull();
    await expect(verifySessionCookieValue("", SECRET)).resolves.toBeNull();
    await expect(verifySessionCookieValue("!!!.!!!", SECRET)).resolves.toBeNull();
  });
});

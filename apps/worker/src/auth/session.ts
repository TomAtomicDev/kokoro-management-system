// HMAC-signed session cookie (ADR-007): stateless, no session table in Doc 04 — the cookie
// itself carries `{ iat, exp }`, signed with HMAC-SHA256 over SESSION_SECRET via Web Crypto.
// 30-day sliding: middleware/auth.ts re-signs a fresh cookie with a renewed `exp` on every valid
// request, so an active owner never gets logged out mid-session. Actual `Set-Cookie` emission
// uses Hono's `setCookie`/`deleteCookie` helpers (see middleware/auth.ts, api/auth.ts) — this
// file only builds/verifies the signed cookie *value*.

import { fromBase64Url, timingSafeEqual, toBase64Url } from "./crypto-utils.js";

export const SESSION_COOKIE_NAME = "kokoro_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface SessionPayload {
  /** issued-at, unix seconds */
  iat: number;
  /** expiry, unix seconds */
  exp: number;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Builds a fresh signed session cookie value, expiring `SESSION_MAX_AGE_SECONDS` from now. */
export async function createSessionCookieValue(
  sessionSecret: string,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = { iat, exp: iat + SESSION_MAX_AGE_SECONDS };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));

  const key = await importHmacKey(sessionSecret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const signatureB64 = toBase64Url(new Uint8Array(signature));

  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verifies a session cookie value's HMAC signature and expiry. Returns the decoded payload if
 * valid, `null` otherwise (bad signature, malformed value, or expired) — never throws.
 */
export async function verifySessionCookieValue(
  cookieValue: string,
  sessionSecret: string,
  now: Date = new Date(),
): Promise<SessionPayload | null> {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) return null;

  const key = await importHmacKey(sessionSecret);
  const expectedSignature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );

  let providedSignature: Uint8Array;
  try {
    providedSignature = fromBase64Url(signatureB64);
  } catch {
    return null;
  }
  if (!timingSafeEqual(new Uint8Array(expectedSignature), providedSignature)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (nowSeconds >= payload.exp) return null;

  return payload;
}

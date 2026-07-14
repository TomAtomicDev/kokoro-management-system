// CSRF double-submit token (Doc 02 §6: "SameSite + double-submit token on mutations"). SameSite
// = Lax is the primary defense (it already blocks the cookie from attaching to a cross-site
// POST); the double-submit token is defense-in-depth on top of it.
//
// On login, the SPA gets a second, NON-HttpOnly cookie so client JS can read it and echo it back
// as a header on every mutating request; the server just compares header === cookie. No server
// state needed. `Set-Cookie` emission uses Hono's `setCookie`/`deleteCookie` helpers (see
// middleware/auth.ts, api/auth.ts) — this file only builds the token and compares it.

import { timingSafeEqualString, toBase64Url } from "./crypto-utils.js";

export const CSRF_COOKIE_NAME = "kokoro_csrf";
export const CSRF_HEADER_NAME = "X-CSRF-Token";
const CSRF_TOKEN_BYTES = 32;

export function generateCsrfToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(CSRF_TOKEN_BYTES)));
}

/** True iff `headerValue` (from X-CSRF-Token) matches `cookieValue` (from the kokoro_csrf cookie), both non-empty. */
export function csrfTokensMatch(
  headerValue: string | undefined,
  cookieValue: string | undefined,
): boolean {
  if (!headerValue || !cookieValue) return false;
  return timingSafeEqualString(headerValue, cookieValue);
}

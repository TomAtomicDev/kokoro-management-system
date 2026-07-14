// Auth + CSRF middleware (KOK-007, ADR-007, Doc 02 §6). Two composable middlewares mounted on
// `/api/*` in index.ts, both ahead of the route tree:
//   - requireSession(): every /api/* route needs a valid session cookie, except /api/health and
//     POST /api/auth/login (the routes that must work *before* a session exists). Valid sessions
//     are renewed (30-day sliding) on every request.
//   - requireCsrf(): every mutating (POST/PUT/PATCH/DELETE) /api/* request needs a matching
//     X-CSRF-Token header + kokoro_csrf cookie, except POST /api/auth/login (no CSRF cookie
//     exists yet pre-session — SameSite=Lax is the defense there).

import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, csrfTokensMatch } from "../auth/csrf.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionCookieValue,
  verifySessionCookieValue,
} from "../auth/session.js";
import { unauthorized } from "../core/errors.js";
import type { Env, Variables } from "../env.js";

type Bindings = { Bindings: Env; Variables: Variables };

const SESSION_EXEMPT_PATHS = new Set(["/api/health", "/api/auth/login"]);
const CSRF_EXEMPT_PATHS = new Set(["/api/auth/login"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requireSession(): MiddlewareHandler<Bindings> {
  return async (c, next) => {
    if (SESSION_EXEMPT_PATHS.has(c.req.path)) {
      return next();
    }

    const cookieValue = getCookie(c, SESSION_COOKIE_NAME);
    if (!cookieValue) {
      throw unauthorized("Debes iniciar sesión.");
    }

    const payload = await verifySessionCookieValue(cookieValue, c.env.SESSION_SECRET);
    if (!payload) {
      throw unauthorized("La sesión expiró o no es válida. Inicia sesión de nuevo.");
    }

    // 30-day sliding expiry: every valid request renews the cookie.
    const renewed = await createSessionCookieValue(c.env.SESSION_SECRET);
    setCookie(c, SESSION_COOKIE_NAME, renewed, {
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });

    await next();
  };
}

export function requireCsrf(): MiddlewareHandler<Bindings> {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method) || CSRF_EXEMPT_PATHS.has(c.req.path)) {
      return next();
    }

    const header = c.req.header(CSRF_HEADER_NAME);
    const cookie = getCookie(c, CSRF_COOKIE_NAME);
    if (!csrfTokensMatch(header, cookie)) {
      throw unauthorized(
        "Token de seguridad inválido o ausente. Recarga la página e intenta de nuevo.",
      );
    }

    await next();
  };
}

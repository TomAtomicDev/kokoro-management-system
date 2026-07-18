// POST /api/auth/login, POST /api/auth/logout, GET /api/auth/session (SC-18, ADR-007, KOK-007,
// KOK-063). Mounted under /api in index.ts. Auth/CSRF middleware (middleware/auth.ts) already
// exempts POST /api/auth/login from both session and CSRF checks; logout and session require a
// valid session like any other /api/* route.

import { loginCommandSchema } from "@kokoro/shared";
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";

import { CSRF_COOKIE_NAME, generateCsrfToken } from "../auth/csrf.js";
import { verifyPassword } from "../auth/password.js";
import { isLoginRateLimited, recordFailedLoginAttempt } from "../auth/rate-limit.js";
import {
  createSessionCookieValue,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "../auth/session.js";
import { rateLimited, unauthorized } from "../core/errors.js";
import { createDb } from "../db/index.js";
import type { Env, Variables } from "../env.js";

export const authRoute = new Hono<{ Bindings: Env; Variables: Variables }>()
  .post("/auth/login", async (c) => {
    const db = createDb(c.env.DB);
    const body = loginCommandSchema.parse(await c.req.json());

    if (await isLoginRateLimited(db)) {
      throw rateLimited(
        "Demasiados intentos fallidos. Espera 15 minutos antes de volver a intentar.",
      );
    }

    const valid = await verifyPassword(body.password, c.env.OWNER_PASSWORD_HASH);
    if (!valid) {
      await recordFailedLoginAttempt(db);
      throw unauthorized("Contraseña incorrecta.");
    }

    const sessionValue = await createSessionCookieValue(c.env.SESSION_SECRET);
    setCookie(c, SESSION_COOKIE_NAME, sessionValue, {
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });

    const csrfToken = generateCsrfToken();
    setCookie(c, CSRF_COOKIE_NAME, csrfToken, {
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      httpOnly: false, // client JS reads this to echo it back as X-CSRF-Token
      secure: true,
      sameSite: "Lax",
    });

    return c.json({ ok: true });
  })
  .post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/", secure: true, sameSite: "Lax" });
    deleteCookie(c, CSRF_COOKIE_NAME, { path: "/", secure: true, sameSite: "Lax" });
    return c.json({ ok: true });
  })
  // Non-mutating auth check for the SPA (KOK-063): not in SESSION_EXEMPT_PATHS, so
  // requireSession() already 401s before this handler runs when there's no valid cookie —
  // reaching this line means a session exists. Used by the router's beforeLoad guard and the
  // TanStack Query client to detect a still-open session without a mutating call.
  .get("/auth/session", (c) => c.json({ ok: true }));

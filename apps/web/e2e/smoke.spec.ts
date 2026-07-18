// P0 acceptance gate (Doc 11 §6): "CI deploys on merge; login works; empty app renders;
// migration 0001 applied cleanly to fresh DB". This is the KOK-009 pipeline smoke suite, not the
// full E2E suite (that's KOK-055, Phase 6) — just enough to prove a deploy is actually live and
// functional before gating the manual approval to production.
import { expect, test } from "@playwright/test";

import { authLabels } from "../src/lib/i18n-auth";

test("the SPA shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Kokoro/i);

  // KOK-063 put every route except /login behind a session (`_authenticated`'s `beforeLoad`
  // redirects unauthenticated visits to /login before AppShell ever renders), so a bare "/" visit
  // no longer proves the persistent shell renders unless we're logged in.
  const password = process.env.E2E_LOGIN_PASSWORD;
  if (password) {
    // page.request shares the browser context's cookie jar with page, so this session cookie
    // carries over to the follow-up goto.
    await page.request.post("/api/auth/login", { data: { password } });
    await page.goto("/");
    // AppShell renders both the desktop Sidebar and MobileBottomTabs <nav> (CSS-toggled, both in
    // the DOM at once) — "empty app renders" just needs at least one visible.
    await expect(page.getByRole("navigation").first()).toBeVisible();
  } else {
    // No STAGING_OWNER_PASSWORD secret configured — fall back to proving the unauthenticated
    // shell (the /login redirect + form) renders instead of the authenticated AppShell.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByLabel(authLabels.passwordLabel)).toBeVisible();
  }
});

test("GET /api/health responds ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.ok).toBe(true);
});

test("a protected API route 401s without a session", async ({ request }) => {
  const res = await request.post("/api/auth/logout");
  expect(res.status()).toBe(401);
});

test("login works with the environment's owner password", async ({ request }) => {
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD not set — skipping the login smoke check");

  const res = await request.post("/api/auth/login", {
    data: { password },
  });
  expect(res.ok()).toBe(true);
  const setCookie = res.headers()["set-cookie"] ?? "";
  expect(setCookie).toContain("kokoro_session=");
  expect(setCookie).toContain("kokoro_csrf=");
});

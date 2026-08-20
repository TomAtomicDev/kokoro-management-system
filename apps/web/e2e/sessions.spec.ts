// KOK-165: session start/close from the header (SessionChip + the "+ Sesión" quick-add modal),
// the flow the review doc's §6 already confirmed working manually — this pins it as an e2e spec.
// Uses SESSION_TYPES.OTHER specifically to avoid the "one OPEN session per type" constraint
// colliding with a session another spec in this suite creates. It does NOT avoid every collision,
// though: SessionChip's own variant (single "{type} {duration}" vs. "N sesiones abiertas") depends
// on the *total* open-session count across every type, and production-edit.spec.ts's fixture
// leaves a PRODUCTION session open for the run's whole duration (an implicit session auto-created
// for the production-run POST, never explicitly closed). So under Playwright's fullyParallel
// runner, this test may see the single- or multi-session chip depending on what else is mid-flight
// — both are handled below, and the final assertion checks the API for this session specifically
// rather than "no sessions at all" (false under real parallel execution).
import { expect, test } from "@playwright/test";
import { topbarLabels } from "../src/lib/i18n-nav";
import { sessionsLabels } from "../src/lib/i18n-sessions";
import { authenticatedHeaders } from "./helpers";

test.beforeEach(async ({ page }) => {
  const password = process.env.E2E_LOGIN_PASSWORD;
  test.skip(!password, "E2E_LOGIN_PASSWORD not set — skipping session flow check");
  const response = await page.request.post("/api/auth/login", { data: { password } });
  expect(response.ok()).toBe(true);
});

test("starting a session from the header, then closing it from the chip", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: topbarLabels.quickAdd }).click();
  await page.getByRole("button", { name: sessionsLabels.typeLabels.OTHER, exact: true }).click();

  // A prior local run (or this suite's own retry) can leave an OTHER session OPEN — the modal
  // then shows the close-and-start conflict prompt instead of starting immediately (async: it
  // waits on a query first, so it isn't there yet on the frame right after the click). Race both
  // outcomes so the test is idempotent regardless of leftover state, exercising the real conflict
  // flow (KOK-133) rather than assuming a pristine DB.
  const confirmCloseAndStart = page.getByRole("button", {
    name: sessionsLabels.quickStart.confirmCloseAndStart,
    exact: true,
  });
  // Matches both chip variants: the single-session button's own name ("Otro 5m…") and the
  // multi-session button's aggregate count ("N sesiones abiertas"). `disabled: false` excludes
  // the quick-add modal's own (still-mounted-while-disabled) "Otro" type-picker button, whose
  // plain text also matches the name pattern.
  const chip = page.getByRole("button", {
    name: new RegExp(`${sessionsLabels.typeLabels.OTHER}|abiertas`),
    disabled: false,
  });
  await Promise.race([confirmCloseAndStart.waitFor(), chip.waitFor()]);
  if (await confirmCloseAndStart.isVisible().catch(() => false)) {
    await confirmCloseAndStart.click();
  }
  await expect(chip).toBeVisible();
  await chip.click();

  // Multi-session popover: one row per open session, each rendered (and its own stop button
  // mounted) independently and asynchronously — a one-shot button count is racy. Try the
  // row-scoped locator first (the row whose own label is exactly "Otro"; the single-chip
  // variant's label is never an exact-text match on its own, since it's fused with the duration
  // in one text node); fall back to the lone stop button when there's only ever one session.
  const otherRow = page
    .getByText(sessionsLabels.typeLabels.OTHER, { exact: true })
    .locator("xpath=ancestor::div[1]");
  try {
    await otherRow.getByRole("button", { name: sessionsLabels.chip.stopNow }).click({
      timeout: 3000,
    });
  } catch {
    await page.getByRole("button", { name: sessionsLabels.chip.stopNow }).click();
  }

  await expect
    .poll(async () => {
      const res = await page.request.get("/api/sessions?type=OTHER&status=OPEN", {
        headers: await authenticatedHeaders(page),
      });
      const body = (await res.json()) as { sessions: unknown[] };
      return body.sessions.length;
    })
    .toBe(0);
});

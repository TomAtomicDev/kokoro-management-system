import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { isLoginRateLimited, recordFailedLoginAttempt } from "../src/auth/rate-limit.js";
import { createDb } from "../src/db/index.js";

describe("login rate limiting (5 tries / 15 min, via audit_log)", () => {
  it("is not rate-limited with zero recorded failures", async () => {
    const db = createDb(env.DB);
    expect(await isLoginRateLimited(db)).toBe(false);
  });

  it("becomes rate-limited after 5 recorded failures and not before", async () => {
    const db = createDb(env.DB);
    for (let i = 0; i < 4; i++) {
      await recordFailedLoginAttempt(db);
    }
    expect(await isLoginRateLimited(db)).toBe(false);

    await recordFailedLoginAttempt(db);
    expect(await isLoginRateLimited(db)).toBe(true);
  });
});

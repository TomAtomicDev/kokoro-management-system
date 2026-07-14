// Smoke test for GET /api/health, run inside workerd via @cloudflare/vitest-pool-workers.
// `SELF` is the ambient fetcher for this Worker's own `fetch` export, provided by the
// "cloudflare:test" module that the pool injects (see vitest.config.ts).
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("returns 200 with ok: true", async () => {
    const response = await SELF.fetch("https://example.com/api/health");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true });
  });
});

// KOK-004: /api/* is handled by Hono; everything else falls back to the built SPA, including
// client-side routes with no matching build file (SPA-fallback routing, Doc 02 §1) and deep
// links with query params (e.g. /sales?open=<id>, the Telegram magic-link shape from Doc 07).
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("static SPA serving", () => {
  it("serves index.html at the root", async () => {
    const response = await SELF.fetch("https://example.com/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("falls back to index.html for a client-side route with no matching file", async () => {
    const response = await SELF.fetch("https://example.com/sales");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("falls back to index.html for a deep link with query params", async () => {
    const response = await SELF.fetch("https://example.com/sales?open=abc123");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("still routes /api/* to Hono instead of the SPA fallback", async () => {
    const response = await SELF.fetch("https://example.com/api/health");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true });
  });
});

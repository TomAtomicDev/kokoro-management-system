import { describe, expect, it } from "vitest";

import { csrfTokensMatch, generateCsrfToken } from "./csrf.js";

describe("CSRF double-submit token", () => {
  it("matches when header and cookie carry the same token", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it("does not match different tokens", () => {
    expect(csrfTokensMatch(generateCsrfToken(), generateCsrfToken())).toBe(false);
  });

  it("does not match when either side is missing", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(undefined, token)).toBe(false);
    expect(csrfTokensMatch(token, undefined)).toBe(false);
    expect(csrfTokensMatch(undefined, undefined)).toBe(false);
    expect(csrfTokensMatch("", token)).toBe(false);
  });

  it("generates tokens with enough entropy to not collide across many calls", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateCsrfToken()));
    expect(tokens.size).toBe(1000);
  });
});

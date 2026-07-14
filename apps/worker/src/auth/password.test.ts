import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing (PBKDF2-HMAC-SHA256)", () => {
  it("round-trips: verifyPassword accepts the correct password against its own hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt) even for the same password", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("stores the algorithm id and iteration count in the hash string", async () => {
    const hash = await hashPassword("x");
    expect(hash).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  });

  it("never throws on malformed stored hashes — returns false instead", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "pbkdf2-sha256$abc$salt$hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "argon2id$1$salt$hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "")).resolves.toBe(false);
  });

  it("accepts a hash produced by the standalone scripts/hash-password.mjs CLI format", async () => {
    // Fixed example captured from `node apps/worker/scripts/hash-password.mjs "test-password-123"`
    // — pins the two implementations to the same wire format (see that script's header comment).
    const hash =
      "pbkdf2-sha256$600000$vndD0gsfZ5T8rFtuswo7gQ$zG-PCW8JVZbj-WsL8SjCTZ4csk1LkR0mhN7ujpYWQ10";
    expect(await verifyPassword("test-password-123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

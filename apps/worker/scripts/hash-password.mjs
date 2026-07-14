#!/usr/bin/env node
// One-off CLI to generate the OWNER_PASSWORD_HASH secret value (KOK-007, ADR-007).
//
// Usage:
//   node apps/worker/scripts/hash-password.mjs "your-password-here"
//   # then paste the printed hash into:
//   pnpm exec wrangler secret put OWNER_PASSWORD_HASH --env <dev|staging|prod>
//
// Deliberately a standalone plain-JS script (no build step, no new dependency) that duplicates
// the minimal PBKDF2 logic from src/auth/password.ts — see that file for the algorithm choice
// rationale, including why ITERATIONS is 100_000 (the real Cloudflare Workers runtime's hard
// cap for PBKDF2 — Node itself has no such limit, but the hash must still be generated at
// <=100k iterations because verifyPassword() running *inside the Worker* will re-derive with
// whatever iteration count is embedded in the stored hash string).

const ALGO_ID = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    DERIVED_KEY_BITS,
  );
  return `${ALGO_ID}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "your-password-here"');
  process.exit(1);
}

const hash = await hashPassword(password);
console.log(hash);

// Owner password hashing (ADR-007, KOK-007).
//
// ADR-007 / the KOK-007 backlog entry ask for argon2id via WASM, with a documented fallback to
// PBKDF2-HMAC-SHA256/600k "if bundle size is a problem — measure and decide, record in PR".
// Decision recorded here: skip argon2id entirely and use PBKDF2-HMAC-SHA256 via the platform's
// native Web Crypto `SubtleCrypto`, because:
//   1. Argon2 has no pure-JS/Web-Crypto implementation — it always needs a WASM binary shipped
//      in the Worker bundle plus a wrapper package, which is a new dependency (D-10 friction)
//      for a single-owner, non-multi-tenant system where the realistic threat is a stolen/leaked
//      hash being brute-forced offline, not a large-scale credential-stuffing target.
//   2. PBKDF2-HMAC-SHA256 is still an OWASP-acceptable parameter for password hashing when
//      Argon2/scrypt/bcrypt aren't available, and it's zero-dependency, zero additional bundle
//      bytes (D-10: "prefer stdlib/platform over packages").
//
// ITERATIONS = 100_000, not 600k: the real Cloudflare Workers runtime (workerd) hard-caps
// `crypto.subtle.deriveBits` PBKDF2 at 100,000 iterations ("iteration counts above 100000 are
// not supported") and throws `NotSupportedError` above that — discovered via a live staging
// deploy (KOK-009), since Miniflare's local/test simulation does *not* enforce this ceiling, so
// unit/integration tests alone would never have caught it. 100k is the platform maximum for this
// primitive; if stronger hashing is ever required, that means moving to argon2id WASM after all
// (superseding ADR), not raising this constant further.

import { fromBase64Url, timingSafeEqual, toBase64Url } from "./crypto-utils.js";

const ALGO_ID = "pbkdf2-sha256";
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    DERIVED_KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Hashes `password` into the storable string format `pbkdf2-sha256$<iterations>$<saltB64url>$<hashB64url>`.
 * The result is what gets stored as the `OWNER_PASSWORD_HASH` secret (`wrangler secret put`).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveBits(password, salt, ITERATIONS);
  return `${ALGO_ID}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

/** Verifies `password` against a hash produced by {@link hashPassword}. Never throws on bad input — returns false. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4) return false;
  const [algo, iterationsRaw, saltB64, hashB64] = parts;
  if (algo !== ALGO_ID) return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isSafeInteger(iterations) || iterations <= 0) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(saltB64 ?? "");
    expected = fromBase64Url(hashB64 ?? "");
  } catch {
    return false;
  }

  const derived = await deriveBits(password, salt, iterations);
  return timingSafeEqual(derived, expected);
}

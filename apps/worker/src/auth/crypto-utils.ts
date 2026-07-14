// Shared byte-encoding + comparison primitives for password.ts, session.ts, and csrf.ts. Pure
// Web Crypto / platform APIs only (no new dependency, D-10).

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Constant-time byte comparison — avoids leaking equality via early-exit timing. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: i < a.length === b.length, both in range
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/** Constant-time string comparison for opaque tokens (e.g. CSRF double-submit). */
export function timingSafeEqualString(a: string, b: string): boolean {
  return timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

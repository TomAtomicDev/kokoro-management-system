// UUIDv7 generator — time-sortable primary keys (Doc 04 §1), per RFC 9562.
//
// Layout (16 bytes):
//   bytes 0-5  : 48-bit big-endian Unix millisecond timestamp
//   byte  6    : version nibble `0111` (7) | high 4 bits of a 12-bit counter
//   byte  7    : low 8 bits of the counter (rand_a used as monotonic counter)
//   byte  8    : variant bits `10` | 6 random bits
//   bytes 9-15 : random (rand_b)
//
// Monotonicity: RFC 9562 "fixed-length dedicated counter" method. Within a
// single millisecond the 12-bit counter increments so successive ids stay
// strictly lexicographically ordered by generation order; a new millisecond
// resets it. If the counter overflows within a ms (>4095 ids) we borrow into
// the timestamp. This makes generation order == sort order, which is the whole
// point of using v7 for keys.
//
// We use `crypto.getRandomValues` (present in both Node and Cloudflare Workers)
// with no new dependency (rule D-10).

interface RandomSource {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}
const randomSource = (globalThis as unknown as { crypto: RandomSource }).crypto;

const HEX: string[] = Array.from({ length: 256 }, (_v, i) => i.toString(16).padStart(2, "0"));

let lastTimestamp = -1;
let counter = 0; // 12-bit monotonic counter within a millisecond

export function generateUuidV7(): string {
  let timestamp = Date.now();

  if (timestamp <= lastTimestamp) {
    // Same millisecond (or a clock that did not advance / went backwards):
    // keep the previous timestamp and bump the counter to preserve order.
    timestamp = lastTimestamp;
    counter += 1;
    if (counter > 0xfff) {
      // Counter exhausted for this ms — advance into the next ms.
      timestamp = lastTimestamp + 1;
      counter = 0;
    }
  } else {
    counter = 0;
  }
  lastTimestamp = timestamp;

  const bytes = new Uint8Array(16);

  // 48-bit big-endian timestamp (Date.now() < 2^48, safe via division).
  let t = timestamp;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }

  // rand_a := 12-bit counter, with version nibble in the high 4 bits of byte 6.
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  // rand_b := 8 random bytes into bytes 8..15, then stamp the variant.
  const rand = new Uint8Array(8);
  randomSource.getRandomValues(rand);
  bytes.set(rand, 8);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  return format(bytes);
}

function format(bytes: Uint8Array): string {
  const h = (i: number): string => HEX[bytes[i] ?? 0] ?? "00";
  return `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`;
}

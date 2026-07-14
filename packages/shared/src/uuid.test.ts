import { describe, expect, it } from "vitest";
import { generateUuidV7 } from "./uuid";

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUuidV7", () => {
  it("produces well-formed v7 UUIDs (version nibble 7, variant 10xx)", () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateUuidV7()).toMatch(V7_RE);
    }
  });

  it("is lexicographically sortable in generation order (rapid succession)", () => {
    const ids: string[] = [];
    for (let i = 0; i < 5000; i++) ids.push(generateUuidV7());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    // strictly increasing → also implies uniqueness
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stays ordered across a real time gap", async () => {
    const a = generateUuidV7();
    await new Promise((r) => setTimeout(r, 5));
    const b = generateUuidV7();
    expect(a < b).toBe(true);
  });
});

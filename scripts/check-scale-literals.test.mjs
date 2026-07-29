import assert from "node:assert/strict";
import { test } from "node:test";
import { findScaleLiteralViolations } from "./check-scale-literals.mjs";

test("rejects milli-scale literals used in arithmetic", () => {
  const source = `
    const total = (rate * qty) / 1_000_000;
    const display = value / 1000;
  `;

  assert.deepEqual(
    findScaleLiteralViolations(source).map(({ literal }) => literal),
    ["1_000_000", "1000"],
  );
});

test("allows ordinary values that are not scale arithmetic", () => {
  const source = `
    const oneUnit = 1000;
    const fixture = { qty: 1_000, rate: 1_000_000 };
  `;

  assert.deepEqual(findScaleLiteralViolations(source), []);
});

test("allows a specifically justified non-money conversion", () => {
  const source = `
    // scale-factor-ok: converts JavaScript milliseconds to Unix seconds
    const seconds = milliseconds / 1000;
  `;

  assert.deepEqual(findScaleLiteralViolations(source), []);
});

test("does not accept an empty justification", () => {
  const source = `
    // scale-factor-ok:
    const seconds = milliseconds / 1000;
  `;

  assert.equal(findScaleLiteralViolations(source).length, 1);
});

import { describe, expect, it } from "vitest";

import { isCatalogCommitted } from "./onboarding";

describe("isCatalogCommitted", () => {
  it("reconstructs catalog completion from persisted items after a route remount", () => {
    expect(isCatalogCommitted(false, 1)).toBe(true);
  });

  it("leaves an empty fresh catalog available for its initial import", () => {
    expect(isCatalogCommitted(false, 0)).toBe(false);
  });

  it("keeps the catalog committed while the items query reconciles after a successful import", () => {
    expect(isCatalogCommitted(true, 0)).toBe(true);
  });
});

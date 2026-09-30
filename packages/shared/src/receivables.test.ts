import { describe, expect, it } from "vitest";

import {
  listReceivablesQuerySchema,
  RECEIVABLES_DEFAULT_PAGE_SIZE,
  RECEIVABLES_MAX_PAGE_SIZE,
} from "./receivables.js";

describe("listReceivablesQuerySchema", () => {
  it("defaults to the first bounded group page and removes a blank search", () => {
    expect(listReceivablesQuerySchema.parse({ search: "  " })).toEqual({
      search: undefined,
      minAgeDays: undefined,
      sortBy: "oldest",
      page: 1,
      pageSize: RECEIVABLES_DEFAULT_PAGE_SIZE,
    });
  });

  it("coerces query-string pagination and age values", () => {
    expect(
      listReceivablesQuerySchema.parse({ search: "  VTA-0001  ", minAgeDays: "7", page: "2" }),
    ).toEqual({
      search: "VTA-0001",
      minAgeDays: 7,
      sortBy: "oldest",
      page: 2,
      pageSize: RECEIVABLES_DEFAULT_PAGE_SIZE,
    });
  });

  it("rejects invalid ages, unsafe offsets, and unbounded group pages", () => {
    expect(listReceivablesQuerySchema.safeParse({ minAgeDays: "-1" }).success).toBe(false);
    expect(
      listReceivablesQuerySchema.safeParse({ page: String(Number.MAX_SAFE_INTEGER), pageSize: 2 })
        .success,
    ).toBe(false);
    expect(
      listReceivablesQuerySchema.safeParse({ pageSize: String(RECEIVABLES_MAX_PAGE_SIZE + 1) })
        .success,
    ).toBe(false);
  });

  it("accepts the customer-group sorting options from SC-21", () => {
    expect(listReceivablesQuerySchema.parse({ sortBy: "highestBalance" }).sortBy).toBe(
      "highestBalance",
    );
    expect(listReceivablesQuerySchema.safeParse({ sortBy: "name" }).success).toBe(false);
  });
});

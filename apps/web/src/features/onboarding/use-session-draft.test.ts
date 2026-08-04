import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("react", () => ({
  useState: (initializer: unknown) => {
    mockState.value =
      typeof initializer === "function" ? (initializer as () => unknown)() : initializer;

    const setState = (nextValue: unknown): void => {
      mockState.value =
        typeof nextValue === "function"
          ? (nextValue as (previous: unknown) => unknown)(mockState.value)
          : nextValue;
    };

    return [mockState.value, setState];
  },
}));

import { useSessionDraft } from "./use-session-draft";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  mockState.value = undefined;
});

describe("useSessionDraft", () => {
  it("falls back to the initial value when no draft exists", () => {
    const [value] = useSessionDraft("empty", "initial");

    expect(value).toBe("initial");
  });

  it("persists writes and restores the JSON value on the next call", () => {
    const [, setValue] = useSessionDraft("round-trip", { count: 1 });
    setValue({ count: 2 });

    const [restored] = useSessionDraft("round-trip", { count: 0 });

    expect(restored).toEqual({ count: 2 });
  });

  it("supports functional updater values", () => {
    const [, setValue] = useSessionDraft("functional", 1);
    setValue((previous) => previous + 1);

    const [updated] = useSessionDraft("functional", 0);

    expect(updated).toBe(2);
  });

  it("falls back to the initial value when stored JSON is corrupt", () => {
    sessionStorage.setItem("onboarding-draft:corrupt", "{not-json");

    const [value] = useSessionDraft("corrupt", "fallback");

    expect(value).toBe("fallback");
  });
});

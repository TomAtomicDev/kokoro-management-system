import { useState } from "react";

const SESSION_DRAFT_PREFIX = "onboarding-draft:";

type SessionDraftValue<T> = T | ((previous: T) => T);

function getSessionStorage(): Storage | null {
  try {
    if (typeof globalThis.sessionStorage === "undefined") return null;
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function getStorageKey(key: string): string {
  return `${SESSION_DRAFT_PREFIX}${key}`;
}

function readSessionDraft<T>(key: string, initialValue: T): T {
  const storage = getSessionStorage();
  if (!storage) return initialValue;

  try {
    const serialized = storage.getItem(getStorageKey(key));
    if (serialized === null) return initialValue;
    return JSON.parse(serialized) as T;
  } catch {
    return initialValue;
  }
}

function writeSessionDraft<T>(key: string, value: T): void {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    storage.setItem(getStorageKey(key), JSON.stringify(value));
  } catch {
    // A blocked or full sessionStorage should not prevent the draft from updating in memory.
  }
}

function resolveSessionDraftValue<T>(value: SessionDraftValue<T>, previous: T): T {
  return typeof value === "function" ? (value as (previous: T) => T)(previous) : value;
}

export function useSessionDraft<T>(
  key: string,
  initialValue: T,
): [T, (value: SessionDraftValue<T>) => void] {
  const [value, setValue] = useState<T>(() => readSessionDraft(key, initialValue));

  function updateValue(nextValue: SessionDraftValue<T>): void {
    setValue((previous) => {
      const resolvedValue = resolveSessionDraftValue(nextValue, previous);
      writeSessionDraft(key, resolvedValue);
      return resolvedValue;
    });
  }

  return [value, updateValue];
}

const DRAFT_PREFIX = "kokoro-form-draft:";

function getStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function storageKey(key: string): string {
  return `${DRAFT_PREFIX}${key}`;
}

export function readPersistentDraft<T>(key: string): T | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const serialized = storage.getItem(storageKey(key));
    return serialized === null ? null : (JSON.parse(serialized) as T);
  } catch {
    return null;
  }
}

export function writePersistentDraft<T>(key: string, value: T): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // A blocked or full sessionStorage should not prevent the draft from updating in memory.
  }
}

export function clearPersistentDraft(key: string): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(storageKey(key));
  } catch {
    // A blocked sessionStorage should not prevent the form from completing.
  }
}

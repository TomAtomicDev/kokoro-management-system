import { useBlocker } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { commonLabels } from "@/lib/i18n-common";

export interface UnsavedChangesGuardOptions {
  isDirty: boolean;
  enabled?: boolean;
  /** Full-page forms opt into router history blocking; dialogs only guard their close action. */
  blockNavigation?: boolean;
}

export interface UnsavedChangesGuard {
  /** Whether the guard is currently active. */
  isDirty: boolean;
  /** Returns false when the owner chooses to stay on the current form. */
  confirmDiscard: () => boolean;
  /** Suppress the next guard after a successful save before navigating or closing. */
  markClean: () => void;
}

/**
 * Stable JSON representation for form snapshots. Form state is deliberately limited to JSON
 * values (strings, booleans, nulls, arrays and plain objects), so this keeps comparison predictable
 * without pulling in a deep-equality dependency.
 */
export function serializeFormSnapshot(value: unknown): string {
  return JSON.stringify(normalizeSnapshot(value)) ?? "undefined";
}

function normalizeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSnapshot);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalizeSnapshot(record[key])]),
    );
  }
  return value;
}

export function hasUnsavedChanges(initialValues: unknown, currentValues: unknown): boolean {
  return serializeFormSnapshot(initialValues) !== serializeFormSnapshot(currentValues);
}

/**
 * Adds the same beforeunload and navigation semantics to full-page forms and shared dialogs.
 * `useBlocker` is disabled for dialogs because their close path is handled by `confirmDiscard`;
 * the hook still owns the browser-tab guard in both cases.
 */
export function useUnsavedChangesGuard({
  isDirty,
  enabled = true,
  blockNavigation = false,
}: UnsavedChangesGuardOptions): UnsavedChangesGuard {
  const dirtyRef = useRef(false);
  const cleanOverrideRef = useRef(false);
  const effectiveDirty = enabled && isDirty && !cleanOverrideRef.current;

  if (!isDirty) cleanOverrideRef.current = false;
  dirtyRef.current = effectiveDirty;

  const confirmDiscard = useCallback((): boolean => {
    if (!dirtyRef.current) return true;
    return globalThis.confirm(commonLabels.unsavedChanges);
  }, []);

  const shouldBlockFn = useCallback((): boolean => {
    if (!dirtyRef.current) return false;
    return !confirmDiscard();
  }, [confirmDiscard]);

  useBlocker({
    shouldBlockFn,
    disabled: !blockNavigation,
    enableBeforeUnload: false,
  });

  useEffect(() => {
    if (!enabled) return;

    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = commonLabels.unsavedChanges;
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);

  const markClean = useCallback((): void => {
    cleanOverrideRef.current = true;
    dirtyRef.current = false;
  }, []);

  return { isDirty: effectiveDirty, confirmDiscard, markClean };
}

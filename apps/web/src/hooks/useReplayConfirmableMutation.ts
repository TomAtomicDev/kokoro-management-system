// Generic wrapper for the R-5 "backdated replay" confirmation contract (KOK-024, Doc 03 §7 R-5 /
// ADR-016, packages/shared/src/costing.ts's header): a PATCH/DELETE/restore call on a purchase or
// stock exit that would move already-booked cost is refused with a 409 CONFLICT carrying
// `{ code: "CONFLICT", details: { reason: "REPLAY_CONFIRMATION_REQUIRED", impact: ReplayImpactDto } }`.
// The caller must show `impact` to the owner and, on confirmation, retry the EXACT SAME call with
// `confirm: true` added to the body. Six call sites need this identical catch/capture/retry dance
// (purchase edit/delete/restore, exit edit/delete/restore) — this hook is the one place it lives,
// so none of the six has to hand-roll it.
//
// `extractReplayConfirmation` and `runConfirmableMutation` are exported as plain, framework-free
// functions (no React, no DOM) specifically so they can be unit-tested directly: this workspace
// has neither jsdom nor @testing-library/react installed (checked: neither appears in
// apps/web/package.json nor the lockfile, only as vitest's own optional peer deps), and D-10
// forbids adding either dependency just to render a hook in a test. `useReplayConfirmableMutation`
// itself is a thin `useMutation` wrapper around them — it holds no decision logic beyond turning
// their output into React state, so the interesting behaviour (capture vs. propagate, the retry
// merge) is fully covered by useReplayConfirmableMutation.test.ts without a renderer.

import type { ReplayImpactDto } from "@kokoro/shared";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { ApiError } from "@/lib/api";

interface ReplayConfirmationRequiredDetails {
  reason?: string;
  impact?: ReplayImpactDto;
}

/**
 * Returns the impact DTO when `error` is the R-5 refusal shape (`ApiError` with
 * `code === "CONFLICT"` and `details.reason === "REPLAY_CONFIRMATION_REQUIRED"`), else `null`.
 * Any other error — a different `ApiError` code (e.g. `VALIDATION`), or a non-`ApiError` — is
 * deliberately NOT recognized here: it must propagate to the caller as a normal error, never get
 * swallowed into a confirmation prompt.
 */
export function extractReplayConfirmation(error: unknown): ReplayImpactDto | null {
  if (!(error instanceof ApiError) || error.code !== "CONFLICT") return null;
  const details = error.details as ReplayConfirmationRequiredDetails | undefined;
  if (details?.reason !== "REPLAY_CONFIRMATION_REQUIRED" || !details.impact) return null;
  return details.impact;
}

export type ConfirmableMutationOutcome<V, R> =
  | { status: "success"; data: R }
  | { status: "confirmation-required"; impact: ReplayImpactDto; variables: V }
  | { status: "error"; error: unknown };

/**
 * Runs `mutationFn(variables)` once and classifies the result. This is the whole catch/capture
 * decision `useReplayConfirmableMutation` exists for, deliberately kept outside any React hook so
 * it can be exercised with a plain `await runConfirmableMutation(...)` in a unit test — no
 * component render required.
 */
export async function runConfirmableMutation<V, R>(
  mutationFn: (variables: V) => Promise<R>,
  variables: V,
): Promise<ConfirmableMutationOutcome<V, R>> {
  try {
    const data = await mutationFn(variables);
    return { status: "success", data };
  } catch (error) {
    const impact = extractReplayConfirmation(error);
    if (impact) return { status: "confirmation-required", impact, variables };
    return { status: "error", error };
  }
}

export interface PendingReplayConfirmation<V> {
  impact: ReplayImpactDto;
  variables: V;
}

export interface UseReplayConfirmableMutationOptions<V, R> {
  onSuccess?: (data: R, variables: V) => void;
}

/**
 * `V` must carry the optional `confirm` field every replay-triggering command schema does
 * (`confirmFlagSchema`, `packages/shared/src/costing.ts`) — `confirm()` spreads `confirm: true`
 * into the captured variables generically, without knowing anything else about `V`'s shape.
 */
export function useReplayConfirmableMutation<V extends { confirm?: boolean }, R>(
  mutationFn: (variables: V) => Promise<R>,
  options?: UseReplayConfirmableMutationOptions<V, R>,
) {
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingReplayConfirmation<V> | null>(null);

  const mutation = useMutation<R, unknown, V>({
    mutationFn,
    onSuccess: (data, variables) => {
      setPendingConfirmation(null);
      options?.onSuccess?.(data, variables);
    },
  });

  const run = useCallback(
    async (variables: V) => {
      const outcome = await runConfirmableMutation(mutation.mutateAsync, variables);
      if (outcome.status === "confirmation-required") {
        setPendingConfirmation({ impact: outcome.impact, variables: outcome.variables });
        // `mutateAsync` rejected (that's how we got here) and `useMutation` already recorded that
        // rejection as `mutation.error` — clear it so an expected, handled refusal never shows up
        // as a raw error next to `pendingConfirmation`. A genuinely different error (case d) is
        // left alone below, so it stays visible via `mutation.error`.
        mutation.reset();
      }
    },
    [mutation],
  );

  const execute = useCallback((variables: V) => void run(variables), [run]);

  const confirm = useCallback(() => {
    if (!pendingConfirmation) return;
    void run({ ...pendingConfirmation.variables, confirm: true });
  }, [pendingConfirmation, run]);

  const cancel = useCallback(() => setPendingConfirmation(null), []);

  return {
    /** Attempt the mutation. Never throws — inspect `pendingConfirmation`/`error` instead. */
    execute,
    /** Re-invokes `mutationFn` with the captured variables plus `confirm: true`. No-op if there is
     * no pending confirmation. */
    confirm,
    /** Clears `pendingConfirmation` without calling `mutationFn` again. */
    cancel,
    pendingConfirmation,
    isPending: mutation.isPending,
    /** Set only for a NON-replay-confirmation failure (case d) — the confirmation case is captured
     * into `pendingConfirmation` instead, never surfaced here. */
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  };
}

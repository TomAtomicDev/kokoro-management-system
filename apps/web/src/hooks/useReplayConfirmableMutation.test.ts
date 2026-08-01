import type { ReplayImpactDto } from "@kokoro/shared";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

import { extractReplayConfirmation, runConfirmableMutation } from "./useReplayConfirmableMutation";

// These tests exercise `extractReplayConfirmation`/`runConfirmableMutation` directly rather than
// rendering `useReplayConfirmableMutation` itself: this workspace has no jsdom/@testing-library
// installed (see the hook's own file header) and D-10 forbids adding either just for this. Both
// functions contain 100% of the hook's decision logic — the hook adds only `useState`/`useMutation`
// glue on top — so this is the load-bearing coverage for the execute/confirm/cancel contract.

const impact: ReplayImpactDto = {
  affectedSaleLineIds: [],
  affectedStockExitIds: ["exit-1"],
  affectedProductionRunIds: [],
  affectedItemIds: ["item-1"],
  costDelta: -500,
  requiresConfirmation: true,
};

function replayConflictError(): ApiError {
  return new ApiError("CONFLICT", "Se requiere confirmación.", {
    reason: "REPLAY_CONFIRMATION_REQUIRED",
    impact,
  });
}

describe("extractReplayConfirmation", () => {
  it("extracts the impact from the R-5 refusal shape", () => {
    expect(extractReplayConfirmation(replayConflictError())).toEqual(impact);
  });

  it("returns null for a different ApiError code (e.g. VALIDATION)", () => {
    const error = new ApiError("VALIDATION", "Datos inválidos.", { reason: "SOMETHING_ELSE" });
    expect(extractReplayConfirmation(error)).toBeNull();
  });

  it("returns null for a CONFLICT ApiError with a different reason", () => {
    const error = new ApiError("CONFLICT", "Otro conflicto.", { reason: "SOME_OTHER_REASON" });
    expect(extractReplayConfirmation(error)).toBeNull();
  });

  it("returns null for a non-ApiError", () => {
    expect(extractReplayConfirmation(new Error("boom"))).toBeNull();
  });
});

describe("runConfirmableMutation", () => {
  it("(a) resolves as success when mutationFn succeeds directly — no confirmation dance", async () => {
    const mutationFn = vi.fn().mockResolvedValue({ ok: true });
    const outcome = await runConfirmableMutation(mutationFn, { id: "p1" });

    expect(outcome).toEqual({ status: "success", data: { ok: true } });
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(mutationFn).toHaveBeenCalledWith({ id: "p1" });
  });

  it("(b) captures the impact on first refusal, then succeeds once retried with confirm: true", async () => {
    const mutationFn = vi
      .fn()
      .mockRejectedValueOnce(replayConflictError())
      .mockResolvedValueOnce({ ok: true });

    const variables = { id: "p1", confirm: false as const };
    const first = await runConfirmableMutation(mutationFn, variables);

    expect(first.status).toBe("confirmation-required");
    if (first.status !== "confirmation-required") throw new Error("unreachable");
    expect(first.impact).toEqual(impact);
    expect(first.variables).toEqual(variables);
    expect(mutationFn).toHaveBeenCalledTimes(1);

    // Simulates the hook's `confirm()`: re-invoke with the captured variables plus confirm: true.
    const retryVariables = { ...first.variables, confirm: true };
    const second = await runConfirmableMutation(mutationFn, retryVariables);

    expect(second).toEqual({ status: "success", data: { ok: true } });
    expect(mutationFn).toHaveBeenCalledTimes(2);
    expect(mutationFn).toHaveBeenNthCalledWith(2, { id: "p1", confirm: true });
  });

  it("(c) never calls mutationFn a second time when the caller cancels instead of confirming", async () => {
    const mutationFn = vi.fn().mockRejectedValueOnce(replayConflictError());
    const outcome = await runConfirmableMutation(mutationFn, { id: "p1" });

    expect(outcome.status).toBe("confirmation-required");
    // `cancel()` in the real hook is just `setPendingConfirmation(null)` — no call into
    // mutationFn. Asserting the mock's call count stays at 1 after the first (refused) attempt
    // is exactly that contract: cancelling never talks to the mutation again.
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });

  it("(d) propagates a different ApiError as a normal error, not a confirmation prompt", async () => {
    const validationError = new ApiError("VALIDATION", "Datos inválidos.", {});
    const mutationFn = vi.fn().mockRejectedValue(validationError);

    const outcome = await runConfirmableMutation(mutationFn, { id: "p1" });

    expect(outcome).toEqual({ status: "error", error: validationError });
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});

import type { SessionDto } from "@kokoro/shared";
import { recordSessionCommandSchema, toBusinessDate } from "@kokoro/shared";
import { describe, expect, it } from "vitest";

import { buildStartNowCommand, sessionToFormState } from "./SessionForm";

// `sessionToFormState` is the SessionDto -> form-initial-state mapper SessionForm's edit mode
// seeds its local state from. Exercised as a plain function, same rationale as
// PurchaseForm.test.ts: this workspace has neither jsdom nor @testing-library/react, and D-10
// forbids adding either just to render the form in a test, so this pure mapper is the load-bearing
// coverage for "did edit mode prefill correctly", including the datetime-local round trip.

function session(overrides: Partial<SessionDto> = {}): SessionDto {
  return {
    id: "session-1",
    type: "PRODUCTION",
    businessDate: "2026-07-01",
    startedAt: "2026-07-01T14:30:00.000Z",
    endedAt: "2026-07-01T16:00:00.000Z",
    durationMin: 90,
    status: "OPEN",
    notes: "Turno de la tarde",
    costLines: [
      { id: "line-1", label: "Transporte", amount: 1500, isEstimate: false, accountId: "acc-1" },
      { id: "line-2", label: "Alquiler estimado", amount: 500, isEstimate: true, accountId: null },
    ],
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("sessionToFormState", () => {
  it("maps scalar fields straight through", () => {
    const state = sessionToFormState(session());

    expect(state.type).toBe("PRODUCTION");
    expect(state.businessDate).toBe("2026-07-01");
    expect(state.notes).toBe("Turno de la tarde");
    expect(state.durationMin).toBe("90");
  });

  it("converts each cost line's amount integer into a decimal-string form field at scale 2", () => {
    const state = sessionToFormState(session());

    // amount is centavos (scale 2): 1500 -> "15", 500 -> "5".
    expect(state.costLines).toEqual([
      { label: "Transporte", amount: "15", isEstimate: false, accountId: "acc-1" },
      { label: "Alquiler estimado", amount: "5", isEstimate: true, accountId: null },
    ]);
  });

  it("falls back to a null notes as an empty string, matching the create-mode empty state", () => {
    const state = sessionToFormState(session({ notes: null }));

    expect(state.notes).toBe("");
  });

  it("falls back to a single empty cost line when the session has none", () => {
    const state = sessionToFormState(session({ costLines: [] }));

    expect(state.costLines).toEqual([
      { label: "", amount: "", isEstimate: false, accountId: null },
    ]);
  });

  it("leaves durationMin as an empty string when null", () => {
    const state = sessionToFormState(session({ durationMin: null }));

    expect(state.durationMin).toBe("");
  });

  it("leaves startedAt/endedAt as empty strings when null, and round-trips a non-null instant", () => {
    const state = sessionToFormState(session({ startedAt: null, endedAt: null }));

    expect(state.startedAt).toBe("");
    expect(state.endedAt).toBe("");
  });
});

describe("buildStartNowCommand", () => {
  it("builds a valid startedAt-required record command with no closing fields", () => {
    const command = buildStartNowCommand("DELIVERY_RUN");

    expect(recordSessionCommandSchema.safeParse(command).success).toBe(true);
    expect(command.type).toBe("DELIVERY_RUN");
    expect(command.startedAt).toBeTruthy();
    expect(command.businessDate).toBe(toBusinessDate(command.startedAt));
    expect(command.endedAt).toBeUndefined();
    expect(command.durationMin).toBeUndefined();
  });
});

import type { SessionListItemDto } from "@kokoro/shared";
import { describe, expect, it } from "vitest";

import { getWeekRange, groupOverlapClusters, toPositionedSession } from "./WeeklyCalendar";

// `toPositionedSession` reads clock time in the test runner's local timezone (matching how the
// browser renders a session card to the owner), so expectations for absolute start/end minutes are
// derived the same way rather than hardcoded against the UTC digits in the fixture string — this
// keeps the test portable across machines/CI regardless of local TZ.
function localMinutesOf(instant: string): number {
  const date = new Date(instant);
  return date.getHours() * 60 + date.getMinutes();
}

function session(overrides: Partial<SessionListItemDto> & { id: string }): SessionListItemDto {
  return {
    type: "PRODUCTION",
    businessDate: "2026-08-10",
    status: "OPEN",
    startedAt: null,
    endedAt: null,
    durationMin: null,
    linkedEventCount: 0,
    costsTotal: 0,
    code: null,
    ...overrides,
  };
}

describe("getWeekRange", () => {
  it("returns the Monday-Sunday range containing a mid-week anchor", () => {
    // 2026-08-12 is a Wednesday.
    expect(getWeekRange("2026-08-12")).toEqual({ weekStart: "2026-08-10", weekEnd: "2026-08-16" });
  });

  it("is idempotent when the anchor is already a Monday", () => {
    expect(getWeekRange("2026-08-10")).toEqual({ weekStart: "2026-08-10", weekEnd: "2026-08-16" });
  });

  it("treats Sunday as the last day of its own week, not the start of the next", () => {
    // 2026-08-16 is a Sunday.
    expect(getWeekRange("2026-08-16")).toEqual({ weekStart: "2026-08-10", weekEnd: "2026-08-16" });
  });

  it("spans a month boundary correctly", () => {
    // 2026-08-31 is a Monday.
    expect(getWeekRange("2026-08-31")).toEqual({ weekStart: "2026-08-31", weekEnd: "2026-09-06" });
  });
});

describe("toPositionedSession", () => {
  it("derives start/end minutes from startedAt/endedAt local time", () => {
    const startedAt = "2026-08-10T09:30:00.000Z";
    const endedAt = "2026-08-10T11:00:00.000Z";
    const positioned = toPositionedSession(session({ id: "s1", startedAt, endedAt }));
    expect(positioned.startMinutes).toBe(localMinutesOf(startedAt));
    expect(positioned.endMinutes).toBe(localMinutesOf(endedAt));
    expect(positioned.displayDurationMinutes).toBe(90);
  });

  it("gives an OPEN session with no endedAt a fixed 60-minute display block", () => {
    const startedAt = "2026-08-10T09:00:00.000Z";
    const positioned = toPositionedSession(
      session({ id: "s2", status: "OPEN", startedAt, endedAt: null }),
    );
    expect(positioned.displayDurationMinutes).toBe(60);
    // The layout end (for overlap clustering) still falls back to a 60-minute assumption.
    expect(positioned.endMinutes).toBe(localMinutesOf(startedAt) + 60);
  });

  it("falls back to durationMin for a CLOSED session with no endedAt recorded", () => {
    const positioned = toPositionedSession(
      session({
        id: "s3",
        status: "CLOSED",
        startedAt: "2026-08-10T09:00:00.000Z",
        endedAt: null,
        durationMin: 45,
      }),
    );
    expect(positioned.displayDurationMinutes).toBe(45);
  });

  it("places an unstarted session (no startedAt) at minute 0", () => {
    const positioned = toPositionedSession(session({ id: "s4", startedAt: null }));
    expect(positioned.startMinutes).toBe(0);
  });
});

describe("groupOverlapClusters", () => {
  it("keeps non-overlapping sessions in separate single-session clusters", () => {
    const clusters = groupOverlapClusters(
      [
        session({
          id: "a",
          startedAt: "2026-08-10T08:00:00.000Z",
          endedAt: "2026-08-10T09:00:00.000Z",
        }),
        session({
          id: "b",
          startedAt: "2026-08-10T10:00:00.000Z",
          endedAt: "2026-08-10T11:00:00.000Z",
        }),
      ],
      0,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters.every((cluster) => cluster.sessions.length === 1)).toBe(true);
  });

  it("merges sessions whose time ranges overlap into one cluster", () => {
    const clusters = groupOverlapClusters(
      [
        session({
          id: "a",
          startedAt: "2026-08-10T08:00:00.000Z",
          endedAt: "2026-08-10T09:30:00.000Z",
        }),
        session({
          id: "b",
          startedAt: "2026-08-10T09:00:00.000Z",
          endedAt: "2026-08-10T10:00:00.000Z",
        }),
      ],
      0,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.sessions).toHaveLength(2);
  });

  it("chains a cluster through a session that only overlaps the middle of the group", () => {
    const clusters = groupOverlapClusters(
      [
        session({
          id: "a",
          startedAt: "2026-08-10T08:00:00.000Z",
          endedAt: "2026-08-10T09:00:00.000Z",
        }),
        session({
          id: "b",
          startedAt: "2026-08-10T08:30:00.000Z",
          endedAt: "2026-08-10T11:00:00.000Z",
        }),
        session({
          id: "c",
          startedAt: "2026-08-10T10:30:00.000Z",
          endedAt: "2026-08-10T11:30:00.000Z",
        }),
      ],
      0,
    );
    // a overlaps b, b overlaps c, but a and c alone would not — the cluster must still merge all three.
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.sessions).toHaveLength(3);
  });

  it("orders sessions within a cluster by start time, then id, for stable lane assignment", () => {
    const clusters = groupOverlapClusters(
      [
        session({
          id: "z",
          startedAt: "2026-08-10T08:00:00.000Z",
          endedAt: "2026-08-10T09:00:00.000Z",
        }),
        session({
          id: "a",
          startedAt: "2026-08-10T08:00:00.000Z",
          endedAt: "2026-08-10T09:00:00.000Z",
        }),
      ],
      0,
    );
    expect(clusters[0]?.sessions.map((s) => s.session.id)).toEqual(["a", "z"]);
  });
});

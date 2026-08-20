// KOK-135 / Doc 03 S-5: the Sessions screen's transparent comparison between the sum of each
// session's own duration and the deduplicated wall-clock denominator used by monthly G3.

import type { SessionHoursFilters } from "@kokoro/shared";

import { useSessionHours } from "@/features/sessions/api";
import { sessionsLabels } from "@/lib/i18n-sessions";

import { formatDuration } from "./SessionsTable";

export interface SessionHoursSummaryProps {
  dateRange: SessionHoursFilters;
}

export function SessionHoursSummary({ dateRange }: SessionHoursSummaryProps) {
  const hoursQuery = useSessionHours(dateRange);
  const hours = hoursQuery.data?.hours;

  if (hoursQuery.isLoading) {
    return <p className="text-muted-foreground text-sm">{sessionsLabels.hours.loading}</p>;
  }

  if (hoursQuery.isError || !hours) {
    return (
      <p className="text-negative text-sm" role="alert">
        {sessionsLabels.hours.error}
      </p>
    );
  }

  const hasOverlap = hours.naiveSummedMinutes !== hours.dedupedMinutes;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 border-border border-b pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
          <span className="font-medium text-foreground text-sm">
            {sessionsLabels.hours.summedLabel}
          </span>
          <span className="numeric-cell font-semibold text-foreground text-xl">
            {formatDuration(hours.naiveSummedMinutes)}
          </span>
          <span className="text-muted-foreground text-xs">
            {sessionsLabels.hours.summedDescription}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground text-sm">
            {sessionsLabels.hours.deduplicatedLabel}
          </span>
          <span className="numeric-cell font-semibold text-foreground text-xl">
            {formatDuration(hours.dedupedMinutes)}
          </span>
          <span className="text-muted-foreground text-xs">
            {sessionsLabels.hours.deduplicatedDescription}
          </span>
        </div>
      </div>

      {hours.naiveSummedMinutes === 0 && hours.excludedSessionCount === 0 ? (
        <p className="text-muted-foreground text-xs">{sessionsLabels.hours.empty}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          {hasOverlap
            ? sessionsLabels.hours.overlapExplanation
            : sessionsLabels.hours.noOverlapExplanation}
        </p>
      )}

      {hours.excludedSessionCount > 0 ? (
        <p className="text-warning text-xs">
          {sessionsLabels.hours.excludedSessions(hours.excludedSessionCount)}
        </p>
      ) : null}
    </div>
  );
}

// SC-09 · Sessions — /sessions (UC-14). Header: "Nueva sesión" action; table of all sessions;
// detail drawer on row click. Mirrors routes/purchases.tsx's composition, plus one addition: an
// `?open=<id>` search param (router.tsx's `sessionsRoute.validateSearch`) that opens a specific
// session's drawer directly — the topbar SessionChip navigates here with that param set.

import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  type DateRange,
  DateRangeFilter,
  getDefaultDateRange,
} from "@/components/common/DateRangeFilter";
import { SessionDetailDrawer } from "@/components/sessions/SessionDetailDrawer";
import { SessionForm } from "@/components/sessions/SessionForm";
import { SessionHoursSummary } from "@/components/sessions/SessionHoursSummary";
import { SessionsTable } from "@/components/sessions/SessionsTable";
import { getWeekRange, WeeklyCalendar } from "@/components/sessions/WeeklyCalendar";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/features/finance/api";
import { useSessions } from "@/features/sessions/api";
import { sessionsLabels } from "@/lib/i18n-sessions";

// Nested under the pathless `_authenticated` layout route (router.tsx) — the route's registered
// id is "/_authenticated/sessions", not the URL path "/sessions" (that's what loginRoute's
// identical `getRouteApi("/login")` gets away with: it's a top-level sibling, not nested).
const routeApi = getRouteApi("/_authenticated/sessions");

const weekBoundFormatter = new Intl.DateTimeFormat("es-BO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function todayBusinessDate(): string {
  const today = new Date();
  return [today.getFullYear(), today.getMonth() + 1, today.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function shiftBusinessDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function formatWeekBound(date: string): string {
  return weekBoundFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

export function SessionsRoute() {
  const search = routeApi.useSearch();
  const defaultHoursRange = getDefaultDateRange();
  const fromDate = search.fromDate ?? defaultHoursRange.fromDate;
  const toDate = search.toDate ?? defaultHoursRange.toDate;
  const { open, view: searchView } = search;
  const navigate = routeApi.useNavigate();
  const view = searchView ?? "calendar";
  const accountsQuery = useAccounts();
  const sessionsQuery = useSessions();

  const [formOpen, setFormOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [weekAnchor, setWeekAnchor] = useState(todayBusinessDate);
  const { weekStart, weekEnd } = getWeekRange(weekAnchor);
  const calendarSessionsQuery = useSessions({ fromDate: weekStart, toDate: weekEnd });

  // One-time pickup of the `?open=<id>` deep link (SessionChip's own navigation target) — only on
  // the value actually changing, so closing the drawer afterward doesn't immediately reopen it on
  // a re-render.
  useEffect(() => {
    if (open) setSelectedSessionId(open);
  }, [open]);

  const accounts = accountsQuery.data?.accounts ?? [];

  function updateView(nextView: "list" | "calendar"): void {
    void navigate({ search: (previous) => ({ ...previous, view: nextView }) });
  }

  function updateHoursRange(range: DateRange): void {
    void navigate({ search: (previous) => ({ ...previous, ...range }) });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{sessionsLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{sessionsLabels.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={view === "list" ? "default" : "outline"}
              onClick={() => updateView("list")}
            >
              {sessionsLabels.calendar.viewList}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "calendar" ? "default" : "outline"}
              onClick={() => updateView("calendar")}
            >
              {sessionsLabels.calendar.viewCalendar}
            </Button>
          </div>
          <Button type="button" onClick={() => setFormOpen(true)}>
            {sessionsLabels.actionRecord}
          </Button>
        </div>
      </div>

      <section
        aria-labelledby="session-hours-title"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="session-hours-title" className="font-semibold text-foreground text-sm">
              {sessionsLabels.hours.title}
            </h2>
            <p className="max-w-2xl text-muted-foreground text-xs">
              {sessionsLabels.hours.subtitle}
            </p>
          </div>
          <DateRangeFilter
            fromDate={fromDate}
            toDate={toDate}
            onChange={updateHoursRange}
            className="shrink-0"
          />
        </div>
        <SessionHoursSummary dateRange={{ fromDate, toDate }} />
      </section>

      {view === "calendar" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-sm tabular-nums">
              {sessionsLabels.calendar.weekRangeLabel(
                formatWeekBound(weekStart),
                formatWeekBound(weekEnd),
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label={sessionsLabels.calendar.prevWeek}
                onClick={() => setWeekAnchor((current) => shiftBusinessDate(current, -7))}
              >
                ‹
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setWeekAnchor(todayBusinessDate())}
              >
                {sessionsLabels.calendar.today}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label={sessionsLabels.calendar.nextWeek}
                onClick={() => setWeekAnchor((current) => shiftBusinessDate(current, 7))}
              >
                ›
              </Button>
            </div>
          </div>
          <WeeklyCalendar
            sessions={calendarSessionsQuery.data?.sessions ?? []}
            weekStart={weekStart}
            onSessionClick={(session) => setSelectedSessionId(session.id)}
          />
        </>
      ) : (
        <SessionsTable
          sessions={sessionsQuery.data?.sessions ?? []}
          loading={sessionsQuery.isLoading}
          onRowClick={(session) => setSelectedSessionId(session.id)}
        />
      )}

      <SessionForm open={formOpen} onOpenChange={setFormOpen} accounts={accounts} />
      <SessionDetailDrawer
        sessionId={selectedSessionId}
        open={selectedSessionId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedSessionId(null);
        }}
        accounts={accounts}
      />
    </div>
  );
}

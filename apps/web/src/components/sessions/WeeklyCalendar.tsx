import type { SessionListItemDto } from "@kokoro/shared";
import type { JSX } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { sessionsLabels } from "@/lib/i18n-sessions";

const HOUR_HEIGHT = 48;
const DAY_COUNT = 7;
const FALLBACK_SCROLL_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

const dayHeaderFormatter = new Intl.DateTimeFormat("es-BO", {
  weekday: "short",
  day: "numeric",
});

export interface WeeklyCalendarProps {
  sessions: SessionListItemDto[];
  weekStart: string;
  onSessionClick: (session: SessionListItemDto) => void;
}

interface PositionedSession {
  session: SessionListItemDto;
  startMinutes: number;
  endMinutes: number;
  displayDurationMinutes: number;
}

interface OverlapCluster {
  id: string;
  sessions: PositionedSession[];
}

function parseBusinessDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatBusinessDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatLocalBusinessDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function addDays(value: string, days: number): string {
  const date = parseBusinessDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatBusinessDate(date);
}

function localMinutes(instant: string): number {
  const date = new Date(instant);
  return date.getHours() * 60 + date.getMinutes();
}

function formatTime(instant: string): string {
  const date = new Date(instant);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatTimeRange(session: SessionListItemDto): string {
  if (!session.startedAt) return "—";
  const start = formatTime(session.startedAt);
  return session.endedAt ? `${start}–${formatTime(session.endedAt)}` : `${start}–`;
}

function toPositionedSession(session: SessionListItemDto): PositionedSession {
  const startMinutes = session.startedAt ? localMinutes(session.startedAt) : 0;
  const durationFromInstants =
    session.startedAt && session.endedAt
      ? Math.max(
          1,
          (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60_000,
        )
      : null;
  const displayDurationMinutes =
    session.status === "OPEN" && session.endedAt === null
      ? 60
      : Math.max(1, durationFromInstants ?? session.durationMin ?? 60);
  const endMinutes = startMinutes + (durationFromInstants ?? 60);

  return { session, startMinutes, endMinutes, displayDurationMinutes };
}

function groupOverlapClusters(sessions: SessionListItemDto[], dayIndex: number): OverlapCluster[] {
  const positioned = sessions
    .map(toPositionedSession)
    .sort(
      (left, right) =>
        left.startMinutes - right.startMinutes || left.session.id.localeCompare(right.session.id),
    );

  const clusters: OverlapCluster[] = [];
  let clusterSessions: PositionedSession[] = [];
  let clusterEnd = -1;

  for (const positionedSession of positioned) {
    if (clusterSessions.length > 0 && positionedSession.startMinutes >= clusterEnd) {
      clusters.push({ id: `${dayIndex}-${clusters.length}`, sessions: clusterSessions });
      clusterSessions = [];
      clusterEnd = -1;
    }
    clusterSessions.push(positionedSession);
    clusterEnd = Math.max(clusterEnd, positionedSession.endMinutes);
  }

  if (clusterSessions.length > 0) {
    clusters.push({ id: `${dayIndex}-${clusters.length}`, sessions: clusterSessions });
  }
  return clusters;
}

/** Monday-Sunday business-date range containing `anchorDate`, both bounds inclusive. */
export function getWeekRange(anchorDate: string): { weekStart: string; weekEnd: string } {
  const anchor = parseBusinessDate(anchorDate);
  const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - daysSinceMonday);
  const weekStart = formatBusinessDate(anchor);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}

function SessionCard({
  positioned,
  lane,
  laneCount,
  onClick,
}: {
  positioned: PositionedSession;
  lane: number;
  laneCount: number;
  onClick: () => void;
}): JSX.Element {
  const { session, startMinutes, displayDurationMinutes } = positioned;
  const top = (startMinutes / 60) * HOUR_HEIGHT;
  const height = Math.max(HOUR_HEIGHT, (displayDurationMinutes / 60) * HOUR_HEIGHT);

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute overflow-hidden rounded-sm border border-input bg-accent px-1.5 py-1 text-left text-accent-foreground text-xs hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      style={{
        top,
        height,
        left: `${(lane / laneCount) * 100}%`,
        width: `${100 / laneCount}%`,
      }}
    >
      <span className="flex min-w-0 items-center gap-1 font-medium">
        {session.status === "OPEN" ? (
          <span
            role="img"
            className="size-1.5 rounded-full bg-positive"
            title={sessionsLabels.calendar.activeLabel}
            aria-label={sessionsLabels.calendar.activeLabel}
          />
        ) : null}
        <span className="truncate">{sessionsLabels.typeLabels[session.type]}</span>
      </span>
      <span className="block truncate text-accent-foreground/80">{formatTimeRange(session)}</span>
    </button>
  );
}

export function WeeklyCalendar({
  sessions,
  weekStart,
  onSessionClick,
}: WeeklyCalendarProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [openClusterId, setOpenClusterId] = useState<string | null>(null);
  const days = useMemo(
    () => Array.from({ length: DAY_COUNT }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const clustersByDay = useMemo(
    () =>
      days.map((day, dayIndex) =>
        groupOverlapClusters(
          sessions.filter((session) => session.businessDate === day),
          dayIndex,
        ),
      ),
    [days, sessions],
  );

  useEffect(() => {
    const earliestHour = sessions.reduce<number | null>((earliest, session) => {
      if (!session.startedAt) return earliest;
      const hour = new Date(session.startedAt).getHours();
      return earliest === null ? hour : Math.min(earliest, hour);
    }, null);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(
        0,
        ((earliestHour ?? FALLBACK_SCROLL_HOUR) - 1) * HOUR_HEIGHT,
      );
    }
  }, [sessions]);

  useEffect(() => {
    if (!openClusterId) return;
    function handleOutsideClick(event: MouseEvent): void {
      if (!(event.target instanceof Node) || overlayRef.current?.contains(event.target)) return;
      setOpenClusterId(null);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [openClusterId]);

  const today = formatLocalBusinessDate(new Date());
  const todayIndex = days.indexOf(today);
  const now = new Date();
  const nowTop = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;

  return (
    <div
      ref={scrollRef}
      className="h-[32rem] overflow-x-auto overflow-y-auto rounded-lg border border-border bg-card"
    >
      <div className="min-w-[792px]">
        <div
          className="sticky top-0 z-30 grid border-b border-border bg-card text-xs font-medium text-muted-foreground"
          style={{ gridTemplateColumns: "64px repeat(7, 1fr)" }}
        >
          <div className="sticky left-0 z-40 bg-card" />
          {days.map((day) => (
            <div key={day} className="border-l border-border px-2 py-2 text-center capitalize">
              {dayHeaderFormatter.format(new Date(`${day}T12:00:00`))}
            </div>
          ))}
        </div>

        <div
          className="relative grid"
          style={{
            gridTemplateColumns: "64px repeat(7, 1fr)",
            gridTemplateRows: "repeat(24, minmax(48px, auto))",
          }}
        >
          {HOURS.map((hourLabel) => {
            const hour = Number(hourLabel);
            return (
              <div
                key={hourLabel}
                className="sticky left-0 z-20 border-t border-border bg-card px-2 pt-1 text-right text-subtle-foreground text-xs tabular-nums"
                style={{ gridColumn: 1, gridRow: hour + 1 }}
              >
                {hourLabel}:00
              </div>
            );
          })}

          {days.map((day, dayIndex) => (
            <div
              key={day}
              className="relative border-l border-border bg-card"
              style={{ gridColumn: dayIndex + 2, gridRow: "1 / span 24" }}
            >
              {HOURS.map((hourLabel) => (
                <div
                  key={hourLabel}
                  className="absolute right-0 left-0 border-t border-border"
                  style={{ top: Number(hourLabel) * HOUR_HEIGHT }}
                />
              ))}

              {clustersByDay[dayIndex]?.flatMap((cluster) => {
                const visible =
                  cluster.sessions.length >= 4 ? cluster.sessions.slice(0, 2) : cluster.sessions;
                const hidden = cluster.sessions.length >= 4 ? cluster.sessions.slice(2) : [];
                const laneCount = cluster.sessions.length >= 4 ? 3 : cluster.sessions.length;
                const clusterTop = Math.min(...cluster.sessions.map((item) => item.startMinutes));

                return [
                  ...visible.map((positioned, lane) => (
                    <SessionCard
                      key={positioned.session.id}
                      positioned={positioned}
                      lane={lane}
                      laneCount={laneCount}
                      onClick={() => onSessionClick(positioned.session)}
                    />
                  )),
                  hidden.length > 0 ? (
                    <div
                      key={`${cluster.id}-more`}
                      ref={openClusterId === cluster.id ? overlayRef : undefined}
                      className="absolute z-10 px-0.5"
                      style={{
                        top: (clusterTop / 60) * HOUR_HEIGHT,
                        left: `${(2 / laneCount) * 100}%`,
                        width: `${100 / laneCount}%`,
                      }}
                    >
                      <button
                        type="button"
                        aria-expanded={openClusterId === cluster.id}
                        className="h-8 w-full truncate rounded-sm border border-border bg-card px-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() =>
                          setOpenClusterId((current) =>
                            current === cluster.id ? null : cluster.id,
                          )
                        }
                      >
                        {sessionsLabels.calendar.moreSessions(hidden.length)}
                      </button>
                      {openClusterId === cluster.id ? (
                        <div className="absolute top-full right-0 z-20 mt-1 flex w-44 flex-col gap-0.5 rounded-md border border-border bg-card p-1 shadow-lg">
                          {hidden.map((positioned) => (
                            <button
                              key={positioned.session.id}
                              type="button"
                              className="rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={() => {
                                setOpenClusterId(null);
                                onSessionClick(positioned.session);
                              }}
                            >
                              <span className="block truncate font-medium">
                                {sessionsLabels.typeLabels[positioned.session.type]}
                              </span>
                              <span className="block truncate text-muted-foreground">
                                {formatTimeRange(positioned.session)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null,
                ];
              })}

              {todayIndex === dayIndex ? (
                <div
                  className="pointer-events-none absolute right-0 left-0 z-10 h-px bg-foreground"
                  style={{ top: nowTop }}
                >
                  <span className="absolute -top-1 -left-1 size-2 rounded-full bg-foreground" />
                </div>
              ) : null}
            </div>
          ))}

          {sessions.length === 0 ? (
            <p className="pointer-events-none absolute top-4 right-4 left-20 z-10 text-center text-muted-foreground text-sm">
              {sessionsLabels.calendar.noSessionsWeek}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

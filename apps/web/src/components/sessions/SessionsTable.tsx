// SC-09 sessions table: all sessions, duration, shared-cost total, linked-event count, status.
//
// No Bs/h column — KOK-051 computes that later (packages/shared/src/sessions.ts's
// `SessionListItemDto` header note); this table renders a "—" placeholder nowhere at all, it
// simply omits the column rather than compute anything client-side.
//
// Read + row-click only (no inline edit here) — same precedent as PurchasesTable.

import type { SessionListItemDto } from "@kokoro/shared";
import { formatMoney, toCentavos } from "@kokoro/shared";
import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { Badge } from "@/components/ui/badge";
import { sessionsLabels } from "@/lib/i18n-sessions";

export interface SessionsTableProps {
  sessions: SessionListItemDto[];
  loading?: boolean;
  onRowClick?: (session: SessionListItemDto) => void;
}

/** Formats stored/derived minutes as "1h 30m" (or "30m" under an hour) — `durationMin` is already
 * COALESCEd by `v_session_hours` server-side, so this is display-only, no derivation here. */
export function formatDuration(durationMin: number | null): string {
  if (durationMin === null) return sessionsLabels.noDuration;
  const hours = Math.floor(durationMin / 60);
  const minutes = durationMin % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function SessionsTable({ sessions, loading, onRowClick }: SessionsTableProps) {
  const columns: EventTableColumn<SessionListItemDto>[] = [
    {
      id: "date",
      header: sessionsLabels.columnDate,
      isRowIdentifier: true,
      cell: (row) => row.businessDate,
    },
    {
      id: "type",
      header: sessionsLabels.columnType,
      cell: (row) => sessionsLabels.typeLabels[row.type],
    },
    {
      id: "duration",
      header: sessionsLabels.columnDuration,
      cell: (row) => formatDuration(row.durationMin),
    },
    {
      id: "costs",
      header: sessionsLabels.columnCosts,
      numeric: true,
      cell: (row) => formatMoney(toCentavos(row.costsTotal)),
    },
    {
      id: "linkedEvents",
      header: sessionsLabels.columnLinkedEvents,
      cell: (row) =>
        row.linkedEventCount > 0 ? (
          <Badge variant="muted">{row.linkedEventCount}</Badge>
        ) : (
          <span className="text-subtle-foreground">—</span>
        ),
    },
    {
      id: "status",
      header: sessionsLabels.columnStatus,
      cell: (row) => (
        <Badge variant={row.status === "OPEN" ? "default" : "muted"}>
          {sessionsLabels.statusLabels[row.status]}
        </Badge>
      ),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={sessions}
      getRowId={(row) => row.id}
      onRowClick={onRowClick}
      emptyMessage={sessionsLabels.noSessions}
      loading={loading}
      loadingMessage={sessionsLabels.loading}
    />
  );
}

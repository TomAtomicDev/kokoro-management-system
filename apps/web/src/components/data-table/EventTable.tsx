// Generic list-page table (Doc 06 §4 "EventTable"): column defs, server-provided rows, row ->
// drawer. Doc 06 names TanStack Table as the target implementation; this hand-rolled version ships
// now (KOK-011 is the first consumer) to avoid a new dependency before a second consumer justifies
// the investment (D-10). It already covers column defs + row click; swap the internals for
// @tanstack/react-table later without touching call sites if sorting/pagination need it.

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EventTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-aligns + applies tabular-nums (Doc 06 §3: mandatory on every numeric column). */
  numeric?: boolean;
  className?: string;
}

export interface EventTableProps<T> {
  columns: EventTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage: string;
  loading?: boolean;
  loadingMessage?: string;
}

export function EventTable<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  emptyMessage,
  loading,
  loadingMessage,
}: EventTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className={cn("px-4 py-2.5", col.numeric && "text-right", col.className)}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-6 text-center text-sm text-muted-foreground"
              >
                {loadingMessage}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-6 text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === "Enter") onRowClick(row);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  "border-b border-border last:border-0",
                  onRowClick &&
                    "cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      "px-4 py-2.5 align-middle",
                      col.numeric && "numeric-cell text-right",
                      col.className,
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

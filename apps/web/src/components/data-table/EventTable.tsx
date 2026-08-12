// Generic list-page table (Doc 06 §4 "EventTable"): column defs, server-provided rows, row ->
// drawer. Doc 06 names TanStack Table as the target implementation; this hand-rolled version ships
// now (KOK-011 is the first consumer) to avoid a new dependency before a second consumer justifies
// the investment (D-10). It already covers column defs + row click; swap the internals for
// @tanstack/react-table later without touching call sites if sorting/pagination need it.

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type EventTableSortValue = string | number | null | undefined;
type SortDirection = "ascending" | "descending";

const spanishCollator = new Intl.Collator("es-BO", {
  numeric: true,
  sensitivity: "variant",
});

function compareSortValues(
  left: EventTableSortValue,
  right: EventTableSortValue,
  numeric: boolean,
  direction: SortDirection,
): number {
  // Missing values stay at the bottom in both directions so their position is predictable.
  if (left === null || left === undefined || right === null || right === undefined) {
    if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
    return -1;
  }

  const comparison =
    numeric && typeof left === "number" && typeof right === "number"
      ? left - right
      : spanishCollator.compare(String(left), String(right));

  return direction === "ascending" ? comparison : -comparison;
}

export interface EventTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-aligns + applies tabular-nums (Doc 06 §3: mandatory on every numeric column). */
  numeric?: boolean;
  className?: string;
  /** Enables client-side sorting when paired with a comparable value accessor. */
  sortable?: boolean;
  sortValue?: (row: T) => EventTableSortValue;
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
  const [sortState, setSortState] = useState<{ columnId: string; direction: SortDirection } | null>(
    null,
  );

  const sortedRows = useMemo(() => {
    if (!sortState) return rows;

    const sortColumn = columns.find((column) => column.id === sortState.columnId);
    if (!sortColumn?.sortable || !sortColumn.sortValue) return rows;

    const sortValue = sortColumn.sortValue;
    return rows
      .map((row, index) => ({ row, index, value: sortValue(row) }))
      .sort((left, right) => {
        const comparison = compareSortValues(
          left.value,
          right.value,
          sortColumn.numeric === true,
          sortState.direction,
        );
        return comparison === 0 ? left.index - right.index : comparison;
      })
      .map(({ row }) => row);
  }, [columns, rows, sortState]);

  function handleSort(column: EventTableColumn<T>): void {
    if (!column.sortable || !column.sortValue) return;

    setSortState((current) => {
      if (!current || current.columnId !== column.id) {
        return { columnId: column.id, direction: "ascending" };
      }

      return current.direction === "ascending"
        ? { columnId: column.id, direction: "descending" }
        : null;
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="sticky top-0 z-10 border-b border-border bg-card text-left text-xs font-medium text-muted-foreground">
            {columns.map((col) => {
              const sortable = col.sortable === true && col.sortValue !== undefined;
              const direction =
                sortable && sortState?.columnId === col.id ? sortState.direction : null;

              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={sortable ? (direction ?? "none") : undefined}
                  className={cn("px-4 py-2.5", col.numeric && "text-right", col.className)}
                >
                  {sortable ? (
                    <button
                      type="button"
                      aria-label={col.header}
                      onClick={() => handleSort(col)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm p-0 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        col.numeric && "justify-end",
                      )}
                    >
                      <span>{col.header}</span>
                      {direction === "ascending" ? (
                        <ArrowUp aria-hidden="true" className="size-3.5" />
                      ) : direction === "descending" ? (
                        <ArrowDown aria-hidden="true" className="size-3.5" />
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="size-3.5" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
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
            sortedRows.map((row) => (
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

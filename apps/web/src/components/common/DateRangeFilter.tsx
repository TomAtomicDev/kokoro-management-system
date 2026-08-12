import { nowIso, toBusinessDate } from "@kokoro/shared";
import type { ReactElement } from "react";

import { Input } from "@/components/ui/input";
import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

export interface DateRange {
  fromDate: string;
  toDate: string;
}

export interface DateRangeFilterProps {
  fromDate: string;
  toDate: string;
  onChange: (range: DateRange) => void;
  className?: string;
}

/** The default business-date range used by Ventas, Pedidos and Salidas. */
export function getDefaultDateRange(): DateRange {
  const today = toBusinessDate(nowIso());
  return { fromDate: `${today.slice(0, 7)}-01`, toDate: today };
}

/** A compact, controlled date-range filter shared by the three period-based list screens. */
export function DateRangeFilter({
  fromDate,
  toDate,
  onChange,
  className,
}: DateRangeFilterProps): ReactElement {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <div className="flex flex-col gap-1">
        <label htmlFor="date-range-from" className="font-medium text-foreground text-xs">
          {inventoryLabels.dateRangeFrom}
        </label>
        <Input
          id="date-range-from"
          type="date"
          value={fromDate}
          max={toDate}
          onChange={(event) => {
            const nextFromDate = event.currentTarget.value;
            if (nextFromDate) onChange({ fromDate: nextFromDate, toDate });
          }}
          className="w-auto"
          aria-label={inventoryLabels.dateRangeFrom}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="date-range-to" className="font-medium text-foreground text-xs">
          {inventoryLabels.dateRangeTo}
        </label>
        <Input
          id="date-range-to"
          type="date"
          value={toDate}
          min={fromDate}
          onChange={(event) => {
            const nextToDate = event.currentTarget.value;
            if (nextToDate) onChange({ fromDate, toDate: nextToDate });
          }}
          className="w-auto"
          aria-label={inventoryLabels.dateRangeTo}
        />
      </div>
    </div>
  );
}

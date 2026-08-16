import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PinnedSummaryFooterProps {
  total: ReactNode;
  destination?: ReactNode;
  warnings?: ReactNode;
  actions: ReactNode;
  contentClassName?: string;
}

/**
 * A reusable form footer that keeps the decision-critical summary and actions visible while the
 * form body scrolls. Callers can provide a destination/account control and any live warnings.
 */
export function PinnedSummaryFooter({
  total,
  destination,
  warnings,
  actions,
  contentClassName,
}: PinnedSummaryFooterProps): ReactElement {
  return (
    <div className="shrink-0 border-border border-t bg-card py-2">
      <div className={cn("mx-auto flex w-full flex-col gap-2 px-5", contentClassName)}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {destination ? (
              <div className="flex min-w-0 items-center gap-2">{destination}</div>
            ) : null}
            {warnings ? <div className="flex flex-col gap-1 text-xs">{warnings}</div> : null}
          </div>
          <div className="flex shrink-0 items-baseline justify-between gap-3 sm:flex-col sm:items-end">
            {total}
          </div>
        </div>
        <div className="flex justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

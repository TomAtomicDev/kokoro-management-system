// Minimal "calculado" affordance for a derived value (Doc 06 §4 CalcTrace contract). The full
// interactive version — formula breakdown + live inputs — is KOK-029's job; this stub only proves
// the value is derived, not manually entered, via a small info icon whose native `title` tooltip
// carries the formula text. No popover/tooltip component needed for that (that's the whole point
// of "stub" — see catalogLabels.calculated / ItemForm.tsx's inline "(calculado)" text for the
// same idea rendered without an icon).

import { Info } from "lucide-react";

import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

export interface CalcTraceStubProps {
  /** Plain-text formula shown as the native tooltip on hover, e.g. "cantidad en stock × costo
   * promedio ponderado". */
  formula: string;
  className?: string;
}

export function CalcTraceStub({ formula, className }: CalcTraceStubProps) {
  return (
    <span
      title={formula}
      className={cn("inline-flex items-center gap-0.5 text-muted-foreground text-xs", className)}
    >
      <Info className="size-3" aria-hidden="true" />
      {inventoryLabels.calculated}
    </span>
  );
}

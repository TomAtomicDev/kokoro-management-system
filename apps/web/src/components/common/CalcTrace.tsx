// Full "calculado" popover (KOK-029, Doc 06 §1 principle 3 / §4 CalcTrace: "popover explaining a
// derived number — formula + inputs"). Replaces KOK-017's CalcTraceStub (a native-tooltip-only
// affordance) everywhere it was used: StockTable, RecipeForm/RecipeDetailDrawer,
// ProductionRunForm.
//
// Handwritten, click-triggered, portaled — no new dependency (D-10, same call this repo's Dialog
// primitive already made; see components/ui/dialog.tsx's header). A portal (not a plain
// absolutely-positioned `<div>` inside the trigger's own stacking context) is necessary here
// specifically because every call site lives inside a scrolling/overflow-clipped container
// (EventTable's cells, a form's scrollable panel) that would otherwise clip the popover.
// Click-triggered rather than hover-triggered: hover popovers are not reachable by keyboard/touch,
// and this app's one interactive owner user is frequently on a phone (Doc 01).

import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { inventoryLabels } from "@/lib/i18n-inventory";
import { cn } from "@/lib/utils";

export interface CalcTraceInput {
  label: string;
  /** Pre-formatted display value (e.g. via `formatMoney`/`formatQty`) — this component renders
   * plain text, it does not know about money/qty conventions (D-5: that formatting lives in
   * money.ts/qty.ts, called by whoever builds the `inputs` array). */
  value: string;
}

export interface CalcTraceProps {
  /** Plain-text formula, e.g. "cantidad en stock × costo promedio ponderado". */
  formula: string;
  /** Itemized breakdown behind the formula (Doc 06 principle 3: "tapping shows the calculation
   * trace"). Omitted when the caller has no line-level breakdown to show — the formula text alone
   * still satisfies "visibly derived". */
  inputs?: readonly CalcTraceInput[];
  className?: string;
}

export function CalcTrace({ formula, inputs, className }: CalcTraceProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Clamped so a trigger near the right edge (common in a right-aligned money column) doesn't
      // push the panel off-screen — 256px matches the panel's own w-64 below.
      const left = Math.min(rect.left, window.innerWidth - 256 - 8);
      setPosition({ top: rect.bottom + 4, left: Math.max(8, left) });
    }
    updatePosition();

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <span className={cn("inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="inline-flex items-center gap-0.5 text-muted-foreground text-xs hover:text-foreground"
      >
        <Info className="size-3" aria-hidden="true" />
        {inventoryLabels.calculated}
      </button>
      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={formula}
              style={{ position: "fixed", top: position.top, left: position.left }}
              className="z-50 w-64 rounded-md border border-border bg-popover p-3 text-popover-foreground text-xs shadow-md"
            >
              <p className="font-medium">{formula}</p>
              {inputs && inputs.length > 0 ? (
                <dl className="mt-2 flex flex-col gap-1 border-border border-t pt-2">
                  {inputs.map((input) => (
                    <div key={input.label} className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">{input.label}</dt>
                      <dd className="numeric-cell">{input.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

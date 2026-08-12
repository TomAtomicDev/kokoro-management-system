import { Info } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export interface InfoTooltipProps {
  /** Concise, plain-language explanation shown after activating the info trigger. */
  content: ReactNode;
  /** Accessible name for the icon-only trigger, aligned with the nearby field label. */
  label: string;
  className?: string;
}

/**
 * Small explanatory tooltip for form labels and section headings.
 *
 * It is click-triggered (rather than hover-only) so it works with keyboard and touch, and its
 * portal keeps the panel visible inside scrolling dialogs and drawers. This follows CalcTrace's
 * existing hand-rolled overlay pattern without adding another dependency (D-10).
 */
export function InfoTooltip({ content, label, className }: InfoTooltipProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) return;

      const panelRect = panelRef.current?.getBoundingClientRect();
      const panelWidth = panelRect?.width ?? Math.min(288, window.innerWidth - 16);
      const panelHeight = panelRect?.height ?? 120;
      const left = Math.min(
        Math.max(8, triggerRect.left - 8),
        Math.max(8, window.innerWidth - panelWidth - 8),
      );
      const belowTop = triggerRect.bottom + 6;
      const top =
        belowTop + panelHeight <= window.innerHeight - 8
          ? belowTop
          : Math.max(8, triggerRect.top - panelHeight - 6);
      setPosition({ top, left });
    }

    updatePosition();

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
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
    <span className={cn("inline-flex align-middle", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-controls={tooltipId}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-fast hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Info className="size-3" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={tooltipId}
              role="tooltip"
              style={{
                position: "fixed",
                top: position?.top ?? 8,
                left: position?.left ?? 8,
              }}
              className="z-50 w-72 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground text-xs leading-relaxed shadow-md"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

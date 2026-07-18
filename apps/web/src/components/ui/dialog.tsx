// Handwritten accessible modal/drawer primitive — Escape to close, backdrop click to close,
// initial focus on the panel, body-scroll lock while open. No Radix dependency added (D-10):
// this repo's guidance prefers 1-2 small Radix additions if truly needed, but a single
// overlay+panel primitive is small enough to own directly and reuse everywhere (DetailDrawer,
// confirm dialogs, ItemPicker's inline-create panel) without taking on a new package for it.
// Not a full focus trap (Tab can still escape to the browser chrome) — acceptable for a v1 given
// this app has exactly one interactive owner user; revisit if that stops being true.

import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /** "center" for confirm/create dialogs (Doc 06 default), "right" for the DetailDrawer pattern. */
  placement?: "center" | "right";
  "aria-label"?: string;
}

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  placement = "center",
  ...aria
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    contentRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  // Native <dialog> would need a showModal()/close() lifecycle + ::backdrop styling rework; this
  // div already implements the WAI-ARIA dialog pattern correctly (role, aria-modal,
  // Escape-to-close, initial focus) and is the safer choice to keep working right now.
  const panel = (
    <div
      ref={contentRef}
      // biome-ignore lint/a11y/useSemanticElements: see the comment above const panel.
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className={cn(
        "relative z-10 flex flex-col bg-card text-card-foreground shadow-lg outline-none",
        placement === "center"
          ? "m-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border"
          : "ml-auto h-full w-full max-w-md border-l border-border",
        className,
      )}
      {...aria}
    >
      {children}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <button
        type="button"
        aria-label="Cerrar"
        className="fixed inset-0 bg-foreground/40"
        onClick={() => onOpenChange(false)}
      />
      {panel}
    </div>,
    document.body,
  );
}

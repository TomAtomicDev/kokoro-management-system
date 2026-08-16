// Handwritten accessible modal/drawer primitive — Escape to close, backdrop click to close,
// initial focus on the panel, body-scroll lock while open. No Radix dependency added (D-10):
// this repo's guidance prefers 1-2 small Radix additions if truly needed, but a single
// overlay+panel primitive is small enough to own directly and reuse everywhere (DetailDrawer,
// confirm dialogs, ItemPicker's inline-create panel) without taking on a new package for it.
// Not a full focus trap (Tab can still escape to the browser chrome) — acceptable for a v1 given
// this app has exactly one interactive owner user; revisit if that stops being true.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /** "center" for confirm/create dialogs (Doc 06 default), "right" for the DetailDrawer pattern. */
  placement?: "center" | "right";
  "aria-label"?: string;
  /** Explicit form dirty state for dialogs whose values are initialized asynchronously. */
  unsavedChanges?: boolean;
  /** Used by drawers whose state intentionally persists across close (e.g. count editing). */
  disableUnsavedChangesGuard?: boolean;
}

function readControlSnapshot(panel: HTMLDivElement): string {
  const controls = Array.from(panel.querySelectorAll("input,select,textarea")).map((control) => {
    const element = control as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    return {
      tagName: element.tagName,
      value: element.value,
      checked: element.tagName === "INPUT" ? (element as HTMLInputElement).checked : undefined,
      selectedIndex:
        element.tagName === "SELECT" ? (element as HTMLSelectElement).selectedIndex : undefined,
      files:
        element.tagName === "INPUT"
          ? ((element as HTMLInputElement).files?.length ?? 0)
          : undefined,
    };
  });
  return JSON.stringify(controls);
}

export function Dialog({
  open,
  onOpenChange,
  children,
  className,
  placement = "center",
  unsavedChanges,
  disableUnsavedChangesGuard = false,
  ...aria
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const initialSnapshotRef = useRef<string | null>(null);
  const [domDirty, setDomDirty] = useState(false);
  const tracksDomState = unsavedChanges === undefined && !disableUnsavedChangesGuard;

  useEffect(() => {
    if (!open || !tracksDomState) {
      initialSnapshotRef.current = null;
      setDomDirty(false);
      return;
    }

    const panel = contentRef.current;
    if (!panel) return;

    let updateTimer: number | undefined;
    const updateDirty = () => {
      if (updateTimer !== undefined) window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(() => {
        const initialSnapshot = initialSnapshotRef.current;
        if (initialSnapshot !== null) {
          setDomDirty(readControlSnapshot(panel) !== initialSnapshot);
        }
      }, 0);
    };

    // Form components seed their controlled values in an effect after the dialog opens. Waiting one
    // task means those values become the baseline rather than being mistaken for user edits.
    const initialTimer = window.setTimeout(() => {
      initialSnapshotRef.current = readControlSnapshot(panel);
      setDomDirty(false);
    }, 0);

    panel.addEventListener("input", updateDirty, true);
    panel.addEventListener("change", updateDirty, true);
    panel.addEventListener("click", updateDirty, true);
    return () => {
      window.clearTimeout(initialTimer);
      if (updateTimer !== undefined) window.clearTimeout(updateTimer);
      panel.removeEventListener("input", updateDirty, true);
      panel.removeEventListener("change", updateDirty, true);
      panel.removeEventListener("click", updateDirty, true);
    };
  }, [open, tracksDomState]);

  const guard = useUnsavedChangesGuard({
    isDirty: unsavedChanges ?? domDirty,
    enabled: open && !disableUnsavedChangesGuard,
  });

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      if (nextOpen || guard.confirmDiscard()) onOpenChange(nextOpen);
    },
    [guard.confirmDiscard, onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    contentRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [handleOpenChange, open]);

  if (!open) return null;

  // Native <dialog> would need a showModal()/close() lifecycle + ::backdrop styling rework; this
  // div already implements the WAI-ARIA dialog pattern correctly (role, aria-modal,
  // Escape-to-close, initial focus) and is the safer choice to keep working right now.
  const panel = (
    <div
      ref={contentRef}
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
        onClick={() => handleOpenChange(false)}
      />
      {panel}
    </div>,
    document.body,
  );
}

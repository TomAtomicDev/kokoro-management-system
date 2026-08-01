import { createContext, useContext } from "react";

// Shares AppShell's quick-add-modal open trigger with descendants that need to open it from
// outside the persistent shell — currently just the dashboard's `QuickAddShortcuts` (KOK-023, Doc
// 06 §4: QuickAddModal is "opened from +, ⌘K, or dashboard shortcuts"). AppShell remains the sole
// owner of the open/closed boolean and renders the modal itself; this context only exposes the one
// action a screen needs ("open it"), not the full open state, so a screen can't desync the modal
// from AppShell's own idea of whether it's open.
interface QuickAddContextValue {
  openQuickAdd: () => void;
}

export const QuickAddContext = createContext<QuickAddContextValue | null>(null);

export function useQuickAdd(): QuickAddContextValue {
  const ctx = useContext(QuickAddContext);
  if (!ctx) {
    throw new Error("useQuickAdd must be used within AppShell's QuickAddContext.Provider.");
  }
  return ctx;
}

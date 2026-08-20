// Global connectivity-error dialog (KOK-171 / F-22). Agreement A-9 requires an explicit error
// dialog for connectivity failures, not a toast — toasts auto-dismiss and can go unnoticed, while
// losing connectivity mid-form is exactly the moment a silent failure is most costly. Mirrors
// toast.tsx's global pub-sub shape (a non-React module like lib/api.ts can't call a React hook)
// but holds a single active message rather than a queue: only one connectivity dialog can be
// meaningful on screen at a time, so a second failure while one is open just keeps it open.

import { useEffect, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

type GlobalErrorDialogListener = (message: string) => void;
const globalErrorDialogListeners = new Set<GlobalErrorDialogListener>();

/** Publishes a connectivity error dialog from non-React infrastructure such as the shared API client. */
export function showGlobalErrorDialog(message: string): void {
  for (const listener of globalErrorDialogListeners) listener(message);
}

export function GlobalErrorDialogProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const listener: GlobalErrorDialogListener = (nextMessage) => setMessage(nextMessage);
    globalErrorDialogListeners.add(listener);
    return () => {
      globalErrorDialogListeners.delete(listener);
    };
  }, []);

  return (
    <>
      {children}
      <ConfirmDialog
        open={message !== null}
        title="Sin conexión"
        description={message ?? ""}
        onConfirm={() => setMessage(null)}
        confirmLabel="Entendido"
      />
    </>
  );
}

import { X } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { dismissFormSaveError, subscribeToFormSaveErrors } from "@/lib/form-save-errors";
import { commonLabels } from "@/lib/i18n-common";

export function FormSaveErrorAlertProvider({ children }: { children: ReactNode }): ReactElement {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => subscribeToFormSaveErrors(setMessage), []);

  return (
    <>
      {children}
      {message ? <FormSaveErrorAlert message={message} /> : null}
    </>
  );
}

function FormSaveErrorAlert({ message }: { message: string }) {
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
      <div
        role="alert"
        className="pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-md border border-negative bg-negative-bg px-4 py-3 text-foreground text-sm shadow-lg"
      >
        <p className="min-w-0 flex-1">{message}</p>
        <button
          type="button"
          aria-label={commonLabels.dismissFormSaveError}
          className="-mr-1 -mt-0.5 shrink-0 rounded-sm p-1 text-negative hover:bg-negative/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative"
          onClick={dismissFormSaveError}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

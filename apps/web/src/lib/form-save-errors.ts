import { ApiError } from "@/lib/api";

export const FORM_SAVE_ERROR_META = { formSaveError: true } as const;

interface FormSaveErrorMeta {
  formSaveError?: unknown;
  suppressConflictAlert?: unknown;
}

type FormSaveErrorListener = (message: string | null) => void;

let activeFormSaveError: string | null = null;
const formSaveErrorListeners = new Set<FormSaveErrorListener>();

/** API failures from a form-save mutation to show in the persistent global alert. */
export function getFormSaveErrorMessage(
  meta: FormSaveErrorMeta | undefined,
  error: unknown,
): string | null {
  if (meta?.formSaveError !== true || !(error instanceof ApiError)) return null;
  if (error.code === "UNAUTHORIZED" || error.code === "NETWORK_ERROR") return null;

  const details = error.details;
  const replayConfirmationRequired =
    error.code === "CONFLICT" &&
    typeof details === "object" &&
    details !== null &&
    "reason" in details &&
    details.reason === "REPLAY_CONFIRMATION_REQUIRED";
  if (replayConfirmationRequired) return null;
  if (error.code === "CONFLICT" && meta.suppressConflictAlert === true) return null;

  return error.message || null;
}

/** Publishes the server's message_es for a failed save without an automatic dismissal timer. */
export function showFormSaveError(message: string): void {
  activeFormSaveError = message;
  for (const listener of formSaveErrorListeners) listener(activeFormSaveError);
}

/** Clears the persistent alert only after an explicit user dismissal. */
export function dismissFormSaveError(): void {
  activeFormSaveError = null;
  for (const listener of formSaveErrorListeners) listener(activeFormSaveError);
}

export function subscribeToFormSaveErrors(listener: FormSaveErrorListener): () => void {
  formSaveErrorListeners.add(listener);
  listener(activeFormSaveError);
  return () => formSaveErrorListeners.delete(listener);
}

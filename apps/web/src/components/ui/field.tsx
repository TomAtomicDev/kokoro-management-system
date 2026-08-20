// Shared label/asterisk/tooltip/error markup for form fields (KOK-143). Every form field renders
// its label and error through this so required-field marking and error presentation stay
// consistent app-wide instead of each form inventing its own — this is what used to be ItemForm's
// private `Field` helper, promoted here so PurchaseForm/SaleForm/onboarding can adopt it too.

import type { ReactNode } from "react";

import { InfoTooltip } from "@/components/ui/tooltip";

export interface FieldLabelProps {
  label: string;
  htmlFor: string;
  /** Renders a red asterisk after the label — visual required-field mark (KOK-143). */
  required?: boolean;
  tooltip?: string;
}

export function FieldLabel({ label, htmlFor, required, tooltip }: FieldLabelProps) {
  return (
    <div className="flex items-center gap-1">
      <label htmlFor={htmlFor} className="font-medium text-foreground">
        {label}
        {required ? (
          <span className="text-negative" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {tooltip ? <InfoTooltip content={tooltip} label={`Más información: ${label}`} /> : null}
    </div>
  );
}

export interface FieldErrorProps {
  id: string;
  message?: string;
}

/** Renders nothing when `message` is absent, so callers can pass a possibly-undefined live error
 * straight through without an extra conditional. */
export function FieldError({ id, message }: FieldErrorProps) {
  if (!message) return null;
  return (
    <p id={id} className="text-negative text-xs" role="alert">
      {message}
    </p>
  );
}

export interface FieldProps {
  label: string;
  htmlFor: string;
  tooltip?: string;
  required?: boolean;
  /** Live field error (KOK-143) — shown below `children` when the caller decides it's visible
   * (see `useFieldValidation`'s `isVisible`). Omit for fields with no validation. */
  error?: string;
  /** Defaults to `${htmlFor}-error`; pass to line up with a manual `aria-describedby`. */
  errorId?: string;
  children: ReactNode;
}

/** Full field wrapper: label (+ optional required mark/tooltip), the field itself, and its live
 * error. Compose `FieldLabel`/`FieldError` directly instead when a field's layout doesn't fit this
 * shape (e.g. LineEditor's per-row grid cells). */
export function Field({ label, htmlFor, tooltip, required, error, errorId, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <FieldLabel label={label} htmlFor={htmlFor} required={required} tooltip={tooltip} />
      {children}
      <FieldError id={errorId ?? `${htmlFor}-error`} message={error} />
    </div>
  );
}

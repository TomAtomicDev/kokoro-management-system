// Lightweight reusable confirmation dialog for simple yes/no state-transition prompts that don't
// need ImpactConfirmDialog's replay-impact rows (cost delta, affected-row counts). Generic Spanish
// button-label defaults live here, not imported from any feature's i18n file — same rationale as
// ImpactConfirmDialog: a shared ui/ primitive never imports a features/ file. Replaces native
// `window.confirm` popups (KOK-170), which render inconsistently across browsers/PWA contexts and
// don't match this app's Dialog styling.

import { Button } from "./button";
import { Dialog } from "./dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  /** Omit to render a single-button "acknowledge" dialog with no cancel action. */
  onCancel?: () => void;
  confirmLoading?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for the confirm button. Defaults to the neutral "default" look. */
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLoading = false,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel?.();
      }}
      aria-label={title}
    >
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{title}</h2>
      </div>
      <div className="px-5 py-4">
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={confirmLoading}>
            {cancelLabel}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={confirmLoading}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

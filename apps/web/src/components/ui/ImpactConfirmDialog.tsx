// Presentational confirmation dialog for the R-5 "backdated replay" contract (KOK-024,
// packages/shared/src/costing.ts's ReplayImpactDto). Feature-agnostic on purpose: purchases and
// exits both need it today, and sales/production would reuse it unchanged later, so it takes its
// own Spanish copy as props (`title`/`description`) rather than importing any feature's i18n file
// (that would make this module depend on purchases/inventory, backwards from the dependency this
// repo wants — a shared ui/ primitive never imports a features/ file).

import type { ReplayImpactDto } from "@kokoro/shared";
import { formatMoney } from "@kokoro/shared";

import { cn } from "@/lib/utils";

import { Button } from "./button";
import { Dialog } from "./dialog";

export interface ImpactConfirmDialogProps {
  open: boolean;
  impact: ReplayImpactDto;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLoading?: boolean;
  /** Spanish copy owned by the calling feature (e.g. "¿Guardar los cambios?"). */
  title: string;
  /** Spanish copy owned by the calling feature, explaining what triggered the prompt (e.g. "Esta
   * compra fue editada con una fecha anterior a movimientos ya registrados."). */
  description: string;
  /** Label for the destructive confirm button. Defaults to "Confirmar". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancelar". */
  cancelLabel?: string;
}

interface ImpactRow {
  key: string;
  label: string;
  count: number;
}

/** Generic (feature-agnostic) Spanish labels for the four affected-entity buckets a replay can
 * touch — not owned by any one feature's i18n file for the same reason the component itself
 * isn't (see the file header). */
const IMPACT_ROW_LABELS = {
  affectedSaleLineIds: "Línea(s) de venta afectadas",
  affectedStockExitIds: "Salida(s) afectadas",
  affectedProductionRunIds: "Producción(es) afectadas",
  affectedItemIds: "Ítem(s) afectados",
} as const;

function buildImpactRows(impact: ReplayImpactDto): ImpactRow[] {
  return (
    [
      { key: "affectedSaleLineIds", count: impact.affectedSaleLineIds.length },
      { key: "affectedStockExitIds", count: impact.affectedStockExitIds.length },
      { key: "affectedProductionRunIds", count: impact.affectedProductionRunIds.length },
      { key: "affectedItemIds", count: impact.affectedItemIds.length },
    ] as const
  )
    .filter((row) => row.count > 0)
    .map((row) => ({ key: row.key, label: IMPACT_ROW_LABELS[row.key], count: row.count }));
}

export function ImpactConfirmDialog({
  open,
  impact,
  onConfirm,
  onCancel,
  confirmLoading = false,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
}: ImpactConfirmDialogProps) {
  const rows = buildImpactRows(impact);
  const costDeltaClass = cn(
    "numeric-cell font-medium",
    impact.costDelta < 0
      ? "text-negative"
      : impact.costDelta > 0
        ? "text-positive"
        : "text-foreground",
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      aria-label={title}
    >
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{title}</h2>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="text-muted-foreground text-sm">{description}</p>

        {rows.length > 0 ? (
          <ul className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5 text-sm">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center justify-between">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="numeric-cell font-medium text-foreground">{row.count}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center justify-between border-border border-t pt-3 text-sm">
          <span className="text-muted-foreground">Cambio de costo</span>
          <span className={costDeltaClass}>{formatMoney(impact.costDelta, { signed: true })}</span>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={confirmLoading}>
          {cancelLabel}
        </Button>
        <Button type="button" variant="destructive" onClick={onConfirm} disabled={confirmLoading}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

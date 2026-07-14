import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { navLabels } from "@/lib/i18n-nav";

// Stand-in for the real `QuickAddModal` (Doc 06 §4), which will host every event form
// (venta, compra, producción, gasto, …). Opened here from the sidebar "Registrar" item and the
// topbar "+ Registrar" button — both wire to the same `onOpenChange` state in AppShell.
export function QuickAddModalPlaceholder({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{navLabels.registrar}</h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="text-muted-foreground text-sm">
          Menú de formularios de registro rápido — próximamente.
        </p>
        <div className="mt-6 flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

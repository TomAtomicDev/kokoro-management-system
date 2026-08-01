// Right-side detail drawer (Doc 06 §4 "DetailDrawer"): view/edit modes live in `children`
// (the caller decides), this component owns the chrome — header, close button, scroll area, and
// an optional audit-trail footer slot ("editado 2 veces").
//
// KOK-067 wires the "editado N veces" half of that footer generically: pass `entityType`/
// `entityId` (the same free-text pair every core/ service already writes via buildAuditLogInsert,
// e.g. "purchases"/the purchase's id) and DetailDrawer fetches GET /api/audit/:entityType/:entityId
// itself and appends the edit count below the caller's own `footer` (which still owns
// created/updated dates — those already live on each entity's DTO, no need to re-derive them from
// the audit log). Omit both props for a drawer with no audit trail to show yet.

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useAuditLog } from "@/features/audit/api";
import { catalogLabels } from "@/lib/i18n-catalog";

export interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Created/updated-date footer content — Doc 06 §4. Omit when there's nothing to show yet. */
  footer?: ReactNode;
  /** Entity type string this drawer is showing (must match the `entityType` its core/ service
   * passes to `buildAuditLogInsert`, e.g. "purchases", "stock_exits", "item", "recipe",
   * "production_runs", "sales", "sessions"). Together with `entityId`, enables the "editado N
   * veces" line. */
  entityType?: string;
  entityId?: string;
}

/** "editado 1 vez" / "editado N veces" (Doc 06 §4) — singular has no plural "s" in Spanish "vez". */
function editCountLabel(count: number): string {
  return count === 1 ? "Editado 1 vez" : `Editado ${count} veces`;
}

export function DetailDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
  entityType,
  entityId,
}: DetailDrawerProps) {
  const auditQuery = useAuditLog(entityType ?? "", entityType ? entityId : undefined);
  const editCount = auditQuery.data?.entries.filter((entry) => entry.action === "update").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} placement="right" aria-label={title}>
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="font-medium text-foreground text-md">{title}</h2>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          aria-label={catalogLabels.close}
        >
          <X />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer || editCount ? (
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-muted-foreground text-xs">
          {footer ? <span>{footer}</span> : <span />}
          {editCount ? <span>{editCountLabel(editCount)}</span> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

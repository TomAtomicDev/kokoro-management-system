// Right-side detail drawer (Doc 06 §4 "DetailDrawer"): view/edit modes live in `children`
// (the caller decides), this component owns the chrome — header, close button, scroll area, and
// an optional audit-trail footer slot ("editado 2 veces").

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { catalogLabels } from "@/lib/i18n-catalog";

export interface DetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Audit trail footer ("editado 2 veces") — Doc 06 §4. Omit when there's nothing to show yet. */
  footer?: ReactNode;
}

export function DetailDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  footer,
}: DetailDrawerProps) {
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
      {footer ? (
        <div className="border-t border-border px-5 py-3 text-muted-foreground text-xs">
          {footer}
        </div>
      ) : null}
    </Dialog>
  );
}

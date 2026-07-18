// SC-01's quick-add shortcuts row (KOK-023). Doc 06 §4: `QuickAddModal` is "opened from `+`, ⌘K,
// or dashboard shortcuts" — one shared modal, not a per-event-type dialog. `QuickAddModalPlaceholder`
// (components/layout/QuickAddModalPlaceholder.tsx) is still a placeholder menu with no per-type
// entry point of its own, so every shortcut here opens that SAME instance via the
// `QuickAddContext` AppShell provides (judgment call: once the real QuickAddModal ships with a
// per-type initial view, these buttons are the natural place to pass that selection through).

import { Factory, ShoppingCart, Truck, Wallet } from "lucide-react";
import type { ComponentType } from "react";

import { useQuickAdd } from "@/components/layout/QuickAddContext";
import { Button } from "@/components/ui/button";
import { dashboardLabels } from "@/lib/i18n-dashboard";

const SHORTCUTS: { label: string; icon: ComponentType<{ className?: string }> }[] = [
  { label: dashboardLabels.quickAddSale, icon: ShoppingCart },
  { label: dashboardLabels.quickAddPurchase, icon: Truck },
  { label: dashboardLabels.quickAddExpense, icon: Wallet },
  { label: dashboardLabels.quickAddProduction, icon: Factory },
];

export function QuickAddShortcuts() {
  const { openQuickAdd } = useQuickAdd();

  return (
    <div className="flex flex-wrap gap-2">
      {SHORTCUTS.map(({ label, icon: Icon }) => (
        <Button key={label} type="button" variant="outline" onClick={openQuickAdd}>
          <Icon className="size-4" />
          {label}
        </Button>
      ))}
    </div>
  );
}

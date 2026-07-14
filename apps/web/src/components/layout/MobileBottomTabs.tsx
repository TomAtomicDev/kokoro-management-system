import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { mobileTabLabels } from "@/lib/i18n-nav";
import { cn } from "@/lib/utils";

import {
  type NavActionItem,
  type NavLinkItem,
  footerNav,
  mobileTabs,
  primaryNav,
} from "./nav-items";

const mobileTabPaths = new Set(mobileTabs.map((tab) => tab.to));

// Everything in the full nav that isn't already one of the 4 primary mobile tabs — surfaced in
// the "Más" sheet instead (Doc 06 §2: "Mobile web: sidebar becomes bottom tab bar (Panel, Ventas,
// Inventario, Finanzas, Más)").
const moreEntries: Array<NavLinkItem | NavActionItem> = [
  ...primaryNav.filter(
    (entry): entry is NavLinkItem | NavActionItem =>
      entry.kind !== "divider" && !(entry.kind === "link" && mobileTabPaths.has(entry.to)),
  ),
  ...footerNav,
];

export function MobileBottomTabs({
  onOpenQuickAdd,
  className,
}: {
  onOpenQuickAdd: () => void;
  className?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      <nav
        className={cn(
          "flex h-14 shrink-0 items-stretch border-border border-t bg-background",
          className,
        )}
      >
        {mobileTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              activeOptions={{ exact: true }}
              activeProps={{ className: "text-brand" }}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground"
            >
              <Icon className="size-5" />
              {tab.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground"
        >
          <Menu className="size-5" />
          {mobileTabLabels.mas}
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:hidden">
          <div className="max-h-[70vh] w-full overflow-y-auto rounded-t-xl border border-border bg-background p-2 pb-6">
            <div className="flex items-center justify-between px-2 py-2">
              <span className="font-semibold text-sm">{mobileTabLabels.mas}</span>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setMoreOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            {moreEntries.map((entry) => {
              const Icon = entry.icon;
              if (entry.kind === "action") {
                return (
                  <button
                    key={entry.label}
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onOpenQuickAdd();
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-surface"
                  >
                    <Icon className="size-4 shrink-0" />
                    {entry.label}
                  </button>
                );
              }
              return (
                <Link
                  key={entry.to}
                  to={entry.to}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-surface"
                >
                  <Icon className="size-4 shrink-0" />
                  {entry.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

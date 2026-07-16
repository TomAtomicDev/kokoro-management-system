import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { footerNav, primaryNav } from "./nav-items";

// Active state = a filled UI Ink pill, not just a color change. It should read as "the important
// thing here", not as a themed/branded button (see globals.css — --primary is the ink token).
// Styled off TanStack Router's `data-status="active"` attribute (not `activeProps`) so there's a
// single className string and no risk of a base/active utility pair silently losing to Tailwind's
// generated CSS order — `activeProps.className` merges additively with `className` rather than
// replacing it, and two plain `text-*` utilities of equal specificity resolve by source order in
// the stylesheet, not by their order in the class list (this previously made active-link text
// invisible: `text-sidebar-foreground` from the base class was beating `text-primary-foreground`).
const linkClassName =
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground " +
  "transition-colors duration-fast hover:bg-accent " +
  "data-[status=active]:bg-primary data-[status=active]:text-primary-foreground data-[status=active]:hover:bg-primary";

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  onOpenQuickAdd,
  className,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenQuickAdd: () => void;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "flex flex-col border-sidebar-border border-r bg-sidebar transition-[width] duration-150",
        collapsed ? "w-[var(--layout-sidebar-collapsed-width)]" : "w-[var(--layout-sidebar-width)]",
        className,
      )}
    >
      {/* Wordmark — the ONE persistent brand moment in the daily-flow UI. Cinzel, small, quiet;
          never repeated elsewhere (not in the topbar, not per-screen — see design brief). */}
      <div className="flex items-center gap-1.5 px-4 pt-4 pb-2">
        <span className="brand-display text-brand text-base tracking-wide">KOKORO</span>
        {!collapsed && <span className="text-muted-foreground text-xs">gestión</span>}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {primaryNav.map((entry) => {
          if (entry.kind === "divider") {
            return collapsed ? (
              <div key={entry.label} className="my-2 border-sidebar-border border-t" />
            ) : (
              <p
                key={entry.label}
                className="mt-4 mb-1 px-2 text-muted-foreground text-xs font-semibold tracking-wide uppercase first:mt-0"
              >
                {entry.label}
              </p>
            );
          }

          const Icon = entry.icon;

          if (entry.kind === "action") {
            return (
              <button
                key={entry.label}
                type="button"
                onClick={onOpenQuickAdd}
                title={collapsed ? entry.label : undefined}
                className={linkClassName}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && <span>{entry.label}</span>}
              </button>
            );
          }

          return (
            <Link
              key={entry.to}
              to={entry.to}
              activeOptions={{ exact: true }}
              title={collapsed ? entry.label : undefined}
              className={linkClassName}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span>{entry.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-sidebar-border border-t p-2">
        {footerNav.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link
              key={entry.to}
              to={entry.to}
              activeOptions={{ exact: true }}
              title={collapsed ? entry.label : undefined}
              className={linkClassName}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span>{entry.label}</span>}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-muted-foreground text-xs hover:bg-accent"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          {!collapsed && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  );
}

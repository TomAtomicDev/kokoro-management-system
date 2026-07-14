import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { footerNav, primaryNav } from "./nav-items";

const linkClassName =
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-background";
const activeLinkProps = { className: "bg-background text-brand" };

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
        "flex flex-col border-r border-border bg-surface transition-[width] duration-150",
        collapsed ? "w-16" : "w-[232px]",
        className,
      )}
    >
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {primaryNav.map((entry) => {
          if (entry.kind === "divider") {
            return collapsed ? (
              <div key={entry.label} className="my-2 border-t border-border" />
            ) : (
              <p
                key={entry.label}
                className="mt-4 mb-1 px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase first:mt-0"
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
              activeProps={activeLinkProps}
              title={collapsed ? entry.label : undefined}
              className={linkClassName}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span>{entry.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        {footerNav.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link
              key={entry.to}
              to={entry.to}
              activeOptions={{ exact: true }}
              activeProps={activeLinkProps}
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
          className="mt-1 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-muted-foreground text-xs hover:bg-background"
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          {!collapsed && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  );
}

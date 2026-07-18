import { Outlet } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { MobileBottomTabs } from "./MobileBottomTabs";
import { QuickAddContext } from "./QuickAddContext";
import { QuickAddModalPlaceholder } from "./QuickAddModalPlaceholder";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

// Persistent shell (Doc 06 §2): topbar (56px) + sidebar (232px, collapsible to 64px) + content
// area (max-width 1280px, 24px gutters), with a bottom tab bar replacing the sidebar on mobile.
// Every screen task (SC-xx) fills only the <Outlet /> below.
//
// `quickAddOpen` is still owned here (AppShell renders the one QuickAddModalPlaceholder instance)
// — `QuickAddContext.Provider` below just also exposes the open-trigger to `<Outlet />`'s subtree
// so a screen (KOK-023's dashboard shortcuts) can open the same modal without AppShell threading a
// new prop down through the router.
export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const openQuickAdd = useCallback(() => setQuickAddOpen(true), []);

  return (
    <QuickAddContext.Provider value={{ openQuickAdd }}>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <Topbar onOpenQuickAdd={openQuickAdd} />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
            onOpenQuickAdd={openQuickAdd}
            className="hidden md:flex"
          />

          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[var(--layout-content-max-width)] px-[var(--layout-content-gutter)] py-6">
              <Outlet />
            </div>
          </main>
        </div>

        <MobileBottomTabs onOpenQuickAdd={openQuickAdd} className="md:hidden" />

        <QuickAddModalPlaceholder open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      </div>
    </QuickAddContext.Provider>
  );
}

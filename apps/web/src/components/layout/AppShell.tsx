import { Outlet } from "@tanstack/react-router";
import { useState } from "react";

import { MobileBottomTabs } from "./MobileBottomTabs";
import { QuickAddModalPlaceholder } from "./QuickAddModalPlaceholder";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

// Persistent shell (Doc 06 §2): topbar (56px) + sidebar (232px, collapsible to 64px) + content
// area (max-width 1280px, 24px gutters), with a bottom tab bar replacing the sidebar on mobile.
// Every screen task (SC-xx) fills only the <Outlet /> below.
export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Topbar onOpenQuickAdd={() => setQuickAddOpen(true)} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
          onOpenQuickAdd={() => setQuickAddOpen(true)}
          className="hidden md:flex"
        />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[var(--layout-content-max-width)] px-[var(--layout-content-gutter)] py-6">
            <Outlet />
          </div>
        </main>
      </div>

      <MobileBottomTabs onOpenQuickAdd={() => setQuickAddOpen(true)} className="md:hidden" />

      <QuickAddModalPlaceholder open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { Bot, Package } from "lucide-react";

import { catalogLabels } from "@/lib/i18n-catalog";
import { navLabels } from "@/lib/i18n-nav";

// Settings hub (Doc 06 §2 "⚙ Configuración /settings"). Sub-pages register their own route
// (settings-catalog.tsx is the first real one, SC-15) and are linked from here rather than added
// to the persistent sidebar nav, per the nav tree in nav-items.ts.
export function SettingsRoute() {
  const sections = [
    { to: "/settings/catalog" as const, label: catalogLabels.title, icon: Package },
    { to: "/settings/ai" as const, label: navLabels.iaOps, icon: Bot },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-2xl text-foreground">{navLabels.configuracion}</h1>
      <div className="flex flex-col gap-2">
        {sections.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm hover:bg-accent"
          >
            <section.icon className="size-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{section.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

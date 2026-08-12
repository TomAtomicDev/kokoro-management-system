import { Link } from "@tanstack/react-router";
import { Bot, DatabaseBackup, Package, Palette } from "lucide-react";

import { type ThemePreference, useTheme } from "@/features/theme/use-theme";
import { backupsLabels } from "@/lib/i18n-backups";
import { catalogLabels } from "@/lib/i18n-catalog";
import { navLabels } from "@/lib/i18n-nav";
import { settingsLabels } from "@/lib/i18n-settings";

// Settings hub (Doc 06 §2 "⚙ Configuración /settings"). Sub-pages register their own route
// (settings-catalog.tsx is the first real one, SC-15) and are linked from here rather than added
// to the persistent sidebar nav, per the nav tree in nav-items.ts.
export function SettingsRoute() {
  const [themePreference, setThemePreference] = useTheme();
  const sections = [
    { to: "/settings/catalog" as const, label: catalogLabels.title, icon: Package },
    { to: "/settings/ai" as const, label: navLabels.iaOps, icon: Bot },
    { to: "/settings/backups" as const, label: backupsLabels.title, icon: DatabaseBackup },
  ];
  const themeOptions: ReadonlyArray<{ value: ThemePreference; label: string }> = [
    { value: "system", label: settingsLabels.themeSystem },
    { value: "light", label: settingsLabels.themeLight },
    { value: "dark", label: settingsLabels.themeDark },
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
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <Palette className="size-4 text-muted-foreground" />
            <div>
              <h2 className="font-medium text-foreground">{settingsLabels.appearance}</h2>
              <p className="text-muted-foreground text-sm">
                {settingsLabels.appearanceDescription}
              </p>
            </div>
          </div>
          <fieldset className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            <legend className="sr-only">{settingsLabels.appearance}</legend>
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={themePreference === option.value}
                onClick={() => setThemePreference(option.value)}
                className={
                  "rounded-sm px-3 py-1.5 text-sm transition-colors focus-visible:outline-none " +
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
                  (themePreference === option.value
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground")
                }
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        </section>
      </div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";

import { navLabels } from "@/lib/i18n-nav";
import { recipesLabels } from "@/lib/i18n-recipes";

// Placeholder — the real Production screen is built in a later SC-xx task (KOK-026, see Doc 07
// screen catalog). Recipes (KOK-025) is its first real sub-feature and is reached from here via a
// link card rather than a second top-level nav entry (Doc 06 §2 lists only one "Producción" item
// — see nav-items.ts). This also makes good on StepRecipes.tsx's onboarding promise ("Configura
// tus recetas en Producción → Recetas cuando estés lista"). Mirrors routes/settings.tsx's hub
// pattern rather than RouteStub (which has no room for a link) — kept intentionally minimal, not
// a redesign of this still-placeholder screen.
export function ProductionRoute() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-2xl text-foreground">{navLabels.produccion}</h1>
      <Link
        to="/production/recipes"
        className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm hover:bg-accent"
      >
        <BookOpen className="size-4 text-muted-foreground" />
        <div>
          <span className="font-medium text-foreground">{recipesLabels.title}</span>
          <p className="text-muted-foreground text-xs">{recipesLabels.productionLinkBody}</p>
        </div>
      </Link>
    </div>
  );
}

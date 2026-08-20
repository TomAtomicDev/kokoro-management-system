import { Timer, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { topbarLabels } from "@/lib/i18n-nav";

import { useRecipeTimer } from "./recipe-timer-context";
import { formatRecipeTimerDuration } from "./recipe-timer-logic";

export function RecipeTimerChip() {
  const { timer, remainingSeconds, stopTimer, dismissTimer } = useRecipeTimer();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!timer) return null;
  const complete = timer.status === "completed";
  const label = formatRecipeTimerDuration(remainingSeconds);

  return (
    <div className="relative z-50 shrink-0">
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-label={`${topbarLabels.recipeTimer.title}: ${timer.recipeName}, ${label}`}
        aria-live={complete ? "assertive" : "off"}
        onClick={() => setMenuOpen((open) => !open)}
        className={`flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          complete
            ? "border-negative bg-negative-bg text-negative"
            : "border-positive bg-positive-bg text-positive"
        }`}
      >
        <Timer className="size-3.5" aria-hidden="true" />
        <span className="hidden max-w-28 truncate sm:inline">{timer.recipeName}</span>
        <span className="numeric-cell font-semibold">{label}</span>
      </button>

      {menuOpen ? (
        <div className="absolute top-[calc(100%+4px)] right-0 flex w-64 flex-col gap-2 rounded-md border border-border bg-card p-3 text-sm shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{topbarLabels.recipeTimer.title}</p>
              <p className="truncate text-muted-foreground text-xs">{timer.recipeName}</p>
            </div>
            <button
              type="button"
              aria-label={topbarLabels.recipeTimer.close}
              onClick={() => setMenuOpen(false)}
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <p
            className={`numeric-cell font-semibold text-2xl ${complete ? "text-negative" : "text-foreground"}`}
          >
            {label}
          </p>
          <p className="text-muted-foreground text-xs">
            {complete ? topbarLabels.recipeTimer.finished : topbarLabels.recipeTimer.running}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => {
              if (complete) dismissTimer();
              else stopTimer();
              setMenuOpen(false);
            }}
          >
            {complete ? topbarLabels.recipeTimer.dismiss : topbarLabels.recipeTimer.stop}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

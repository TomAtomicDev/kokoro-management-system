import { type FormEvent, useEffect, useState } from "react";

import { useRecipeTimer } from "@/components/layout/recipe-timer-context";
import {
  formatRecipeTimerDuration,
  formatSuggestedRecipeTimer,
  parseRecipeTimerDuration,
} from "@/components/layout/recipe-timer-logic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recipesLabels } from "@/lib/i18n-recipes";

interface RecipeTimerControlProps {
  recipeId: string;
  recipeName: string;
  estLaborMin: number | null;
}

export function RecipeTimerControl({ recipeId, recipeName, estLaborMin }: RecipeTimerControlProps) {
  const { timer, remainingSeconds, startTimer, stopTimer } = useRecipeTimer();
  const [duration, setDuration] = useState(() => formatSuggestedRecipeTimer(estLaborMin));
  const [error, setError] = useState<string | null>(null);
  const activeTimer = timer?.status === "running" ? timer : null;
  const sameRecipe = timer?.recipeId === recipeId;

  useEffect(() => {
    if (recipeId.trim() === "") return;
    setDuration(formatSuggestedRecipeTimer(estLaborMin));
    setError(null);
  }, [estLaborMin, recipeId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    const durationSeconds = parseRecipeTimerDuration(duration);
    if (durationSeconds === null) {
      setError(recipesLabels.timer.invalidDuration);
      return;
    }
    const result = startTimer({ recipeId, recipeName, durationSeconds });
    if (!result.ok) {
      setError(recipesLabels.timer.otherActive.replace("{recipe}", timer?.recipeName ?? ""));
    }
  }

  if (activeTimer && !sameRecipe) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted px-4 py-3">
        <span className="font-medium text-foreground text-sm">{recipesLabels.timer.title}</span>
        <p className="text-muted-foreground text-xs">
          {recipesLabels.timer.otherActive.replace("{recipe}", activeTimer.recipeName)}
        </p>
      </div>
    );
  }

  if (activeTimer && sameRecipe) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-positive bg-positive-bg px-4 py-3">
        <div className="min-w-0">
          <span className="block font-medium text-positive text-sm">
            {recipesLabels.timer.title}
          </span>
          <span className="numeric-cell text-positive text-xs">
            {formatRecipeTimerDuration(remainingSeconds)} · {recipesLabels.timer.running}
          </span>
        </div>
        <Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={stopTimer}>
          {recipesLabels.timer.stop}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border bg-muted px-4 py-3"
      onSubmit={handleSubmit}
    >
      <span className="font-medium text-foreground text-sm">{recipesLabels.timer.title}</span>
      <p className="text-muted-foreground text-xs">{recipesLabels.timer.description}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-36 flex-1 flex-col gap-1.5">
          <label
            className="font-medium text-foreground text-xs"
            htmlFor={`recipe-timer-${recipeId}`}
          >
            {recipesLabels.timer.durationLabel}
          </label>
          <Input
            id={`recipe-timer-${recipeId}`}
            // The shared numeric input sanitizer removes the colon required by this field.
            // Keep text mode here while the parser enforces the strict mm:ss contract.
            inputMode="text"
            placeholder={recipesLabels.timer.durationPlaceholder}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            aria-describedby={`recipe-timer-help-${recipeId}`}
          />
        </div>
        <Button type="submit" className="min-h-11 shrink-0">
          {recipesLabels.timer.start}
        </Button>
      </div>
      <p id={`recipe-timer-help-${recipeId}`} className="text-muted-foreground text-xs">
        {estLaborMin !== null
          ? recipesLabels.timer.suggestion.replace(
              "{duration}",
              formatSuggestedRecipeTimer(estLaborMin),
            )
          : recipesLabels.timer.noSuggestion}
      </p>
      {error ? (
        <p className="text-negative text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

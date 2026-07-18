// Onboarding step 4 (KOK-020, Doc 07 step 4) — static pointer card only. Recipes (KOK-025) doesn't
// exist yet, so there is no form or API call here: continuing just marks the step done.

import { Button } from "@/components/ui/button";
import { onboardingLabels } from "@/lib/i18n-onboarding";

export interface StepRecipesProps {
  onContinue: () => void;
}

export function StepRecipes({ onContinue }: StepRecipesProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium text-foreground text-lg">{onboardingLabels.recipesTitle}</h2>
      </div>
      <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground">
        {onboardingLabels.recipesBody}
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={onContinue}>
          {onboardingLabels.continueButton}
        </Button>
      </div>
    </div>
  );
}

// Onboarding step 1 (KOK-020, Doc 07 step 1) — overview + password acknowledgment. Per the KB-tension
// resolution recorded for this task: the password hash is a Cloudflare Worker secret, immutable
// at runtime — there is no backend endpoint for changing it, so this step is a static card with a
// single "Continuar" button, never a form.

import { Button } from "@/components/ui/button";
import { onboardingLabels } from "@/lib/i18n-onboarding";

export interface StepPasswordProps {
  onContinue: () => void;
}

export function StepPassword({ onContinue }: StepPasswordProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium text-foreground text-lg">
          {onboardingLabels.passwordOverviewTitle}
        </h2>
        <p className="text-muted-foreground text-sm">{onboardingLabels.passwordOverviewBody}</p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted px-4 py-3 text-sm">
        <ol className="flex flex-col gap-1.5">
          {onboardingLabels.stepLabels.map((stepLabel, index) => (
            <li key={stepLabel} className="flex gap-2">
              <span className="font-medium text-foreground">{stepLabel}</span>
              <span className="text-muted-foreground">
                {onboardingLabels.passwordStepDescriptions[index]}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted px-4 py-3 text-sm">
        <p className="font-medium text-foreground">{onboardingLabels.passwordTitle}</p>
        <p className="text-muted-foreground">{onboardingLabels.passwordBody}</p>
        <p className="text-muted-foreground">{onboardingLabels.passwordHelp}</p>
      </div>
      <p className="text-muted-foreground text-sm">{onboardingLabels.passwordOverviewNavigation}</p>
      <div className="flex justify-end">
        <Button type="button" onClick={onContinue}>
          {onboardingLabels.continueButton}
        </Button>
      </div>
    </div>
  );
}

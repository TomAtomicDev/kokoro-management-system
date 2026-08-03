// SC-xx · Onboarding wizard — /onboarding (KOK-020, Doc 07 steps 1-5, first-run only). Thin
// composition, same shape as routes/inventory.tsx: local `currentStep` state (1-5, always starting
// at 1 on a fresh mount — no cross-reload persistence, per this task's brief) drives which step
// component renders below the Stepper. Steps 1/4 are static acknowledgment cards; 2/3/5 own their
// own form state and mutations (see components/onboarding/Step*.tsx).

import type { ItemDto } from "@kokoro/shared";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { StepBalances } from "@/components/onboarding/StepBalances";
import { StepCatalog } from "@/components/onboarding/StepCatalog";
import { StepCount } from "@/components/onboarding/StepCount";
import { StepPassword } from "@/components/onboarding/StepPassword";
import { Stepper } from "@/components/onboarding/Stepper";
import { StepRecipes } from "@/components/onboarding/StepRecipes";
import { Button, buttonVariants } from "@/components/ui/button";
import { useItemsQuery } from "@/features/catalog/api";
import { useOnboardingStatus } from "@/features/onboarding/api";
import { onboardingLabels } from "@/lib/i18n-onboarding";

const STEP_COUNT = 5;

export function OnboardingRoute() {
  const statusQuery = useOnboardingStatus();
  const [currentStep, setCurrentStep] = useState(1);
  const [maxReachedStep, setMaxReachedStep] = useState(1);
  const [committedSteps, setCommittedSteps] = useState<Set<number>>(() => new Set());

  // Only step 5 (the count checklist) needs the item name/unit lookup — fetched here so it's
  // ready by the time the owner reaches that step, mirroring routes/inventory.tsx's itemLookup.
  const itemsQuery = useItemsQuery({});
  const itemLookup = useMemo(() => {
    const map = new Map<string, { name: string; unit: ItemDto["unit"] }>();
    for (const item of itemsQuery.data?.items ?? []) {
      map.set(item.id, { name: item.name, unit: item.unit });
    }
    return map;
  }, [itemsQuery.data]);

  if (statusQuery.isLoading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-muted-foreground text-sm">{onboardingLabels.loading}</p>
        </div>
      </div>
    );
  }

  if (statusQuery.data?.completed) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="font-semibold text-2xl text-foreground">
                {onboardingLabels.completedTitle}
              </h1>
              <p className="text-muted-foreground text-sm">{onboardingLabels.completedBody}</p>
            </div>
            <div>
              <Link to="/" className={buttonVariants()}>
                {onboardingLabels.goToPanel}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-negative text-sm">{onboardingLabels.errors.generic}</p>
        </div>
      </div>
    );
  }

  const completedSteps = Array.from({ length: maxReachedStep - 1 }, (_, i) => i + 1).filter(
    (step) => step !== currentStep,
  );

  function goToStep(step: number) {
    const nextStep = Math.max(1, Math.min(step, STEP_COUNT));
    setCurrentStep(nextStep);
    setMaxReachedStep((previous) => Math.max(previous, nextStep));
  }

  function commitStepAndGoTo(step: number, committedStep: number) {
    setCommittedSteps((previous) => {
      const next = new Set(previous);
      next.add(committedStep);
      return next;
    });
    goToStep(step);
  }

  const isReviewingCommittedStep = committedSteps.has(currentStep);
  const shellWidth = currentStep === 3 ? "max-w-6xl" : "max-w-2xl";

  return (
    <div className={`mx-auto flex w-full ${shellWidth} flex-col gap-6`}>
      <div>
        <h1 className="font-semibold text-2xl text-foreground">{onboardingLabels.title}</h1>
        <p className="text-muted-foreground text-sm">{onboardingLabels.subtitle}</p>
      </div>

      <Stepper
        currentStep={currentStep}
        completedSteps={completedSteps}
        stepLabels={onboardingLabels.stepLabels}
      />

      <div className="rounded-lg border border-border bg-card p-5">
        {currentStep > 1 ? (
          <div className="mb-4">
            <Button type="button" variant="outline" onClick={() => goToStep(currentStep - 1)}>
              {onboardingLabels.backButton}
            </Button>
          </div>
        ) : null}
        {currentStep === 1 ? (
          <StepPassword onContinue={() => goToStep(2)} />
        ) : currentStep === 2 ? (
          <StepBalances
            onDone={() => commitStepAndGoTo(3, 2)}
            onSkip={() => goToStep(3)}
            readOnly={isReviewingCommittedStep}
          />
        ) : currentStep === 3 ? (
          <StepCatalog
            onDone={() => commitStepAndGoTo(4, 3)}
            onSkip={() => goToStep(4)}
            readOnly={isReviewingCommittedStep}
          />
        ) : currentStep === 4 ? (
          <StepRecipes onContinue={() => goToStep(5)} />
        ) : (
          <StepCount items={itemLookup} />
        )}
      </div>
    </div>
  );
}

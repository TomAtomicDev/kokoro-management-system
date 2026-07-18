// SC-xx · Onboarding wizard — /onboarding (KOK-020, Doc 07 steps 1-5, first-run only). Thin
// composition, same shape as routes/inventory.tsx: local `currentStep` state (1-5, always starting
// at 1 on a fresh mount — no cross-reload persistence, per this task's brief) drives which step
// component renders below the Stepper. Steps 1/4 are static acknowledgment cards; 2/3/5 own their
// own form state and mutations (see components/onboarding/Step*.tsx).

import type { ItemDto } from "@kokoro/shared";
import { useMemo, useState } from "react";

import { StepBalances } from "@/components/onboarding/StepBalances";
import { StepCatalog } from "@/components/onboarding/StepCatalog";
import { StepCount } from "@/components/onboarding/StepCount";
import { StepPassword } from "@/components/onboarding/StepPassword";
import { Stepper } from "@/components/onboarding/Stepper";
import { StepRecipes } from "@/components/onboarding/StepRecipes";
import { useItemsQuery } from "@/features/catalog/api";
import { onboardingLabels } from "@/lib/i18n-onboarding";

const STEP_COUNT = 5;

export function OnboardingRoute() {
  const [currentStep, setCurrentStep] = useState(1);

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

  const completedSteps = Array.from({ length: currentStep - 1 }, (_, i) => i + 1);

  function goToStep(step: number) {
    setCurrentStep(Math.min(step, STEP_COUNT));
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
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
        {currentStep === 1 ? (
          <StepPassword onContinue={() => goToStep(2)} />
        ) : currentStep === 2 ? (
          <StepBalances onDone={() => goToStep(3)} onSkip={() => goToStep(3)} />
        ) : currentStep === 3 ? (
          <StepCatalog onDone={() => goToStep(4)} onSkip={() => goToStep(4)} />
        ) : currentStep === 4 ? (
          <StepRecipes onContinue={() => goToStep(5)} />
        ) : (
          <StepCount items={itemLookup} />
        )}
      </div>
    </div>
  );
}

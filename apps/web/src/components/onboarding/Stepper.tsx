// Minimal horizontal step indicator for the Onboarding wizard (KOK-020, Doc 06 §4). Purely
// presentational — receives `currentStep`/`completedSteps`, holds no internal state — same
// "hand-rolled now, upgrade later if a second consumer justifies a dependency" call
// routes/inventory.tsx's TabSwitcher already made for tabs (D-10): no tabs/stepper primitive
// exists in components/ui yet, and this wizard is its only consumer.

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export interface StepperProps {
  /** 1-based current step number. */
  currentStep: number;
  /** 1-based step numbers already completed (rendered with a checkmark). */
  completedSteps: readonly number[];
  /** Label per step, in step order (index 0 = step 1). */
  stepLabels: readonly string[];
}

export function Stepper({ currentStep, completedSteps, stepLabels }: StepperProps) {
  return (
    <ol className="flex items-start gap-2">
      {stepLabels.map((label, index) => {
        const step = index + 1;
        const isCompleted = completedSteps.includes(step);
        const isCurrent = step === currentStep;
        const isLast = index === stepLabels.length - 1;

        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  isCompleted
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCurrent
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground",
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isCompleted ? <Check className="size-4" /> : step}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-center text-xs",
                  isCurrent ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
            {!isLast ? (
              <div className={cn("-mt-5 h-px flex-1", isCompleted ? "bg-primary" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

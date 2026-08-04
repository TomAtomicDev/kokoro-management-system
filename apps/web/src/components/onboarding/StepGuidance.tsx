import type { ReactElement } from "react";

import { onboardingLabels } from "@/lib/i18n-onboarding";

export interface StepGuidanceProps {
  what: string;
  why: string;
  where: string;
}

export function StepGuidance({ what, why, where }: StepGuidanceProps): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted px-4 py-3 text-sm">
      <p>
        <span className="font-medium text-foreground">{onboardingLabels.guidanceWhatLabel}:</span>{" "}
        <span className="text-muted-foreground">{what}</span>
      </p>
      <p>
        <span className="font-medium text-foreground">{onboardingLabels.guidanceWhyLabel}:</span>{" "}
        <span className="text-muted-foreground">{why}</span>
      </p>
      <p>
        <span className="font-medium text-foreground">{onboardingLabels.guidanceWhereLabel}:</span>{" "}
        <span className="text-muted-foreground">{where}</span>
      </p>
    </div>
  );
}

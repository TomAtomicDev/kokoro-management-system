// Onboarding step 2 (KOK-020, Doc 07 step 2) — sets the two seeded accounts' opening balances via
// setOpeningBalances (UC-onboarding). Same `parseDecimalToInt(value, 2)` money-scale pattern
// ItemForm.tsx's salePrice field uses (D-5: money is always an integer, never parseFloat), and the
// same `ApiError`/`err.message` inline error pattern ExitForm.tsx uses — that already surfaces the
// service's own message_es (e.g. "Ya se completó la configuración inicial…" if onboarding was
// completed elsewhere), no need to special-case the CONFLICT code here.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetOpeningBalances } from "@/features/onboarding/api";
import { ApiError } from "@/lib/api";
import { parseDecimalToInt } from "@/lib/decimal";
import { onboardingLabels } from "@/lib/i18n-onboarding";

export interface StepBalancesProps {
  onDone: () => void;
  onSkip: () => void;
}

export function StepBalances({ onDone, onSkip }: StepBalancesProps) {
  const [bankInput, setBankInput] = useState("");
  const [cashInput, setCashInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useSetOpeningBalances();
  const disabled = mutation.isPending;

  function parseAmount(raw: string): number | null {
    if (raw.trim() === "") return 0;
    return parseDecimalToInt(raw, 2);
  }

  async function handleSubmit() {
    setError(null);
    const bankOpening = parseAmount(bankInput);
    const cashOpening = parseAmount(cashInput);
    if (bankOpening === null || cashOpening === null) {
      setError(onboardingLabels.errors.invalidAmount);
      return;
    }

    try {
      await mutation.mutateAsync({ bankOpening, cashOpening });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : onboardingLabels.errors.generic);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium text-foreground text-lg">{onboardingLabels.balancesTitle}</h2>
        <p className="text-muted-foreground text-sm">{onboardingLabels.balancesBody}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground text-sm" htmlFor="ob-bank">
            {onboardingLabels.fieldBank}
          </label>
          <Input
            id="ob-bank"
            inputMode="decimal"
            placeholder="0.00"
            value={bankInput}
            onChange={(e) => setBankInput(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground text-sm" htmlFor="ob-cash">
            {onboardingLabels.fieldCash}
          </label>
          <Input
            id="ob-cash"
            inputMode="decimal"
            placeholder="0.00"
            value={cashInput}
            onChange={(e) => setCashInput(e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>

      {error ? <p className="text-negative text-sm">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onSkip} disabled={disabled}>
          {onboardingLabels.skipButton}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled}>
          {onboardingLabels.submitBalances}
        </Button>
      </div>
    </div>
  );
}

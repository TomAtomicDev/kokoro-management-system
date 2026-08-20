// Onboarding step 2 (KOK-020, Doc 07 step 2) — sets the two seeded accounts' opening balances via
// setOpeningBalances (UC-onboarding). Same `parseDecimalToInt(value, 2)` money-scale pattern
// ItemForm.tsx's salePrice field uses (D-5: money is always an integer, never parseFloat), and the
// same `ApiError`/`err.message` inline error pattern ExitForm.tsx uses — that already surfaces the
// service's own message_es (e.g. "Ya se completó la configuración inicial…" if onboarding was
// completed elsewhere), no need to special-case the CONFLICT code here.

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { StepGuidance } from "@/components/onboarding/StepGuidance";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSetOpeningBalances } from "@/features/onboarding/api";
import { useSessionDraft } from "@/features/onboarding/use-session-draft";
import { useFieldValidation } from "@/hooks/useFieldValidation";
import { ApiError } from "@/lib/api";
import { exceedsScale, parseDecimalToInt } from "@/lib/decimal";
import { onboardingLabels } from "@/lib/i18n-onboarding";

/** Returns a field-specific error for a balance input, or undefined when it's blank (blank means
 * "0", not an error — KOK-143 live validation mirrors `parseAmount`'s own rules below.) */
function balanceFieldError(raw: string): string | undefined {
  if (raw.trim() === "") return undefined;
  if (parseDecimalToInt(raw, 2) !== null) return undefined;
  return exceedsScale(raw, 2)
    ? onboardingLabels.errors.tooManyDecimals
    : onboardingLabels.errors.invalidAmount;
}

export interface StepBalancesProps {
  onDone: () => void;
  onSkip: () => void;
  readOnly?: boolean;
}

export function StepBalances({ onDone, onSkip, readOnly = false }: StepBalancesProps) {
  const [bankInput, setBankInput] = useSessionDraft("balances-bank", "");
  const [cashInput, setCashInput] = useSessionDraft("balances-cash", "");
  const [error, setError] = useState<string | null>(null);
  const validation = useFieldValidation();

  const mutation = useSetOpeningBalances();
  const disabled = mutation.isPending;
  const bankError = balanceFieldError(bankInput);
  const cashError = balanceFieldError(cashInput);

  if (readOnly) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="font-medium text-foreground text-lg">{onboardingLabels.balancesTitle}</h2>
          <p className="text-muted-foreground text-sm">{onboardingLabels.balancesBody}</p>
        </div>
        <StepGuidance
          what={onboardingLabels.balancesGuidanceWhat}
          why={onboardingLabels.balancesGuidanceWhy}
          where={onboardingLabels.balancesGuidanceWhere}
        />
        <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
          <p className="font-medium text-foreground">{onboardingLabels.alreadySaved}</p>
          <p className="text-muted-foreground">{onboardingLabels.savedBalancesBody}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onDone}>
            {onboardingLabels.continueButton}
          </Button>
        </div>
      </div>
    );
  }

  function parseAmount(raw: string): number | null {
    if (raw.trim() === "") return 0;
    return parseDecimalToInt(raw, 2);
  }

  async function handleSubmit() {
    setError(null);
    const errors: Record<string, string> = {};
    if (bankError) errors.bank = bankError;
    if (cashError) errors.cash = cashError;
    const canSubmit = validation.attemptSubmit(errors, ["bank", "cash"]);
    if (!canSubmit) {
      setError(bankError ?? cashError ?? onboardingLabels.errors.invalidAmount);
      return;
    }

    // Guaranteed parseable — `bankError`/`cashError` above already validated both fields.
    const bankOpening = parseAmount(bankInput) as number;
    const cashOpening = parseAmount(cashInput) as number;

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

      <StepGuidance
        what={onboardingLabels.balancesGuidanceWhat}
        why={onboardingLabels.balancesGuidanceWhy}
        where={onboardingLabels.balancesGuidanceWhere}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field
          label={onboardingLabels.fieldBank}
          htmlFor="ob-bank"
          error={validation.isVisible("bank") ? bankError : undefined}
        >
          <Input
            ref={validation.registerRef("bank")}
            id="ob-bank"
            inputMode="decimal"
            placeholder="0.00"
            value={bankInput}
            onChange={(e) => setBankInput(e.target.value)}
            onBlur={() => validation.handleBlur("bank")}
            invalid={validation.isVisible("bank") && Boolean(bankError)}
            disabled={disabled}
          />
          <p className="text-muted-foreground text-xs">{onboardingLabels.decimalHelp}</p>
        </Field>
        <Field
          label={onboardingLabels.fieldCash}
          htmlFor="ob-cash"
          error={validation.isVisible("cash") ? cashError : undefined}
        >
          <Input
            ref={validation.registerRef("cash")}
            id="ob-cash"
            inputMode="decimal"
            placeholder="0.00"
            value={cashInput}
            onChange={(e) => setCashInput(e.target.value)}
            onBlur={() => validation.handleBlur("cash")}
            invalid={validation.isVisible("cash") && Boolean(cashError)}
            disabled={disabled}
          />
        </Field>
      </div>

      {error ? <p className="text-negative text-sm">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onSkip}
          disabled={disabled}
          aria-label={onboardingLabels.skipButton}
          title={onboardingLabels.skipButton}
        >
          <ChevronRight />
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled}>
          {onboardingLabels.submitBalances}
        </Button>
      </div>
    </div>
  );
}

import { Delete, X } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { topbarLabels } from "@/lib/i18n-nav";

import {
  type CalculatorOperator,
  evaluateExpression,
  formatCalculatorNumber,
} from "./calculator-logic";

interface CalculatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CalculatorKey = "digit" | "decimal" | "operator" | "clear" | "backspace" | "equals";

const operatorLabels: Record<CalculatorOperator, string> = {
  "+": topbarLabels.calculator.add,
  "-": topbarLabels.calculator.subtract,
  "×": topbarLabels.calculator.multiply,
  "÷": topbarLabels.calculator.divide,
};

export function Calculator({ open, onOpenChange }: CalculatorProps): ReactElement {
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState("0");
  const [resultValue, setResultValue] = useState<number | null>(0);
  const [resultError, setResultError] = useState<
    keyof typeof topbarLabels.calculator.errors | null
  >(null);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const reset = useCallback((): void => {
    setExpression("");
    setResult("0");
    setResultValue(0);
    setResultError(null);
    setJustEvaluated(false);
    setCopyState("idle");
  }, []);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const clearResult = (): void => {
    setResult("0");
    setResultValue(null);
    setResultError(null);
    setCopyState("idle");
  };

  const appendDigit = (digit: string): void => {
    if (justEvaluated) {
      setExpression(digit);
      setJustEvaluated(false);
    } else {
      setExpression((current) => (current === "0" ? digit : `${current}${digit}`));
    }
    clearResult();
  };

  const appendDecimal = (): void => {
    if (justEvaluated) {
      setExpression("0,");
      setJustEvaluated(false);
      clearResult();
      return;
    }

    setExpression((current) => {
      const currentNumber = current.split(/[+\-×÷]/u).at(-1) ?? "";
      if (currentNumber.includes(",") || currentNumber.includes(".")) return current;
      return `${current || "0"},`;
    });
    clearResult();
  };

  const appendOperator = (operator: CalculatorOperator): void => {
    if (justEvaluated && resultValue !== null) {
      setExpression(`${formatCalculatorNumber(resultValue)}${operator}`);
      setJustEvaluated(false);
      setResult("0");
      setResultValue(null);
      setResultError(null);
      setCopyState("idle");
      return;
    }

    setExpression((current) => {
      if (!current) return operator === "-" ? operator : current;
      if (/[+\-×÷]$/u.test(current)) return `${current.slice(0, -1)}${operator}`;
      return `${current}${operator}`;
    });
    clearResult();
  };

  const backspace = (): void => {
    setExpression((current) => current.slice(0, -1));
    setJustEvaluated(false);
    clearResult();
  };

  const calculate = (): void => {
    const evaluation = evaluateExpression(expression);
    if ("error" in evaluation) {
      setResult(topbarLabels.calculator.errors[evaluation.error]);
      setResultValue(null);
      setResultError(evaluation.error);
      setJustEvaluated(false);
      setCopyState("idle");
      return;
    }

    setResult(formatCalculatorNumber(evaluation.value));
    setResultValue(evaluation.value);
    setResultError(null);
    setJustEvaluated(true);
    setCopyState("idle");
  };

  const handleCopy = async (): Promise<void> => {
    if (resultValue === null) return;
    try {
      await navigator.clipboard.writeText(formatCalculatorNumber(resultValue));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const handleKey = (key: CalculatorKey, value?: string): void => {
    switch (key) {
      case "digit":
        if (value) appendDigit(value);
        break;
      case "decimal":
        appendDecimal();
        break;
      case "operator":
        if (value) appendOperator(value as CalculatorOperator);
        break;
      case "clear":
        reset();
        break;
      case "backspace":
        backspace();
        break;
      case "equals":
        calculate();
        break;
    }
  };

  const expressionLabel = expression || "0";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      aria-label={topbarLabels.calculator.title}
      disableUnsavedChangesGuard
      className="max-w-[22rem]"
    >
      <div className="flex items-center justify-between border-border border-b px-5 py-4">
        <h2 className="font-semibold text-foreground text-lg">{topbarLabels.calculator.title}</h2>
        <button
          type="button"
          aria-label={topbarLabels.calculator.close}
          onClick={() => onOpenChange(false)}
          className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mx-5 mt-5 rounded-lg border border-border bg-muted px-4 py-3 text-right">
        <p className="min-h-6 truncate text-muted-foreground text-sm numeric-cell">
          {expressionLabel.replaceAll(".", ",")}
        </p>
        <p
          className={`mt-1 min-h-10 truncate font-semibold text-2xl numeric-cell ${resultError ? "text-negative" : ""}`}
          aria-live="polite"
        >
          {result}
        </p>
      </div>

      <fieldset
        className="grid grid-cols-4 gap-2 border-0 px-5 py-5"
        aria-label={topbarLabels.calculator.keypad}
      >
        <CalculatorButton label="AC" kind="clear" onClick={() => handleKey("clear")} />
        <CalculatorButton
          icon={<Delete className="size-5" />}
          label={topbarLabels.calculator.backspace}
          kind="backspace"
          onClick={() => handleKey("backspace")}
        />
        <CalculatorButton
          label="÷"
          labelText={operatorLabels["÷"]}
          kind="operator"
          onClick={() => handleKey("operator", "÷")}
        />
        <CalculatorButton
          label="×"
          labelText={operatorLabels["×"]}
          kind="operator"
          onClick={() => handleKey("operator", "×")}
        />
        {(["7", "8", "9"] as const).map((digit) => (
          <CalculatorButton
            key={digit}
            label={digit}
            kind="digit"
            onClick={() => handleKey("digit", digit)}
          />
        ))}
        <CalculatorButton
          label="−"
          labelText={operatorLabels["-"]}
          kind="operator"
          onClick={() => handleKey("operator", "-")}
        />
        {(["4", "5", "6"] as const).map((digit) => (
          <CalculatorButton
            key={digit}
            label={digit}
            kind="digit"
            onClick={() => handleKey("digit", digit)}
          />
        ))}
        <CalculatorButton
          label="+"
          labelText={operatorLabels["+"]}
          kind="operator"
          onClick={() => handleKey("operator", "+")}
        />
        {(["1", "2", "3"] as const).map((digit) => (
          <CalculatorButton
            key={digit}
            label={digit}
            kind="digit"
            onClick={() => handleKey("digit", digit)}
          />
        ))}
        <CalculatorButton
          label="="
          labelText={topbarLabels.calculator.equals}
          kind="equals"
          onClick={() => handleKey("equals")}
        />
        <CalculatorButton
          label="0"
          kind="digit"
          className="col-span-2"
          onClick={() => handleKey("digit", "0")}
        />
        <CalculatorButton
          label=","
          labelText={topbarLabels.calculator.decimal}
          kind="digit"
          onClick={() => handleKey("decimal")}
        />
        <Button
          type="button"
          variant="outline"
          className="col-span-4 h-11"
          onClick={() => void handleCopy()}
          disabled={resultValue === null}
        >
          {copyState === "copied"
            ? topbarLabels.calculator.copied
            : copyState === "error"
              ? topbarLabels.calculator.copyError
              : topbarLabels.calculator.copy}
        </Button>
      </fieldset>
    </Dialog>
  );
}

function CalculatorButton({
  label,
  labelText,
  icon,
  kind,
  className,
  onClick,
}: {
  label: string;
  labelText?: string;
  icon?: ReactNode;
  kind: CalculatorKey;
  className?: string;
  onClick: () => void;
}): ReactElement {
  const isPrimary = kind === "equals";
  return (
    <button
      type="button"
      aria-label={labelText ?? label}
      onClick={onClick}
      className={`flex min-h-11 items-center justify-center rounded-md border border-input text-base numeric-cell transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        isPrimary
          ? "border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary-hover"
          : kind === "operator"
            ? "bg-accent font-semibold hover:bg-secondary"
            : "bg-card hover:bg-accent"
      } ${className ?? ""}`}
    >
      {icon ?? label}
    </button>
  );
}

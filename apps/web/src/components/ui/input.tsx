import type * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** Removes characters that cannot be part of the app's non-negative decimal input convention. */
export function sanitizeDecimalInput(value: string): string {
  let separatorSeen = false;
  let sanitized = "";

  for (const character of value) {
    if (character >= "0" && character <= "9") {
      sanitized += character;
    } else if ((character === "." || character === ",") && !separatorSeen) {
      sanitized += character;
      separatorSeen = true;
    }
  }

  return sanitized;
}

/** Removes everything except digits from integer-only numeric inputs. */
export function sanitizeNumericInput(value: string): string {
  return Array.from(value)
    .filter((character) => character >= "0" && character <= "9")
    .join("");
}

function sanitizeInputValue(value: string, inputMode: InputProps["inputMode"]): string {
  return inputMode === "numeric" ? sanitizeNumericInput(value) : sanitizeDecimalInput(value);
}

export function Input({ className, inputMode, onChange, type, ...props }: InputProps) {
  const isNumeric = inputMode === "decimal" || inputMode === "numeric" || type === "number";
  const handleChange = isNumeric
    ? (event: React.ChangeEvent<HTMLInputElement>) => {
        const sanitized = sanitizeInputValue(event.target.value, inputMode);
        if (sanitized !== event.target.value) {
          // The target is the live input element, so updating it before forwarding the event
          // keeps controlled and uncontrolled consumers on the same sanitized value.
          event.target.value = sanitized;
        }
        onChange?.(event);
      }
    : onChange;

  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm " +
          "transition-colors placeholder:text-subtle-foreground focus-visible:outline-none " +
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
          "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      inputMode={inputMode}
      onChange={handleChange}
      type={type}
      {...props}
    />
  );
}

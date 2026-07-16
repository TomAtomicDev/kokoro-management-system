// Handwritten accessible toggle (role="switch") — no Radix dependency added for this (D-10):
// a single on/off control doesn't need a new package, just correct ARIA + keyboard support
// (native <button> already gives Space/Enter activation for free).

import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function Switch({ checked, onCheckedChange, disabled, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent p-0.5 " +
          "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 " +
          "focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className,
      )}
      {...aria}
    >
      <span
        className={cn(
          "block size-4 rounded-full bg-card shadow-sm transition-transform duration-fast",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

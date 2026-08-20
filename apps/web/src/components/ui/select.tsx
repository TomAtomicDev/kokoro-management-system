// Plain native <select>, styled to match Input/Button. No Radix Select added (D-10) — a native
// select is fully accessible and keyboard-operable out of the box, and every enum picker in this
// app (kind/category/unit today, more later) is a closed, short list that doesn't need a custom
// listbox.

import * as React from "react";

import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Red border/ring + `aria-invalid` — set when this field's live error is visible (KOK-143). */
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, invalid, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm " +
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
          "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-negative focus-visible:ring-negative",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    >
      {children}
    </select>
  );
});

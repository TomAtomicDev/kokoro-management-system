// Plain native <select>, styled to match Input/Button. No Radix Select added (D-10) — a native
// select is fully accessible and keyboard-operable out of the box, and every enum picker in this
// app (kind/category/unit today, more later) is a closed, short list that doesn't need a custom
// listbox.

import type * as React from "react";

import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground shadow-sm " +
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
          "focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

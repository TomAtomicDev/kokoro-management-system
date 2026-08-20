import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export type FormPageBackTo =
  | "/purchases"
  | "/sales"
  | "/packing"
  | "/production"
  | "/orders"
  | "/inventory";

export interface FormPageProps {
  title: string;
  backTo: FormPageBackTo;
  backLabel: string;
  /** Optional search params for the back link — e.g. `/inventory`'s Conteos tab needs
   * `{ tab: "conteos" }` so the back button doesn't drop the owner onto the default Stock tab. */
  backSearch?: Record<string, unknown>;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * Shared shell for line-bearing event forms. The route owns the mounted form state while this
 * shell keeps the body scrollable and the summary footer pinned to the viewport.
 */
export function FormPage({
  title,
  backTo,
  backLabel,
  backSearch,
  children,
  footer,
}: FormPageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mx-auto flex w-full max-w-3xl flex-col gap-2 border-border border-b pb-4">
        <Link
          to={backTo}
          search={backSearch}
          className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
        <h1 className="font-semibold text-2xl text-foreground">{title}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-5 text-sm">{children}</div>
      </div>

      {footer}
    </div>
  );
}

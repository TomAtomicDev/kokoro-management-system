// Combobox over items + aliases, filter by kind, inline "crear ítem" (Doc 06 §4). This is reused
// by every later event form (purchases, production, sales...) — see KOK-011 backlog note — so it
// owns its own search query (TanStack Query's cache/staleTime already keeps repeat keystrokes
// cheap) and delegates inline-create to the shared CreateItemDialog, instead of leaving each
// future caller to reimplement "search items, or create one on the fly."

import type { ItemDto, ItemKind, Unit } from "@kokoro/shared";
import { Plus } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { useItemQuery, useItemsQuery } from "@/features/catalog/api";
import { catalogLabels } from "@/lib/i18n-catalog";

import { CreateItemDialog } from "./CreateItemDialog";

export interface ItemPickerEligibility {
  kind?: ItemKind | ItemKind[];
  unit?: Unit | Unit[];
  isUnmetered?: boolean;
}

type ItemEligibilityFields = Pick<ItemDto, "kind" | "unit" | "isUnmetered">;

function matchesEligibilityValue<T>(value: T, expected: T | T[] | undefined): boolean {
  if (expected === undefined) return true;
  return Array.isArray(expected) ? expected.includes(value) : value === expected;
}

export function isItemEligible(
  item: ItemEligibilityFields,
  eligibility?: ItemPickerEligibility,
): boolean {
  return (
    matchesEligibilityValue(item.kind, eligibility?.kind) &&
    matchesEligibilityValue(item.unit, eligibility?.unit) &&
    matchesEligibilityValue(item.isUnmetered, eligibility?.isUnmetered)
  );
}

export interface ItemPickerProps {
  value: string | null;
  onChange: (itemId: string | null, item: ItemDto | null) => void;
  /** A single kind narrows the server-side `GET /items?kind=` query (unchanged, original
   * behavior). An array (KOK-025: recipes need "RAW_MATERIAL or SEMI_FINISHED") can't be passed
   * to that endpoint — it only accepts one `kind` — so instead the unfiltered/search-matched
   * result set is fetched and narrowed client-side; fine at this app's (solo-business) scale. */
  kindFilter?: ItemKind | ItemKind[];
  /** Additional client-side constraints for the items this event can accept. */
  eligibility?: ItemPickerEligibility;
  placeholder?: string;
  /** Explains why no eligible item is available instead of showing a generic blank result. */
  emptyMessage?: string;
  disabled?: boolean;
  /** On by default — the inline "crear ítem" flow this component exists to provide. */
  allowCreate?: boolean;
  /** KOK-145: opt in only for the Recipes inline-create and Catalogo create dialog. */
  allowOpeningStock?: boolean;
  /** Red border/ring on the search input — set when this field's live error is visible (KOK-143). */
  invalid?: boolean;
  /** Fires when the search input loses focus, e.g. to mark the field "live" for validation
   * (KOK-143) — distinct from item selection, which never blurs the input. */
  onBlur?: () => void;
}

export const ItemPicker = forwardRef<HTMLInputElement, ItemPickerProps>(function ItemPicker(
  {
    value,
    onChange,
    kindFilter,
    eligibility,
    placeholder,
    emptyMessage,
    disabled,
    allowCreate = true,
    allowOpeningStock = false,
    invalid,
    onBlur,
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const effectiveEligibility: ItemPickerEligibility | undefined =
    eligibility || kindFilter !== undefined
      ? { ...eligibility, kind: eligibility?.kind ?? kindFilter }
      : undefined;
  const effectiveKind = effectiveEligibility?.kind;
  const singleKindFilter: ItemKind | undefined =
    typeof effectiveKind === "string" ? effectiveKind : undefined;

  const selectedItemQuery = useItemQuery(value ?? undefined);
  const searchQuery = useItemsQuery({
    kind: singleKindFilter,
    isActive: true,
    search: query.trim() || undefined,
  });

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const displayValue = open ? query : (selectedItemQuery.data?.name ?? "");
  const rawResults = searchQuery.data?.items ?? [];
  const results = rawResults.filter((item) => isItemEligible(item, effectiveEligibility));
  const trimmedQuery = query.trim();
  const exactNameMatch = results.some(
    (item) => item.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  function selectItem(item: ItemDto) {
    onChange(item.id, item);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={ref}
        value={displayValue}
        placeholder={placeholder ?? catalogLabels.itemPickerPlaceholder}
        disabled={disabled}
        invalid={invalid}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={onBlur}
      />

      {open ? (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground text-sm">
              {emptyMessage ?? catalogLabels.itemPickerEmpty}
            </p>
          ) : (
            <ul>
              {results.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => selectItem(item)}
                  >
                    <span className="text-foreground">{item.name}</span>
                    {item.aliases.length > 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {item.aliases.map((alias) => alias.alias).join(", ")}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {allowCreate && trimmedQuery !== "" && !exactNameMatch ? (
            <button
              type="button"
              className="flex w-full items-center gap-1.5 border-border border-t px-3 py-2 text-left text-primary text-sm hover:bg-accent"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-3.5" />
              {catalogLabels.itemPickerCreateNew} "{trimmedQuery}"
            </button>
          ) : null}
        </div>
      ) : null}

      {allowCreate ? (
        <CreateItemDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={trimmedQuery}
          // CreateItemDialog only pre-selects a single ItemKind; with a multi-kind filter there's
          // no single right default, so leave it unset and let the owner pick in the form.
          kindFilter={singleKindFilter}
          allowOpeningStock={allowOpeningStock}
          onCreated={(item) => {
            if (isItemEligible(item, effectiveEligibility)) selectItem(item);
          }}
        />
      ) : null}
    </div>
  );
});

// Combobox over items + aliases, filter by kind, inline "crear ítem" (Doc 06 §4). This is reused
// by every later event form (purchases, production, sales...) — see KOK-011 backlog note — so it
// owns its own search query (TanStack Query's cache/staleTime already keeps repeat keystrokes
// cheap) and delegates inline-create to the shared CreateItemDialog, instead of leaving each
// future caller to reimplement "search items, or create one on the fly."

import type { ItemDto, ItemKind } from "@kokoro/shared";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { useItemQuery, useItemsQuery } from "@/features/catalog/api";
import { catalogLabels } from "@/lib/i18n-catalog";

import { CreateItemDialog } from "./CreateItemDialog";

export interface ItemPickerProps {
  value: string | null;
  onChange: (itemId: string | null, item: ItemDto | null) => void;
  kindFilter?: ItemKind;
  placeholder?: string;
  disabled?: boolean;
  /** On by default — the inline "crear ítem" flow this component exists to provide. */
  allowCreate?: boolean;
}

export function ItemPicker({
  value,
  onChange,
  kindFilter,
  placeholder,
  disabled,
  allowCreate = true,
}: ItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedItemQuery = useItemQuery(value ?? undefined);
  const searchQuery = useItemsQuery({
    kind: kindFilter,
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
  const results = searchQuery.data?.items ?? [];
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
        value={displayValue}
        placeholder={placeholder ?? catalogLabels.itemPickerPlaceholder}
        disabled={disabled}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => setQuery(event.target.value)}
      />

      {open ? (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-muted-foreground text-sm">
              {catalogLabels.itemPickerEmpty}
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
          kindFilter={kindFilter}
          onCreated={selectItem}
        />
      ) : null}
    </div>
  );
}

// View/edit drawer for a single item (Doc 06 §4 DetailDrawer contract), plus the two things
// unique to Catalog: the active toggle and alias chip management (Doc 07 SC-15).

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  useAddItemAliasMutation,
  useItemQuery,
  useRemoveItemAliasMutation,
  useSetItemActiveMutation,
  useUpdateItemMutation,
} from "@/features/catalog/api";
import { ApiError } from "@/lib/api";
import { catalogLabels } from "@/lib/i18n-catalog";

import {
  ItemForm,
  type ItemFormValues,
  itemFormValuesFromDto,
  parseItemFormValues,
} from "./ItemForm";

export interface ItemDetailDrawerProps {
  itemId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ItemDetailDrawer({ itemId, open, onOpenChange }: ItemDetailDrawerProps) {
  const itemQuery = useItemQuery(itemId ?? undefined);
  const updateMutation = useUpdateItemMutation();
  const setActiveMutation = useSetItemActiveMutation();
  const addAliasMutation = useAddItemAliasMutation();
  const removeAliasMutation = useRemoveItemAliasMutation();

  const [values, setValues] = useState<ItemFormValues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState("");
  const [aliasError, setAliasError] = useState<string | null>(null);

  // Reset local edit state whenever the drawer targets a different item. itemId is used only as
  // a trigger here (the body doesn't read it), so it's an intentional exception to
  // exhaustive-deps rather than a missing dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional, see comment above.
  useEffect(() => {
    setValues(null);
    setError(null);
    setAliasInput("");
    setAliasError(null);
  }, [itemId]);

  // ...then seed it once from the fetched item, but only the first time — a later refetch
  // (e.g. after adding an alias invalidates the item query) must not clobber an in-progress,
  // unsaved edit to name/notes/etc.
  useEffect(() => {
    if (itemQuery.data && values === null) {
      setValues(itemFormValuesFromDto(itemQuery.data));
    }
  }, [itemQuery.data, values]);

  if (!itemId) return null;
  const item = itemQuery.data;

  async function handleSave() {
    if (!values || !itemId) return;
    const parsed = parseItemFormValues(values);
    if (!parsed) {
      setError(catalogLabels.errors.nameRequired);
      return;
    }
    setError(null);
    try {
      await updateMutation.mutateAsync({ id: itemId, ...parsed });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : catalogLabels.errors.generic);
    }
  }

  async function handleToggleActive(nextActive: boolean) {
    if (!itemId) return;
    await setActiveMutation.mutateAsync({ id: itemId, isActive: nextActive });
  }

  async function handleAddAlias() {
    const alias = aliasInput.trim();
    if (!alias || !itemId) return;
    setAliasError(null);
    try {
      await addAliasMutation.mutateAsync({ itemId, alias });
      setAliasInput("");
    } catch (err) {
      setAliasError(err instanceof ApiError ? err.message : catalogLabels.errors.generic);
    }
  }

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={item?.name ?? catalogLabels.editTitle}
      subtitle={item ? catalogLabels.kindLabels[item.kind] : undefined}
      footer={
        item ? (
          <span>
            Creado {new Date(item.createdAt).toLocaleDateString("es-BO")} · Actualizado{" "}
            {new Date(item.updatedAt).toLocaleDateString("es-BO")}
          </span>
        ) : undefined
      }
    >
      {!item || !values ? (
        <p className="text-muted-foreground text-sm">{catalogLabels.loading}</p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2.5">
            <span className="font-medium text-sm">{catalogLabels.columnActive}</span>
            <Switch
              checked={item.isActive}
              onCheckedChange={handleToggleActive}
              disabled={setActiveMutation.isPending}
              aria-label={catalogLabels.columnActive}
            />
          </div>

          <ItemForm
            values={values}
            onChange={setValues}
            disabled={updateMutation.isPending}
            derived={{
              wac: item.wac,
              replacementCost: item.replacementCost,
              replacementCostUpdatedAt: item.replacementCostUpdatedAt,
            }}
          />
          {error ? <p className="text-negative text-sm">{error}</p> : null}
          <Button type="button" onClick={handleSave} disabled={updateMutation.isPending}>
            {catalogLabels.save}
          </Button>

          <div className="flex flex-col gap-2 border-border border-t pt-4">
            <span className="font-medium text-foreground text-sm">
              {catalogLabels.fieldAliases}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {item.aliases.length === 0 ? (
                <span className="text-muted-foreground text-sm">—</span>
              ) : (
                item.aliases.map((alias) => (
                  <Badge key={alias.id} variant="outline" className="gap-1 pr-1">
                    {alias.alias}
                    <button
                      type="button"
                      aria-label={`${catalogLabels.removeAlias}: ${alias.alias}`}
                      onClick={() => removeAliasMutation.mutate(alias.id)}
                      disabled={removeAliasMutation.isPending}
                      className="rounded-full p-0.5 hover:bg-accent"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={aliasInput}
                onChange={(event) => setAliasInput(event.target.value)}
                placeholder={catalogLabels.aliasPlaceholder}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddAlias();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddAlias}
                disabled={addAliasMutation.isPending || aliasInput.trim() === ""}
              >
                {catalogLabels.addAlias}
              </Button>
            </div>
            {aliasError ? <p className="text-negative text-sm">{aliasError}</p> : null}
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}

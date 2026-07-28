// Dialog for KOK-025 "record/update recipe" (Doc 07 SC-06). Mirrors PurchaseForm.tsx's structure
// (Dialog wrapper, local form state, submit -> mutation -> close) but drops everything purchases
// needed that recipes don't: no replay-confirmation dance (recipes.ts's header comment — a recipe
// is catalog/config, not a movement-affecting event), no receipt photo, no account/date fields.
//
// Theoretical-cost panel (Doc 06 principle 3 "derived numbers are visibly derived" + principle 4
// "replacement-cost is the prominent figure"): only rendered once a `recipe` prop exists, i.e.
// during EDIT of an already-saved recipe. A brand-new (unsaved) recipe has no server-computed
// RecipeDto yet; rather than hand-roll a client-side cost estimate (money math outside money.ts,
// D-5's whole point), this form simply shows no panel until the recipe has been saved once — the
// list/detail views pick it up immediately after (RecipeDetailDrawer / RecipesTable).

import type { ItemDto, RecipeDto, RecipeSettingsDto } from "@kokoro/shared";
import { formatMoney, recordRecipeCommandSchema, roundHalfUpToInt } from "@kokoro/shared";
import { useEffect, useMemo, useState } from "react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { CalcTrace, type CalcTraceInput } from "@/components/common/CalcTrace";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { MarginBadge } from "@/components/pricing/MarginBadge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useItemsQuery } from "@/features/catalog/api";
import { useRecordRecipe, useUpdateRecipe } from "@/features/recipes/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { recipesLabels } from "@/lib/i18n-recipes";

export interface RecipeFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present -> edit mode: prefill from this recipe and submit via `useUpdateRecipe`. Absent ->
   * create mode, submits via `useRecordRecipe`. */
  recipe?: RecipeDto;
  /** Rides along on the same API response as `recipe` (RecipeSettingsDto) — required to render
   * the margin badge's C-5 threshold. Only meaningful (and only used) in edit mode. */
  settings?: RecipeSettingsDto;
}

interface RecipeLineValue extends LineEditorLine {
  itemId: string | null;
  /** Milli-units decimal string (scale 3) — same convention as PurchaseForm's line qty. */
  qty: string;
}

function emptyLine(): RecipeLineValue {
  return { itemId: null, qty: "" };
}

/** Pure mapping, same rationale as PurchaseForm's `purchaseToFormState`. */
function recipeToFormState(recipe: RecipeDto) {
  return {
    name: recipe.name,
    outputItemId: recipe.outputItemId,
    expectedYieldQty: formatIntAsDecimalInput(recipe.expectedYieldQty, 3),
    estLaborMin: recipe.estLaborMin === null ? "" : String(recipe.estLaborMin),
    isDefault: recipe.isDefault,
    notes: recipe.notes ?? "",
    lines: recipe.lines.map(
      (line): RecipeLineValue => ({
        itemId: line.itemId,
        qty: formatIntAsDecimalInput(line.qty, 3),
      }),
    ),
  };
}

/** Minutes are a plain non-negative integer (not milli-scaled money/qty, so parseDecimalToInt
 * doesn't apply) — informative only (C-7), never enters the theoretical-cost calc. */
function parseNonNegativeInt(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

export function RecipeForm({ open, onOpenChange, recipe, settings }: RecipeFormProps) {
  const isEditMode = Boolean(recipe);

  const [name, setName] = useState("");
  const [outputItemId, setOutputItemId] = useState<string | null>(null);
  const [outputItem, setOutputItem] = useState<ItemDto | null>(null);
  const [expectedYieldQty, setExpectedYieldQty] = useState("");
  const [estLaborMin, setEstLaborMin] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<RecipeLineValue[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useRecordRecipe();
  // Called unconditionally (rules of hooks) even in create mode — `recipe?.id` is only "" then,
  // and the mutation is never actually invoked unless `isEditMode` is true (see handleSubmit).
  const updateMutation = useUpdateRecipe(recipe?.id ?? "");

  // Broad, unfiltered item list — same precedent as PurchaseForm's itemsById: cheap at this app's
  // solo-business scale, and needed to look up each ingredient line's replacementCost for the
  // per-line cost-contribution preview, plus a fallback for the output item (before the picker's
  // own onChange has fired, e.g. right after opening in edit mode).
  const itemsQuery = useItemsQuery({ isActive: true });
  const itemsById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  const effectiveOutputItem =
    outputItem ?? (outputItemId ? (itemsById.get(outputItemId) ?? null) : null);

  // Reset only on the open transition (or a switch to a different recipe while open) — mirrors
  // PurchaseForm's `purchase?.id` precedent so a background refetch of the SAME recipe never
  // clobbers in-progress edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (open) {
      if (recipe) {
        const initial = recipeToFormState(recipe);
        setName(initial.name);
        setOutputItemId(initial.outputItemId);
        setOutputItem(null);
        setExpectedYieldQty(initial.expectedYieldQty);
        setEstLaborMin(initial.estLaborMin);
        setIsDefault(initial.isDefault);
        setNotes(initial.notes);
        setLines(initial.lines.length > 0 ? initial.lines : [emptyLine()]);
      } else {
        setName("");
        setOutputItemId(null);
        setOutputItem(null);
        setExpectedYieldQty("");
        setEstLaborMin("");
        setIsDefault(false);
        setNotes("");
        setLines([emptyLine()]);
      }
      setError(null);
    }
  }, [open, recipe?.id]);

  const disabled = isEditMode ? updateMutation.isPending : createMutation.isPending;

  async function handleSubmit() {
    setError(null);
    if (!outputItemId) {
      setError(recipesLabels.errors.outputItemRequired);
      return;
    }

    const yieldQty = parseDecimalToInt(expectedYieldQty, 3);
    if (yieldQty === null || yieldQty <= 0) {
      setError(recipesLabels.errors.yieldRequired);
      return;
    }

    let laborMin: number | undefined;
    if (estLaborMin.trim() !== "") {
      const parsedLabor = parseNonNegativeInt(estLaborMin);
      if (parsedLabor === null) {
        setError(recipesLabels.errors.generic);
        return;
      }
      laborMin = parsedLabor;
    }

    const parsedLines: { itemId: string; qty: number }[] = [];
    for (const line of lines) {
      const qty = parseDecimalToInt(line.qty, 3);
      if (!line.itemId || qty === null || qty <= 0) {
        setError(recipesLabels.errors.invalidLine);
        return;
      }
      parsedLines.push({ itemId: line.itemId, qty });
    }

    const parsed = recordRecipeCommandSchema.safeParse({
      name: name.trim(),
      outputItemId,
      expectedYieldQty: yieldQty,
      estLaborMin: laborMin,
      isDefault,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      lines: parsedLines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? recipesLabels.errors.generic);
      return;
    }

    try {
      if (isEditMode) {
        await updateMutation.mutateAsync(parsed.data);
      } else {
        await createMutation.mutateAsync(parsed.data);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : recipesLabels.errors.generic);
    }
  }

  function renderLineExtra(line: RecipeLineValue) {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    if (!item) return null;
    const qty = parseDecimalToInt(line.qty, 3);
    if (qty === null || qty <= 0) {
      return (
        <span className="text-subtle-foreground text-xs">{recipesLabels.lineContribution}: —</span>
      );
    }
    // qty is milli-units, item.replacementCost is centavos PER MILLI-UNIT (Doc 04 §2, same scale
    // StockTable.tsx documents) — so qty × replacementCost is directly the line's contribution in
    // whole centavos, no ×1000 conversion needed (that only applies when displaying a per-WHOLE-
    // unit cost). Display-only preview, rounded for formatMoney's integer requirement.
    const contribution = roundHalfUpToInt(qty * item.replacementCost);
    return (
      <span className="text-muted-foreground text-xs">
        {recipesLabels.lineContribution}:{" "}
        <span className="numeric-cell font-medium text-foreground">
          {formatMoney(contribution)}
        </span>
      </span>
    );
  }

  /** CalcTrace inputs for the saved recipe's cost panel below: one row per ingredient line's
   * contribution (qty × unit cost on `basis`) plus the expected yield the batch is divided by —
   * the same two numbers `computeTheoreticalCostPerOutputUnit` (core/recipes/theoretical-cost.ts,
   * C-3b) folds together server-side. Only meaningful once `recipe` exists (edit mode). */
  function buildCostTraceInputs(basis: "wac" | "replacementCost"): CalcTraceInput[] {
    if (!recipe) return [];
    return [
      ...recipe.lines.map((line): CalcTraceInput => {
        const item = itemsById.get(line.itemId);
        // KOK-071 vertical 1: wacMc is milli-centavos per WHOLE unit; replacementCost is not
        // migrated yet, so the wac basis converts back down to the old centavos-per-milli-unit
        // convention this function still expects (mirrors core/recipes/dto.ts's buildCostDto).
        const unitCost =
          basis === "wac" ? (item ? item.wacMc / 1_000_000 : 0) : (item?.replacementCost ?? 0);
        const contribution = roundHalfUpToInt(line.qty * unitCost);
        return { label: item?.name ?? line.itemId, value: formatMoney(contribution) };
      }),
      {
        label: recipesLabels.fieldYield,
        value: formatIntAsDecimalInput(recipe.expectedYieldQty, 3),
      },
    ];
  }

  const dialogTitle = isEditMode ? recipesLabels.editTitle : recipesLabels.recordTitle;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={dialogTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{dialogTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="rf-name">
            {recipesLabels.fieldName}
          </label>
          <Input
            id="rf-name"
            placeholder={recipesLabels.namePlaceholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="rf-output-item">
            {recipesLabels.fieldOutputItem}
          </label>
          <ItemPicker
            value={outputItemId}
            onChange={(id, item) => {
              setOutputItemId(id);
              setOutputItem(item);
            }}
            kindFilter={["SEMI_FINISHED", "FINISHED"]}
            placeholder={recipesLabels.outputItemPlaceholder}
            disabled={disabled}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="rf-yield">
              {recipesLabels.fieldYield}
            </label>
            <Input
              id="rf-yield"
              inputMode="decimal"
              placeholder="0"
              value={expectedYieldQty}
              onChange={(e) => setExpectedYieldQty(e.target.value)}
              disabled={disabled}
            />
            {effectiveOutputItem ? (
              <span className="text-muted-foreground text-xs">
                {recipesLabels.unitAbbrev[effectiveOutputItem.unit]}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="rf-labor">
              {recipesLabels.fieldLaborMin}
            </label>
            <Input
              id="rf-labor"
              inputMode="numeric"
              placeholder={recipesLabels.laborMinPlaceholder}
              value={estLaborMin}
              onChange={(e) => setEstLaborMin(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-foreground text-sm">
          <Switch
            checked={isDefault}
            onCheckedChange={setIsDefault}
            disabled={disabled}
            aria-label={recipesLabels.fieldDefault}
          />
          <span>{recipesLabels.fieldDefault}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="rf-notes">
            {recipesLabels.fieldNotes}
          </label>
          <Input
            id="rf-notes"
            placeholder={recipesLabels.notesPlaceholder}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground">{recipesLabels.linesTitle}</span>
          <LineEditor
            lines={lines}
            onChange={setLines}
            createLine={emptyLine}
            disabled={disabled}
            showAmount={false}
            itemKindFilter={["RAW_MATERIAL", "SEMI_FINISHED"]}
            labels={{
              item: recipesLabels.lineItem,
              qty: recipesLabels.lineQty,
              addLine: recipesLabels.addLine,
              removeLine: recipesLabels.removeLine,
              qtyPlaceholder: "0",
            }}
            renderExtraColumns={renderLineExtra}
          />
        </div>

        {recipe && settings ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted px-4 py-3">
            <span className="font-medium text-foreground text-sm">
              {recipesLabels.costPanelTitle}
            </span>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                {recipesLabels.costWacLabel}
                <CalcTrace
                  formula={recipesLabels.costFormula}
                  inputs={buildCostTraceInputs("wac")}
                />
              </span>
              <span className="numeric-cell text-foreground text-sm">
                {formatMoney(recipe.theoreticalCostWac.costPerOutputUnit)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
                {recipesLabels.costReplacementLabel}
                <CalcTrace
                  formula={recipesLabels.costFormula}
                  inputs={buildCostTraceInputs("replacementCost")}
                />
              </span>
              <span className="numeric-cell font-semibold text-foreground text-lg">
                {formatMoney(recipe.theoreticalCostReplacement.costPerOutputUnit)}
              </span>
            </div>
            {recipe.theoreticalCostReplacement.margin ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">{recipesLabels.marginLabel}</span>
                <MarginBadge
                  pctBasisPoints={recipe.theoreticalCostReplacement.margin.pctBasisPoints}
                  minMarginPct={settings.minMarginPct}
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">{recipesLabels.noSalePrice}</p>
            )}
          </div>
        ) : null}

        {error ? <p className="text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
        >
          {recipesLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled}>
          {isEditMode ? recipesLabels.save : recipesLabels.submit}
        </Button>
      </div>
    </Dialog>
  );
}

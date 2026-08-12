// Dialog for UC-02 "recordProductionRun" (Doc 07 SC-05). Mirrors PurchaseForm.tsx's structure
// (Dialog wrapper, local form state, reset-on-open, useReplayConfirmableMutation for edit mode)
// crossed with RecipeForm.tsx's "recipe-as-template" line prefill and theoretical-cost panel
// (here rendered live from client-side arithmetic, not gated on a saved server response, since the
// whole point of this preview is to update as the owner types â€” no round-trip needed for a sum of
// numbers already on the client). Validated with the exact same `recordProductionRunCommandSchema`
// the API route parses with (D-4). No session/custom-order picker â€” Sessions (KOK-027) and custom
// orders (KOK-033) don't exist yet; the schema's optional `sessionId`/`customOrderId` are simply
// never set from this form, same precedent as PurchaseForm's `sessionId` omission.

import type {
  ItemDto,
  ProductionRunDto,
  RecipeDto,
  UpdateProductionRunCommand,
  UpdateProductionRunResult,
} from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  nowIso,
  rateFromTotal,
  recordProductionRunCommandSchema,
  toBusinessDate,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { AlertTriangle, Check, Minus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CalcTrace, type CalcTraceInput } from "@/components/common/CalcTrace";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { InfoTooltip } from "@/components/ui/tooltip";
import { useItemsQuery } from "@/features/catalog/api";
import { useStock } from "@/features/inventory/api";
import { useRecordProductionRun, useUpdateProductionRun } from "@/features/production-runs/api";
import { useRecipesQuery } from "@/features/recipes/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { catalogLabels } from "@/lib/i18n-catalog";
import { productionLabels } from "@/lib/i18n-production";

export interface ProductionRunFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present -> edit mode: prefill from this run and submit via `useUpdateProductionRun` (wrapped
   * in `useReplayConfirmableMutation` for the R-5 confirmation dance). Absent -> create mode,
   * submits via `useRecordProductionRun`. */
  productionRun?: ProductionRunDto;
}

interface ProductionLineValue extends LineEditorLine {
  /** Stable identity lets batch recomputation follow recipe lines after manual row edits. */
  lineKey: string;
  itemId: string | null;
  /** Milli-units decimal string (scale 3) â€” same convention as PurchaseForm/RecipeForm's line qty. */
  qty: string;
}

let nextLineKey = 0;

function newLineKey(): string {
  nextLineKey += 1;
  return `production-line-${nextLineKey}`;
}

function emptyLine(): ProductionLineValue {
  return { lineKey: newLineKey(), itemId: null, qty: "" };
}

interface ProductionRunFormState {
  recipeId: string;
  /** REAL decimal string (e.g. "2.5") â€” `batches` is not milli-scaled (production-runs.ts's
   * `batchesSchema`: `z.number().positive()`, no `.int()`), so `parseBatches` below is used
   * instead of `parseDecimalToInt`. */
  batches: string;
  actualOutputQty: string;
  /** Centavos decimal string (scale 2). Empty means "not entered" (schema defaults to 0). */
  indirectCost: string;
  businessDate: string;
  notes: string;
  lines: ProductionLineValue[];
}

/** Mirrors PurchaseForm's `purchaseToFormState` â€” pure and framework-free so it stays testable
 * without rendering the component (this workspace has neither jsdom nor @testing-library/react). */
export function productionRunToFormState(productionRun: ProductionRunDto): ProductionRunFormState {
  return {
    recipeId: productionRun.recipeId,
    batches: String(productionRun.batches),
    actualOutputQty: formatIntAsDecimalInput(productionRun.actualOutputQty, 3),
    indirectCost:
      productionRun.indirectCost > 0 ? formatIntAsDecimalInput(productionRun.indirectCost, 2) : "",
    businessDate: productionRun.businessDate,
    notes: productionRun.notes ?? "",
    lines:
      productionRun.lines.length > 0
        ? productionRun.lines.map((line, index) => ({
            lineKey: `saved-production-line-${index}`,
            itemId: line.itemId,
            qty: formatIntAsDecimalInput(line.qty, 3),
          }))
        : [emptyLine()],
  };
}

/** Parses a decimal string (Bolivian input accepts either "," or "." as the separator) into a
 * plain positive JS number. Unlike `parseDecimalToInt` (money/qty milli-unit scale), `batches` is
 * a REAL multiplier stored as-is â€” no integer scaling applies here. */
function parseBatches(input: string): number | null {
  const trimmed = input.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function quantityForBatches(quantity: number, batches: number): string {
  return formatIntAsDecimalInput(toMilliUnits(Math.round(quantity * batches)), 3);
}

export function ProductionRunForm({ open, onOpenChange, productionRun }: ProductionRunFormProps) {
  const isEditMode = Boolean(productionRun);

  const [recipeId, setRecipeId] = useState("");
  const [batches, setBatches] = useState("1");
  const [actualOutputQty, setActualOutputQty] = useState("");
  const [indirectCost, setIndirectCost] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ProductionLineValue[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const actualOutputQtyAutoRef = useRef<string | null>(null);
  const actualOutputQtyDirtyRef = useRef(false);
  const lineAutoQtyRef = useRef(new Map<string, string>());
  const dirtyLineKeysRef = useRef(new Set<string>());

  const createMutation = useRecordProductionRun();
  // Called unconditionally (rules of hooks) even in create mode â€” `productionRun?.id` is only ""
  // then, and the mutation is never actually invoked unless `isEditMode` is true (see handleSubmit).
  const updateMutation = useUpdateProductionRun(productionRun?.id ?? "");
  const editReplay = useReplayConfirmableMutation<
    UpdateProductionRunCommand,
    UpdateProductionRunResult
  >((command) => updateMutation.mutateAsync(command), { onSuccess: () => onOpenChange(false) });

  const recipesQuery = useRecipesQuery({ isActive: true });
  const recipes = recipesQuery.data?.recipes ?? [];
  const recipesById = useMemo(() => {
    const map = new Map<string, RecipeDto>();
    for (const recipe of recipes) map.set(recipe.id, recipe);
    return map;
  }, [recipes]);

  const itemsQuery = useItemsQuery({ isActive: true });
  const itemsById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  // Current on-hand quantity per item (v_stock, INV-5) — used only for the informational
  // per-line indicator below. Production remains allowed to consume beyond on-hand stock (INV-8).
  const stockQuery = useStock();
  const onHandByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQuery.data?.stock ?? []) {
      map.set(row.itemId, toMilliUnits(row.qtyOnHand));
    }
    return map;
  }, [stockQuery.data]);

  const selectedRecipe = recipeId ? (recipesById.get(recipeId) ?? null) : null;
  const outputItem = selectedRecipe ? (itemsById.get(selectedRecipe.outputItemId) ?? null) : null;

  // Reset only on the open transition (or a switch to a different run while open) â€” mirrors
  // PurchaseForm's `purchase?.id` precedent so a background refetch of the SAME run never clobbers
  // in-progress edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (open) {
      if (productionRun) {
        const initial = productionRunToFormState(productionRun);
        setRecipeId(initial.recipeId);
        setBatches(initial.batches);
        setActualOutputQty(initial.actualOutputQty);
        setIndirectCost(initial.indirectCost);
        setBusinessDate(initial.businessDate);
        setNotes(initial.notes);
        setLines(initial.lines);
        actualOutputQtyAutoRef.current = null;
        actualOutputQtyDirtyRef.current = true;
        lineAutoQtyRef.current.clear();
        dirtyLineKeysRef.current.clear();
      } else {
        setRecipeId("");
        setBatches("1");
        setActualOutputQty("");
        setIndirectCost("");
        setBusinessDate(toBusinessDate(nowIso()));
        setNotes("");
        setLines([emptyLine()]);
        actualOutputQtyAutoRef.current = null;
        actualOutputQtyDirtyRef.current = false;
        lineAutoQtyRef.current.clear();
        dirtyLineKeysRef.current.clear();
      }
      setError(null);
    }
  }, [open, productionRun?.id]);

  const disabled = isEditMode ? editReplay.isPending : createMutation.isPending;

  /** Recipe â†’ line prefill (UI convenience default, not a validated number â€” the user edits freely
   * afterward). Automatic values are remembered so a later `batches` edit updates untouched fields
   * without overwriting a value the user has changed by hand. */
  function handleRecipeChange(newRecipeId: string) {
    setRecipeId(newRecipeId);
    const recipe = recipesById.get(newRecipeId);
    if (!recipe) return;
    const batchesValue = parseBatches(batches) ?? 1;
    const nextLines =
      recipe.lines.length > 0
        ? recipe.lines.map(
            (line): ProductionLineValue => ({
              lineKey: line.id,
              itemId: line.itemId,
              qty: quantityForBatches(line.qty, batchesValue),
            }),
          )
        : [emptyLine()];
    setLines(nextLines);
    lineAutoQtyRef.current = new Map(
      recipe.lines.map((line) => [line.id, quantityForBatches(line.qty, batchesValue)]),
    );
    dirtyLineKeysRef.current.clear();

    const nextActualOutputQty = quantityForBatches(recipe.expectedYieldQty, batchesValue);
    setActualOutputQty(nextActualOutputQty);
    actualOutputQtyAutoRef.current = nextActualOutputQty;
    actualOutputQtyDirtyRef.current = false;
  }

  function handleBatchesChange(nextBatches: string) {
    setBatches(nextBatches);
    const batchesValue = parseBatches(nextBatches);
    if (!selectedRecipe || batchesValue === null) return;

    if (!actualOutputQtyDirtyRef.current && actualOutputQtyAutoRef.current === actualOutputQty) {
      const nextActualOutputQty = quantityForBatches(selectedRecipe.expectedYieldQty, batchesValue);
      setActualOutputQty(nextActualOutputQty);
      actualOutputQtyAutoRef.current = nextActualOutputQty;
    }

    const recipeLinesById = new Map(selectedRecipe.lines.map((line) => [line.id, line]));
    setLines((currentLines) =>
      currentLines.map((line) => {
        const recipeLine = recipeLinesById.get(line.lineKey);
        const lastAutoQty = lineAutoQtyRef.current.get(line.lineKey);
        if (!recipeLine || dirtyLineKeysRef.current.has(line.lineKey) || lastAutoQty !== line.qty) {
          return line;
        }
        const nextQty = quantityForBatches(recipeLine.qty, batchesValue);
        lineAutoQtyRef.current.set(line.lineKey, nextQty);
        return { ...line, qty: nextQty };
      }),
    );
  }

  function handleActualOutputQtyChange(nextValue: string) {
    actualOutputQtyDirtyRef.current = true;
    setActualOutputQty(nextValue);
  }

  function handleLinesChange(nextLines: ProductionLineValue[]) {
    const currentLinesByKey = new Map(lines.map((line) => [line.lineKey, line]));
    const nextLineKeys = new Set(nextLines.map((line) => line.lineKey));
    for (const line of nextLines) {
      const currentLine = currentLinesByKey.get(line.lineKey);
      if (!currentLine || currentLine.itemId !== line.itemId || currentLine.qty !== line.qty) {
        dirtyLineKeysRef.current.add(line.lineKey);
      }
    }
    for (const line of lines) {
      if (!nextLineKeys.has(line.lineKey)) {
        lineAutoQtyRef.current.delete(line.lineKey);
        dirtyLineKeysRef.current.delete(line.lineKey);
      }
    }
    setLines(nextLines);
  }

  async function handleSubmit() {
    setError(null);
    if (!recipeId) {
      setError(productionLabels.errors.recipeRequired);
      return;
    }

    const batchesValue = parseBatches(batches);
    if (batchesValue === null) {
      setError(productionLabels.errors.batchesInvalid);
      return;
    }

    const actualOutputQtyValue = parseDecimalToInt(actualOutputQty, 3);
    if (actualOutputQtyValue === null || actualOutputQtyValue <= 0) {
      setError(productionLabels.errors.outputQtyInvalid);
      return;
    }

    let indirectCostValue: number | undefined;
    if (indirectCost.trim() !== "") {
      const parsedIndirect = parseDecimalToInt(indirectCost, 2);
      if (parsedIndirect === null) {
        setError(productionLabels.errors.generic);
        return;
      }
      indirectCostValue = parsedIndirect;
    }

    const parsedLines: { itemId: string; qty: number }[] = [];
    for (const line of lines) {
      const qty = parseDecimalToInt(line.qty, 3);
      if (!line.itemId || qty === null || qty <= 0) {
        setError(productionLabels.errors.invalidLine);
        return;
      }
      parsedLines.push({ itemId: line.itemId, qty });
    }

    const parsed = recordProductionRunCommandSchema.safeParse({
      recipeId,
      batches: batchesValue,
      actualOutputQty: actualOutputQtyValue,
      indirectCost: indirectCostValue,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      // Edit mode keeps the run's original instant â€” same precedent as PurchaseForm's occurredAt
      // handling (no UI field to change it; an edit shouldn't re-stamp when it actually happened).
      occurredAt: productionRun ? productionRun.occurredAt : nowIso(),
      businessDate,
      lines: parsedLines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? productionLabels.errors.generic);
      return;
    }

    if (isEditMode) {
      editReplay.execute(parsed.data);
      return;
    }

    try {
      await createMutation.mutateAsync(parsed.data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : productionLabels.errors.generic);
    }
  }

  /** Combines client-side validation errors (`error` state) with a genuine (non-confirmation)
   * failure surfaced by `editReplay` â€” mirrors PurchaseForm's identical `displayError`. */
  const displayError =
    error ??
    (isEditMode && editReplay.error
      ? editReplay.error instanceof ApiError
        ? editReplay.error.message
        : productionLabels.errors.generic
      : null);

  function renderLineExtra(line: ProductionLineValue) {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    if (!item) return null;
    const qty = parseDecimalToInt(line.qty, 3);
    if (qty === null || qty <= 0) {
      return (
        <span className="text-subtle-foreground text-xs">
          {productionLabels.lineContribution}: —
        </span>
      );
    }
    // Production consumption values at WAC (C-6), using the server's `totalCentavos` conversion.
    const contribution = totalCentavos(toMilliCentavosPerUnit(item.wacMc), toMilliUnits(qty));
    const onHand = onHandByItemId.get(item.id) ?? 0;
    const stockIndicator = item.isUnmetered ? (
      <span
        role="img"
        aria-label={catalogLabels.fieldIsUnmetered}
        title={catalogLabels.fieldIsUnmetered}
        className="inline-flex text-muted-foreground"
      >
        <Minus className="size-4" aria-hidden="true" />
      </span>
    ) : onHand >= qty ? (
      <span
        role="img"
        aria-label={productionLabels.lineStockSufficient}
        title={productionLabels.lineStockSufficient}
        className="inline-flex text-positive"
      >
        <Check className="size-4" aria-hidden="true" />
      </span>
    ) : (
      <span
        role="img"
        aria-label={productionLabels.lineStockInsufficient}
        title={productionLabels.lineStockInsufficient}
        className="inline-flex text-warning"
      >
        <AlertTriangle className="size-4" aria-hidden="true" />
      </span>
    );
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {productionLabels.lineContribution}:{" "}
          <span className="numeric-cell font-medium text-foreground">
            {formatMoney(contribution)}
          </span>
        </span>
        {stockIndicator}
      </div>
    );
  }

  // --- Live cost preview (pure client computation, shown always â€” no server round-trip needed) --

  const directCostPreview = useMemo(() => {
    let sum = toCentavos(0);
    for (const line of lines) {
      const item = line.itemId ? itemsById.get(line.itemId) : undefined;
      const qty = parseDecimalToInt(line.qty, 3);
      if (!item || qty === null || qty <= 0) continue;
      sum = toCentavos(sum + totalCentavos(toMilliCentavosPerUnit(item.wacMc), toMilliUnits(qty)));
    }
    return sum;
  }, [lines, itemsById]);

  const indirectCostPreview = parseDecimalToInt(indirectCost, 2) ?? 0;
  const totalCostPreview = directCostPreview + indirectCostPreview;
  const actualOutputQtyPreview = parseDecimalToInt(actualOutputQty, 3);
  // Keep the preview on the server's sanctioned total-to-rate conversion.
  const outputUnitCostPreviewMc =
    actualOutputQtyPreview !== null && actualOutputQtyPreview > 0
      ? rateFromTotal(toCentavos(totalCostPreview), toMilliUnits(actualOutputQtyPreview))
      : null;
  const outputUnitCostPreviewLabel =
    outputUnitCostPreviewMc !== null && outputItem
      ? `${formatMoney(totalCentavos(outputUnitCostPreviewMc, WHOLE_UNIT_MILLI_UNITS))} / ${productionLabels.unitAbbrev[outputItem.unit]}`
      : "—";

  // CalcTrace inputs for the cost panel below â€” one row per consumption line's contribution
  // (qty Ã— item.wacMc, same basis directCostPreview itself sums) for the direct-cost trace, and
  // the two/three numbers each downstream figure folds together for the total/unit traces.
  const directCostTraceInputs: CalcTraceInput[] = lines.flatMap((line) => {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    const qty = parseDecimalToInt(line.qty, 3);
    if (!item || qty === null || qty <= 0) return [];
    return [
      {
        label: item.name,
        value: formatMoney(totalCentavos(toMilliCentavosPerUnit(item.wacMc), toMilliUnits(qty))),
      },
    ];
  });
  const totalCostTraceInputs: CalcTraceInput[] = [
    { label: productionLabels.costDirectLabel, value: formatMoney(directCostPreview) },
    {
      label: productionLabels.costIndirectLabel,
      value: formatMoney(toCentavos(indirectCostPreview)),
    },
  ];
  const unitCostTraceInputs: CalcTraceInput[] = [
    {
      label: productionLabels.costTotalLabel,
      value: formatMoney(toCentavos(totalCostPreview)),
    },
    {
      label: productionLabels.fieldActualOutputQty,
      value:
        actualOutputQtyPreview !== null && outputItem
          ? formatQty(actualOutputQtyPreview, outputItem.unit)
          : "—",
    },
  ];

  const dialogTitle = isEditMode ? productionLabels.editTitle : productionLabels.recordTitle;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} aria-label={dialogTitle}>
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-foreground text-md">{dialogTitle}</h2>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="prf-recipe">
              {productionLabels.fieldRecipe}
            </label>
            <Select
              id="prf-recipe"
              value={recipeId}
              onChange={(e) => handleRecipeChange(e.target.value)}
              disabled={disabled}
            >
              <option value="" disabled>
                {productionLabels.recipePlaceholder}
              </option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="prf-batches">
                {productionLabels.fieldBatches}
              </label>
              <Input
                id="prf-batches"
                inputMode="decimal"
                placeholder="1"
                value={batches}
                onChange={(e) => handleBatchesChange(e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="prf-date">
                {productionLabels.fieldDate}
              </label>
              <Input
                id="prf-date"
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="prf-output-qty">
                {productionLabels.fieldActualOutputQty}
              </label>
              <Input
                id="prf-output-qty"
                inputMode="decimal"
                placeholder="0"
                value={actualOutputQty}
                onChange={(e) => handleActualOutputQtyChange(e.target.value)}
                disabled={disabled}
              />
              {outputItem ? (
                <span className="text-muted-foreground text-xs">
                  {productionLabels.unitAbbrev[outputItem.unit]} de {outputItem.name}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <label className="font-medium text-foreground" htmlFor="prf-indirect-cost">
                  {productionLabels.fieldIndirectCost}
                </label>
                <InfoTooltip
                  content={productionLabels.tooltipIndirectCost}
                  label={`Más información: ${productionLabels.fieldIndirectCost}`}
                />
              </div>
              <Input
                id="prf-indirect-cost"
                inputMode="decimal"
                placeholder="0.00"
                value={indirectCost}
                onChange={(e) => setIndirectCost(e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="prf-notes">
              {productionLabels.fieldNotes}
            </label>
            <Input
              id="prf-notes"
              placeholder={productionLabels.notesPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-foreground">{productionLabels.linesTitle}</span>
            <LineEditor
              lines={lines}
              onChange={handleLinesChange}
              createLine={emptyLine}
              disabled={disabled}
              showAmount={false}
              itemKindFilter={["RAW_MATERIAL", "SEMI_FINISHED"]}
              labels={{
                item: productionLabels.lineItem,
                qty: productionLabels.lineQty,
                addLine: productionLabels.addLine,
                removeLine: productionLabels.removeLine,
                qtyPlaceholder: "0",
              }}
              renderExtraColumns={renderLineExtra}
            />
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted px-4 py-3">
            <span className="font-medium text-foreground text-sm">
              {productionLabels.costPanelTitle}
            </span>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                {productionLabels.costDirectLabel}
                <CalcTrace
                  formula={productionLabels.costDirectFormula}
                  inputs={directCostTraceInputs}
                />
              </span>
              <span className="numeric-cell text-foreground text-sm">
                {formatMoney(directCostPreview)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                {productionLabels.costIndirectLabel}
              </span>
              <span className="numeric-cell text-foreground text-sm">
                {formatMoney(toCentavos(indirectCostPreview))}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
                {productionLabels.costTotalLabel}
                <CalcTrace
                  formula={productionLabels.costTotalFormula}
                  inputs={totalCostTraceInputs}
                />
              </span>
              <span className="numeric-cell font-semibold text-foreground text-lg">
                {formatMoney(toCentavos(totalCostPreview))}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                {productionLabels.costUnitLabel}
                <CalcTrace
                  formula={productionLabels.costUnitFormula}
                  inputs={unitCostTraceInputs}
                />
              </span>
              <span className="numeric-cell text-foreground text-sm">
                {outputUnitCostPreviewLabel}
              </span>
            </div>
          </div>

          {displayError ? <p className="text-negative text-sm">{displayError}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={disabled}
          >
            {productionLabels.cancel}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={disabled || !recipeId}>
            {isEditMode ? productionLabels.save : productionLabels.submit}
          </Button>
        </div>
      </Dialog>
      {isEditMode && editReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={editReplay.pendingConfirmation.impact}
          onConfirm={editReplay.confirm}
          onCancel={editReplay.cancel}
          confirmLoading={editReplay.isPending}
          title={productionLabels.impactEditTitle}
          description={productionLabels.impactEditDescription}
          confirmLabel={productionLabels.save}
        />
      ) : null}
    </>
  );
}

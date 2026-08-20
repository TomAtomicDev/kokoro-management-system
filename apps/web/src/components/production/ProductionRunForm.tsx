// Full-page form for UC-02 "recordProductionRun" (Doc 07 SC-05, KOK-141). Mirrors SaleForm.tsx's
// structure (FormPage shell, local form state, route-mounted draft, edit-mode prefill, both
// branches wrapped in useReplayConfirmableMutation) crossed with RecipeForm.tsx's
// "recipe-as-template" line prefill and theoretical-cost panel (here rendered live from
// client-side arithmetic, not gated on a saved server response, since the whole point of this
// preview is to update as the owner types — no round-trip needed for a sum of numbers already on
// the client). Validated with the exact same `recordProductionRunCommandSchema` the API route
// parses with (D-4). Create mode threads `sessionId` from `preselectedSessionId` (the route's
// `?sessionId=` search param, mirroring PurchaseForm/AssemblyForm's identical precedent — see
// SessionDetailDrawer's "add a linked event" affordance); optional order linkage is captured with
// the shared OrderPicker.

import type {
  ItemDto,
  ProductionRunDto,
  RecipeDto,
  RecordProductionRunCommand,
  RecordProductionRunResult,
  UpdateProductionRunCommand,
  UpdateProductionRunResult,
} from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  nowIso,
  PRODUCTION_RUN_NOTES_MAX_LENGTH,
  rateFromTotal,
  recordProductionRunCommandSchema,
  toBusinessDate,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, Minus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CalcTrace, type CalcTraceInput } from "@/components/common/CalcTrace";
import { FormPage } from "@/components/common/FormPage";
import { PinnedSummaryFooter } from "@/components/common/PinnedSummaryFooter";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { OrderPicker } from "@/components/orders/OrderPicker";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { InfoTooltip } from "@/components/ui/tooltip";
import { useItemsQuery } from "@/features/catalog/api";
import { useStock } from "@/features/inventory/api";
import { useRecordProductionRun, useUpdateProductionRun } from "@/features/production-runs/api";
import { useRecipesQuery } from "@/features/recipes/api";
import {
  clearPersistentDraft,
  readPersistentDraft,
  writePersistentDraft,
} from "@/hooks/usePersistentDraft";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { hasUnsavedChanges, useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { catalogLabels } from "@/lib/i18n-catalog";
import { ordersLabels } from "@/lib/i18n-orders";
import { productionLabels } from "@/lib/i18n-production";

export interface ProductionRunFormProps {
  /** Present -> edit mode: prefill from this run and submit via `useUpdateProductionRun` (wrapped
   * in `useReplayConfirmableMutation` for the R-5 confirmation dance). Absent -> create mode,
   * submits via `useRecordProductionRun`. */
  productionRun?: ProductionRunDto;
  /** Create mode only: threaded into the create command's `sessionId`; ignored in edit mode. */
  preselectedSessionId?: string;
}

export interface ProductionLineValue extends LineEditorLine {
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
  outputItemId: string;
  customOrderId: string | null;
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

export interface ProductionRunEditTracking {
  actualOutputQtyAuto: string | null;
  actualOutputQtyDirty: boolean;
  lineAutoQty: ReadonlyMap<string, string>;
  dirtyLineKeys: ReadonlySet<string>;
}

export interface ProductionRunQuantityState {
  actualOutputQty: string;
  actualOutputQtyAuto: string | null;
  actualOutputQtyDirty: boolean;
  lines: readonly ProductionLineValue[];
  lineAutoQty: ReadonlyMap<string, string>;
  dirtyLineKeys: ReadonlySet<string>;
}

export interface ProductionRunRecomputeResult {
  actualOutputQty: string;
  actualOutputQtyAuto: string | null;
  lines: ProductionLineValue[];
  lineAutoQty: Map<string, string>;
  dirtyLineKeys: Set<string>;
}

function syntheticSavedProductionLineKey(
  consumptionId: string,
  recipeLineIds: ReadonlySet<string>,
  usedLineKeys: ReadonlySet<string>,
): string {
  const baseKey = `saved-production-line-${consumptionId}`;
  let candidate = baseKey;
  let suffix = 0;
  while (recipeLineIds.has(candidate) || usedLineKeys.has(candidate)) {
    suffix += 1;
    candidate = `${baseKey}-${suffix}`;
  }
  return candidate;
}

function recipeLineIdsByItemId(recipe?: RecipeDto): Map<string, string[]> {
  const lineIdsByItemId = new Map<string, string[]>();
  for (const line of recipe?.lines ?? []) {
    const lineIds = lineIdsByItemId.get(line.itemId) ?? [];
    lineIds.push(line.id);
    lineIdsByItemId.set(line.itemId, lineIds);
  }
  return lineIdsByItemId;
}

/** Mirrors PurchaseForm's `purchaseToFormState` â€” pure and framework-free so it stays testable
 * without rendering the component (this workspace has neither jsdom nor @testing-library/react). */
export function productionRunToFormState(
  productionRun: ProductionRunDto,
  recipe?: RecipeDto,
): ProductionRunFormState {
  const recipeLineIds = new Set(recipe?.lines.map((line) => line.id) ?? []);
  const lineIdsByItemId = recipeLineIdsByItemId(recipe);
  const usedRecipeLineIds = new Set<string>();
  const usedLineKeys = new Set<string>();
  const savedLines = productionRun.lines.map((line) => {
    const matchingLineId = lineIdsByItemId
      .get(line.itemId)
      ?.find((lineId) => !usedRecipeLineIds.has(lineId));
    const lineKey =
      matchingLineId ?? syntheticSavedProductionLineKey(line.id, recipeLineIds, usedLineKeys);
    if (matchingLineId) usedRecipeLineIds.add(matchingLineId);
    usedLineKeys.add(lineKey);
    return {
      lineKey,
      itemId: line.itemId,
      qty: formatIntAsDecimalInput(line.qty, 3),
    };
  });

  return {
    recipeId: productionRun.recipeId ?? "",
    outputItemId: productionRun.outputItemId,
    customOrderId: productionRun.customOrderId,
    batches: String(productionRun.batches),
    actualOutputQty: formatIntAsDecimalInput(productionRun.actualOutputQty, 3),
    indirectCost:
      productionRun.indirectCost > 0 ? formatIntAsDecimalInput(productionRun.indirectCost, 2) : "",
    businessDate: productionRun.businessDate,
    notes: productionRun.notes ?? "",
    lines: savedLines.length > 0 ? savedLines : [emptyLine()],
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

export function productionRunEditTracking(
  productionRun: ProductionRunDto,
  recipe: RecipeDto | undefined,
  lines: readonly ProductionLineValue[],
): ProductionRunEditTracking {
  const lineAutoQty = new Map<string, string>();
  const dirtyLineKeys = new Set<string>();
  if (!recipe) {
    for (const line of lines) dirtyLineKeys.add(line.lineKey);
    return {
      actualOutputQtyAuto: null,
      actualOutputQtyDirty: true,
      lineAutoQty,
      dirtyLineKeys,
    };
  }

  const recipeLinesById = new Map(recipe.lines.map((line) => [line.id, line]));
  const expectedActualOutputQty = quantityForBatches(
    recipe.expectedYieldQty,
    productionRun.batches,
  );
  for (const line of lines) {
    const recipeLine = recipeLinesById.get(line.lineKey);
    if (!recipeLine) {
      dirtyLineKeys.add(line.lineKey);
      continue;
    }
    const expectedQty = quantityForBatches(recipeLine.qty, productionRun.batches);
    lineAutoQty.set(line.lineKey, expectedQty);
    if (line.qty !== expectedQty) dirtyLineKeys.add(line.lineKey);
  }

  return {
    actualOutputQtyAuto: expectedActualOutputQty,
    actualOutputQtyDirty:
      formatIntAsDecimalInput(productionRun.actualOutputQty, 3) !== expectedActualOutputQty,
    lineAutoQty,
    dirtyLineKeys,
  };
}

export function recomputeProductionRunForBatches(
  current: ProductionRunQuantityState,
  recipe: RecipeDto,
  batches: number,
): ProductionRunRecomputeResult {
  let actualOutputQty = current.actualOutputQty;
  let actualOutputQtyAuto = current.actualOutputQtyAuto;
  if (!current.actualOutputQtyDirty && actualOutputQtyAuto === actualOutputQty) {
    actualOutputQty = quantityForBatches(recipe.expectedYieldQty, batches);
    actualOutputQtyAuto = actualOutputQty;
  }

  const recipeLinesById = new Map(recipe.lines.map((line) => [line.id, line]));
  const lineAutoQty = new Map(current.lineAutoQty);
  const dirtyLineKeys = new Set(current.dirtyLineKeys);
  const lines = current.lines.map((line) => {
    const recipeLine = recipeLinesById.get(line.lineKey);
    const lastAutoQty = lineAutoQty.get(line.lineKey);
    if (!recipeLine || dirtyLineKeys.has(line.lineKey) || lastAutoQty !== line.qty) {
      return line;
    }
    const nextQty = quantityForBatches(recipeLine.qty, batches);
    lineAutoQty.set(line.lineKey, nextQty);
    return { ...line, qty: nextQty };
  });

  return { actualOutputQty, actualOutputQtyAuto, lines, lineAutoQty, dirtyLineKeys };
}

export function ProductionRunForm({ productionRun, preselectedSessionId }: ProductionRunFormProps) {
  const navigate = useNavigate();
  const isEditMode = Boolean(productionRun);
  const draftKey = productionRun ? `production:${productionRun.id}` : "production:new";

  const [recipeId, setRecipeId] = useState("");
  const [outputItemId, setOutputItemId] = useState("");
  const [customOrderId, setCustomOrderId] = useState<string | null>(null);
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
  const initialFormStateRef = useRef<ProductionRunFormState | null>(null);
  const initializedRef = useRef<string | null>(null);

  const currentFormState: ProductionRunFormState = {
    recipeId,
    outputItemId,
    customOrderId,
    batches,
    actualOutputQty,
    indirectCost,
    businessDate,
    notes,
    lines,
  };
  const unsavedChangesGuard = useUnsavedChangesGuard({
    isDirty:
      initialFormStateRef.current !== null &&
      hasUnsavedChanges(initialFormStateRef.current, currentFormState),
    blockNavigation: true,
  });

  const createMutation = useRecordProductionRun();
  const createReplay = useReplayConfirmableMutation<
    RecordProductionRunCommand,
    RecordProductionRunResult
  >((command) => createMutation.mutateAsync(command), {
    onSuccess: () => {
      clearPersistentDraft(draftKey);
      unsavedChangesGuard.markClean();
      void navigate({ to: "/production" });
    },
  });
  // Called unconditionally (rules of hooks) even in create mode â€” `productionRun?.id` is only ""
  // then, and the mutation is never actually invoked unless `isEditMode` is true (see handleSubmit).
  const updateMutation = useUpdateProductionRun(productionRun?.id ?? "");
  const editReplay = useReplayConfirmableMutation<
    UpdateProductionRunCommand,
    UpdateProductionRunResult
  >((command) => updateMutation.mutateAsync(command), {
    onSuccess: () => {
      clearPersistentDraft(draftKey);
      unsavedChangesGuard.markClean();
      void navigate({ to: "/production" });
    },
  });

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
  const productionRunRecipe = productionRun
    ? productionRun.recipeId
      ? (recipesById.get(productionRun.recipeId) ?? null)
      : null
    : null;
  const editSeedRecipe = productionRunRecipe ?? selectedRecipe;
  const selectedOutputItemId = selectedRecipe?.outputItemId ?? outputItemId;
  const outputItem = selectedOutputItemId ? (itemsById.get(selectedOutputItemId) ?? null) : null;

  // Runs once per mount (route-owned state, KOK-141 — there is no `open` transition anymore).
  // Recipe data can arrive after the run: wait for it before seeding edit tracking so a clean
  // saved value is not mistaken for a hand edit just because the query was still loading.
  useEffect(() => {
    if (initializedRef.current === draftKey) return;
    if (productionRun && recipesQuery.isLoading && !productionRunRecipe) return;

    const savedDraft = readPersistentDraft<ProductionRunFormState>(draftKey);
    let initialFormState: ProductionRunFormState;
    // A restored draft carries no recipe-auto-qty provenance (it was serialized as plain form
    // values), so it seeds every line as a hand edit — same treatment a recipe-less production run
    // already gets below. Only a freshly loaded saved `productionRun` gets real tracking.
    let tracking: ProductionRunEditTracking | null = null;
    if (savedDraft) {
      initialFormState = { ...savedDraft, outputItemId: savedDraft.outputItemId ?? "" };
    } else if (productionRun) {
      initialFormState = productionRunToFormState(productionRun, editSeedRecipe ?? undefined);
      tracking = productionRunEditTracking(
        productionRun,
        editSeedRecipe ?? undefined,
        initialFormState.lines,
      );
    } else {
      initialFormState = {
        recipeId: "",
        outputItemId: "",
        customOrderId: null,
        batches: "1",
        actualOutputQty: "",
        indirectCost: "",
        businessDate: toBusinessDate(nowIso()),
        notes: "",
        lines: [emptyLine()],
      };
    }

    setRecipeId(initialFormState.recipeId);
    setOutputItemId(initialFormState.outputItemId);
    setCustomOrderId(initialFormState.customOrderId);
    setBatches(initialFormState.batches);
    setActualOutputQty(initialFormState.actualOutputQty);
    setIndirectCost(initialFormState.indirectCost);
    setBusinessDate(initialFormState.businessDate);
    setNotes(initialFormState.notes);
    setLines(initialFormState.lines);
    actualOutputQtyAutoRef.current = tracking?.actualOutputQtyAuto ?? null;
    actualOutputQtyDirtyRef.current = tracking?.actualOutputQtyDirty ?? true;
    lineAutoQtyRef.current = tracking ? new Map(tracking.lineAutoQty) : new Map();
    dirtyLineKeysRef.current = tracking
      ? new Set(tracking.dirtyLineKeys)
      : new Set(initialFormState.lines.map((line) => line.lineKey));
    initialFormStateRef.current = initialFormState;
    setError(null);
    initializedRef.current = draftKey;
  }, [draftKey, editSeedRecipe, productionRun, productionRunRecipe, recipesQuery.isLoading]);

  useEffect(() => {
    if (initializedRef.current !== draftKey) return;
    writePersistentDraft<ProductionRunFormState>(draftKey, {
      recipeId,
      outputItemId,
      customOrderId,
      batches,
      actualOutputQty,
      indirectCost,
      businessDate,
      notes,
      lines,
    });
  }, [
    actualOutputQty,
    batches,
    businessDate,
    customOrderId,
    draftKey,
    indirectCost,
    lines,
    notes,
    recipeId,
    outputItemId,
  ]);

  const disabled = isEditMode ? editReplay.isPending : createReplay.isPending;

  /** Recipe â†’ line prefill (UI convenience default, not a validated number â€” the user edits freely
   * afterward). Automatic values are remembered so a later `batches` edit updates untouched fields
   * without overwriting a value the user has changed by hand. */
  function handleRecipeChange(newRecipeId: string) {
    setRecipeId(newRecipeId);
    const recipe = recipesById.get(newRecipeId);
    if (!recipe) {
      setOutputItemId("");
      setBatches("1");
      setLines([emptyLine()]);
      lineAutoQtyRef.current.clear();
      dirtyLineKeysRef.current = new Set();
      setActualOutputQty("");
      actualOutputQtyAutoRef.current = null;
      actualOutputQtyDirtyRef.current = true;
      return;
    }
    setOutputItemId(recipe.outputItemId);
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

    const next = recomputeProductionRunForBatches(
      {
        actualOutputQty,
        actualOutputQtyAuto: actualOutputQtyAutoRef.current,
        actualOutputQtyDirty: actualOutputQtyDirtyRef.current,
        lines,
        lineAutoQty: lineAutoQtyRef.current,
        dirtyLineKeys: dirtyLineKeysRef.current,
      },
      selectedRecipe,
      batchesValue,
    );
    setActualOutputQty(next.actualOutputQty);
    actualOutputQtyAutoRef.current = next.actualOutputQtyAuto;
    setLines(next.lines);
    lineAutoQtyRef.current = next.lineAutoQty;
    dirtyLineKeysRef.current = next.dirtyLineKeys;
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
    if (!recipeId && !outputItemId) {
      setError(productionLabels.errors.outputItemRequired);
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
      recipeId: recipeId || null,
      outputItemId: recipeId ? undefined : outputItemId,
      customOrderId,
      sessionId: productionRun ? undefined : preselectedSessionId,
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

    createReplay.execute(parsed.data);
  }

  /** Combines client-side validation errors (`error` state) with a genuine (non-confirmation)
   * failure surfaced by the active replay wrapper â€” mirrors PurchaseForm's `displayError`. */
  const displayError =
    error ??
    (isEditMode
      ? editReplay.error instanceof ApiError
        ? editReplay.error.message
        : editReplay.error
          ? productionLabels.errors.generic
          : null
      : createReplay.error instanceof ApiError
        ? createReplay.error.message
        : createReplay.error
          ? productionLabels.errors.generic
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

  const pageTitle = isEditMode ? productionLabels.editTitle : productionLabels.recordTitle;

  return (
    <>
      <FormPage
        title={pageTitle}
        backTo="/production"
        backLabel={productionLabels.backToProduction}
        footer={
          <PinnedSummaryFooter
            contentClassName="max-w-3xl px-0"
            total={
              <div className="flex flex-col items-end gap-0.5">
                <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  {productionLabels.costUnitLabel}
                  <CalcTrace
                    formula={productionLabels.costUnitFormula}
                    inputs={unitCostTraceInputs}
                  />
                </span>
                <span className="numeric-cell font-semibold text-foreground text-lg">
                  {outputUnitCostPreviewLabel}
                </span>
              </div>
            }
            warnings={
              displayError ? <p className="text-negative text-sm">{displayError}</p> : undefined
            }
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clearPersistentDraft(draftKey);
                    unsavedChangesGuard.markClean();
                    void navigate({ to: "/production" });
                  }}
                  disabled={disabled}
                >
                  {productionLabels.cancel}
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={disabled || (!recipeId && !outputItemId)}
                >
                  {isEditMode ? productionLabels.save : productionLabels.submit}
                </Button>
              </>
            }
          />
        }
      >
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
            <option value="">{productionLabels.recipeLessOption}</option>
            {recipes.map((recipe) => (
              <option key={recipe.id} value={recipe.id}>
                {recipe.name}
              </option>
            ))}
          </Select>
        </div>

        {!selectedRecipe ? (
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="prf-output-item">
              {productionLabels.fieldOutputItem}
            </label>
            <Select
              id="prf-output-item"
              value={outputItemId}
              onChange={(e) => setOutputItemId(e.target.value)}
              disabled={disabled}
            >
              <option value="" disabled>
                {productionLabels.outputItemPlaceholder}
              </option>
              {(itemsQuery.data?.items ?? [])
                .filter((item) => item.kind === "SEMI_FINISHED" || item.kind === "FINISHED")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </Select>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="linked-order-picker">
            {ordersLabels.orderPickerFieldLabel}
          </label>
          <OrderPicker
            value={customOrderId}
            onChange={(id) => setCustomOrderId(id)}
            disabled={disabled}
          />
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
            maxLength={PRODUCTION_RUN_NOTES_MAX_LENGTH}
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
            getItemUnit={(itemId) => itemsById.get(itemId)?.unit}
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
              <CalcTrace formula={productionLabels.costUnitFormula} inputs={unitCostTraceInputs} />
            </span>
            <span className="numeric-cell text-foreground text-sm">
              {outputUnitCostPreviewLabel}
            </span>
          </div>
        </div>
      </FormPage>
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
      {!isEditMode && createReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={createReplay.pendingConfirmation.impact}
          onConfirm={createReplay.confirm}
          onCancel={createReplay.cancel}
          confirmLoading={createReplay.isPending}
          title={productionLabels.impactCreateTitle}
          description={productionLabels.impactCreateDescription}
          confirmLabel={productionLabels.submit}
        />
      ) : null}
    </>
  );
}

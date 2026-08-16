import type {
  AssemblyDefinitionDto,
  ItemDto,
  QtyDisplayUnit,
  RecordAssemblyCommand,
  RecordAssemblyResult,
} from "@kokoro/shared";
import {
  defaultDisplayUnitFor,
  formatMoney,
  formatQty,
  nowIso,
  rateFromTotal,
  recordAssemblyCommandSchema,
  toBusinessDate,
  toCentavos,
  toMilliCentavosPerUnit,
  toMilliUnits,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, ChevronLeft, Minus } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { CalcTrace, type CalcTraceInput } from "@/components/common/CalcTrace";
import { PinnedSummaryFooter } from "@/components/common/PinnedSummaryFooter";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { parseLineQuantityToMilliUnits } from "@/components/line-editor/line-editor-quantity";
import { OrderPicker } from "@/components/orders/OrderPicker";
import { Button, buttonVariants } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useRecordAssembly } from "@/features/assemblies/api";
import { useAssemblyDefinitions } from "@/features/assembly-definitions/api";
import { useItemsQuery } from "@/features/catalog/api";
import { useStock } from "@/features/inventory/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { assembliesLabels } from "@/lib/i18n-assemblies";
import { catalogLabels } from "@/lib/i18n-catalog";
import { ordersLabels } from "@/lib/i18n-orders";

const routeApi = getRouteApi("/_authenticated/production/assemblies/new");

interface AssemblyLineValue extends LineEditorLine {
  lineKey: string;
  itemId: string | null;
  qty: string;
  unit: QtyDisplayUnit | null;
}

let nextLineKey = 0;

function newLineKey(): string {
  nextLineKey += 1;
  return `assembly-line-${nextLineKey}`;
}

function emptyLine(): AssemblyLineValue {
  return { lineKey: newLineKey(), itemId: null, qty: "", unit: null };
}

export function AssemblyRecordRoute() {
  const { sessionId } = routeApi.useSearch();
  const navigate = useNavigate();

  const [definitionId, setDefinitionId] = useState("");
  const [customOrderId, setCustomOrderId] = useState<string | null>(null);
  const [outputItemId, setOutputItemId] = useState<string | null>(null);
  const [plannedOutputQty, setPlannedOutputQty] = useState("");
  const [actualOutputQty, setActualOutputQty] = useState("");
  const [businessDate, setBusinessDate] = useState(toBusinessDate(nowIso()));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<AssemblyLineValue[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const lineAutoQtyRef = useRef(new Map<string, string>());
  const dirtyLineKeysRef = useRef(new Set<string>());

  const createMutation = useRecordAssembly();
  const createReplay = useReplayConfirmableMutation<RecordAssemblyCommand, RecordAssemblyResult>(
    (command) => createMutation.mutateAsync(command),
    {
      onSuccess: () => navigate({ to: "/production" }),
    },
  );

  const definitionsQuery = useAssemblyDefinitions({ isActive: true });
  const definitions = definitionsQuery.data?.assemblyDefinitions ?? [];
  const definitionsById = useMemo(() => {
    const map = new Map<string, AssemblyDefinitionDto>();
    for (const definition of definitions) map.set(definition.id, definition);
    return map;
  }, [definitions]);

  const itemsQuery = useItemsQuery({ isActive: true });
  const itemsById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  const stockQuery = useStock();
  const onHandByItemId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of stockQuery.data?.stock ?? []) {
      map.set(row.itemId, toMilliUnits(row.qtyOnHand));
    }
    return map;
  }, [stockQuery.data]);

  const selectedDefinition = definitionId ? (definitionsById.get(definitionId) ?? null) : null;
  const outputItem = outputItemId ? (itemsById.get(outputItemId) ?? null) : null;
  const disabled = createReplay.isPending;

  function handleDefinitionChange(nextDefinitionId: string) {
    setDefinitionId(nextDefinitionId);
    const definition = definitionsById.get(nextDefinitionId);
    if (!definition) {
      setOutputItemId(null);
      setPlannedOutputQty("");
      setActualOutputQty("");
      setLines([emptyLine()]);
      lineAutoQtyRef.current.clear();
      dirtyLineKeysRef.current.clear();
      return;
    }

    setOutputItemId(definition.outputItemId);
    setPlannedOutputQty(formatIntAsDecimalInput(definition.outputQty, 3));
    const nextLines =
      definition.lines.length > 0
        ? definition.lines.map(
            (line): AssemblyLineValue => ({
              lineKey: line.id,
              itemId: line.itemId,
              qty: formatIntAsDecimalInput(line.qty, 3),
              unit: null,
            }),
          )
        : [emptyLine()];
    setLines(nextLines);
    lineAutoQtyRef.current = new Map(nextLines.map((line) => [line.lineKey, line.qty]));
    dirtyLineKeysRef.current.clear();
  }

  function handleLinesChange(nextLines: AssemblyLineValue[]) {
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

  function renderLineExtra(line: AssemblyLineValue) {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    if (!item) return null;
    const qty = parseLineQuantityToMilliUnits(line.qty, line.unit, item.unit);
    if (qty === null || qty <= 0) {
      return (
        <span className="text-subtle-foreground text-xs">
          {assembliesLabels.lineContribution}: —
        </span>
      );
    }

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
        aria-label={assembliesLabels.lineStockSufficient}
        title={assembliesLabels.lineStockSufficient}
        className="inline-flex text-positive"
      >
        <Check className="size-4" aria-hidden="true" />
      </span>
    ) : (
      <span
        role="img"
        aria-label={assembliesLabels.lineStockInsufficient}
        title={assembliesLabels.lineStockInsufficient}
        className="inline-flex text-warning"
      >
        <AlertTriangle className="size-4" aria-hidden="true" />
      </span>
    );

    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {assembliesLabels.lineContribution}:{" "}
          <span className="numeric-cell font-medium text-foreground">
            {formatMoney(contribution)}
          </span>
        </span>
        {stockIndicator}
      </div>
    );
  }

  const directCostPreview = useMemo(() => {
    let sum = toCentavos(0);
    for (const line of lines) {
      const item = line.itemId ? itemsById.get(line.itemId) : undefined;
      const qty = item ? parseLineQuantityToMilliUnits(line.qty, line.unit, item.unit) : null;
      if (!item || qty === null || qty <= 0) continue;
      sum = toCentavos(sum + totalCentavos(toMilliCentavosPerUnit(item.wacMc), toMilliUnits(qty)));
    }
    return sum;
  }, [itemsById, lines]);

  const actualOutputQtyPreview = parseDecimalToInt(actualOutputQty, 3);
  const outputUnitCostPreviewMc =
    actualOutputQtyPreview !== null && actualOutputQtyPreview > 0
      ? rateFromTotal(directCostPreview, toMilliUnits(actualOutputQtyPreview))
      : null;
  const outputUnitCostPreviewLabel =
    outputUnitCostPreviewMc !== null
      ? `${formatMoney(totalCentavos(outputUnitCostPreviewMc, WHOLE_UNIT_MILLI_UNITS))} / u.`
      : "—";

  const directCostTraceInputs: CalcTraceInput[] = lines.flatMap((line) => {
    const item = line.itemId ? itemsById.get(line.itemId) : undefined;
    const qty = item ? parseLineQuantityToMilliUnits(line.qty, line.unit, item.unit) : null;
    if (!item || qty === null || qty <= 0) return [];
    return [
      {
        label: item.name,
        value: formatMoney(totalCentavos(toMilliCentavosPerUnit(item.wacMc), toMilliUnits(qty))),
      },
    ];
  });
  const unitCostTraceInputs: CalcTraceInput[] = [
    { label: assembliesLabels.costDirectLabel, value: formatMoney(directCostPreview) },
    {
      label: assembliesLabels.fieldActualOutputQty,
      value: actualOutputQtyPreview !== null ? formatQty(actualOutputQtyPreview, "UNIT") : "—",
    },
  ];

  function handleSubmit() {
    setError(null);
    if (!outputItemId) {
      setError(assembliesLabels.errors.outputItemRequired);
      return;
    }

    const actualOutputQtyValue = parseDecimalToInt(actualOutputQty, 3);
    if (actualOutputQtyValue === null || actualOutputQtyValue <= 0) {
      setError(assembliesLabels.errors.outputQtyInvalid);
      return;
    }

    let plannedOutputQtyValue: number | undefined;
    if (plannedOutputQty.trim() !== "") {
      const parsedPlannedOutputQty = parseDecimalToInt(plannedOutputQty, 3);
      if (parsedPlannedOutputQty === null || parsedPlannedOutputQty <= 0) {
        setError(assembliesLabels.errors.generic);
        return;
      }
      plannedOutputQtyValue = parsedPlannedOutputQty;
    }

    const parsedLines: { itemId: string; qty: number }[] = [];
    for (const line of lines) {
      const item = line.itemId ? itemsById.get(line.itemId) : undefined;
      const qty = item ? parseLineQuantityToMilliUnits(line.qty, line.unit, item.unit) : null;
      if (!line.itemId || qty === null || qty <= 0) {
        setError(assembliesLabels.errors.invalidLine);
        return;
      }
      parsedLines.push({ itemId: line.itemId, qty });
    }

    const parsed = recordAssemblyCommandSchema.safeParse({
      definitionId: definitionId || undefined,
      customOrderId: customOrderId ?? undefined,
      sessionId,
      outputItemId,
      plannedOutputQty: plannedOutputQtyValue,
      actualOutputQty: actualOutputQtyValue,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      occurredAt: nowIso(),
      businessDate,
      lines: parsedLines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? assembliesLabels.errors.generic);
      return;
    }

    createReplay.execute(parsed.data);
  }

  const displayError =
    error ??
    (createReplay.error instanceof ApiError
      ? createReplay.error.message
      : createReplay.error
        ? assembliesLabels.errors.generic
        : null);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <header className="mx-auto flex w-full max-w-3xl flex-col gap-2 border-border border-b pb-4">
          <Link
            to="/production"
            className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {assembliesLabels.backToProduction}
          </Link>
          <h1 className="font-semibold text-2xl text-foreground">{assembliesLabels.recordTitle}</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-5 text-sm">
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="assembly-definition">
                {assembliesLabels.fieldDefinition}
              </label>
              <Select
                id="assembly-definition"
                value={definitionId}
                onChange={(event) => handleDefinitionChange(event.target.value)}
                disabled={disabled}
              >
                <option value="">{assembliesLabels.definitionPlaceholder}</option>
                {definitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground">
                {assembliesLabels.fieldOutputItem}
              </span>
              {selectedDefinition ? (
                <div className="rounded-md border border-border bg-muted px-3 py-2 text-foreground">
                  {outputItem?.name ?? selectedDefinition.outputItemId}
                </div>
              ) : (
                <ItemPicker
                  value={outputItemId}
                  onChange={setOutputItemId}
                  kindFilter="FINISHED"
                  placeholder={assembliesLabels.outputItemPlaceholder}
                  disabled={disabled}
                />
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground" htmlFor="assembly-date">
                  {assembliesLabels.fieldDate}
                </label>
                <Input
                  id="assembly-date"
                  type="date"
                  value={businessDate}
                  onChange={(event) => setBusinessDate(event.target.value)}
                  disabled={disabled}
                />
              </div>

              {selectedDefinition ? (
                <div className="flex flex-col gap-1.5">
                  <label className="font-medium text-foreground" htmlFor="assembly-planned-output">
                    {assembliesLabels.fieldPlannedOutputQty}
                  </label>
                  <Input
                    id="assembly-planned-output"
                    inputMode="decimal"
                    value={plannedOutputQty}
                    onChange={(event) => setPlannedOutputQty(event.target.value)}
                    disabled={disabled}
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground" htmlFor="assembly-actual-output">
                  {assembliesLabels.fieldActualOutputQty}
                </label>
                <Input
                  id="assembly-actual-output"
                  inputMode="decimal"
                  placeholder="0"
                  value={actualOutputQty}
                  onChange={(event) => setActualOutputQty(event.target.value)}
                  disabled={disabled}
                />
                {outputItem ? (
                  <span className="text-muted-foreground text-xs">u. de {outputItem.name}</span>
                ) : null}
              </div>
            </div>

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

            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground">{assembliesLabels.linesTitle}</span>
              <LineEditor
                lines={lines}
                onChange={handleLinesChange}
                createLine={emptyLine}
                disabled={disabled}
                showAmount={false}
                itemKindFilter={["SEMI_FINISHED", "FINISHED", "PACKAGING"]}
                getItemUnit={(itemId) => itemsById.get(itemId)?.unit}
                unitSelector={{
                  getValue: (line) => line.unit,
                  onChange: (index, unit) =>
                    setLines((currentLines) =>
                      currentLines.map((line, lineIndex) =>
                        lineIndex === index ? { ...line, unit } : line,
                      ),
                    ),
                  label: assembliesLabels.unit,
                }}
                onItemChange={(_index, itemId) => {
                  const item = itemId ? itemsById.get(itemId) : undefined;
                  return { qty: "", unit: item ? defaultDisplayUnitFor(item.unit) : null };
                }}
                labels={{
                  item: assembliesLabels.lineItem,
                  qty: assembliesLabels.lineQty,
                  addLine: assembliesLabels.addLine,
                  removeLine: assembliesLabels.removeLine,
                  qtyPlaceholder: "0",
                }}
                renderExtraColumns={renderLineExtra}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="assembly-notes">
                {assembliesLabels.fieldNotes}
              </label>
              <Input
                id="assembly-notes"
                placeholder={assembliesLabels.notesPlaceholder}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        <PinnedSummaryFooter
          total={
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-4 py-2">
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  {assembliesLabels.costUnitLabel}
                  <CalcTrace
                    formula={assembliesLabels.costUnitFormula}
                    inputs={unitCostTraceInputs}
                  />
                </span>
                <span className="numeric-cell font-semibold text-foreground text-lg">
                  {outputUnitCostPreviewLabel}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  {assembliesLabels.costDirectLabel}
                  <CalcTrace
                    formula={assembliesLabels.costDirectFormula}
                    inputs={directCostTraceInputs}
                  />
                </span>
                <span className="numeric-cell text-foreground text-sm">
                  {formatMoney(directCostPreview)}
                </span>
              </div>
            </div>
          }
          warnings={
            displayError ? <p className="text-negative text-sm">{displayError}</p> : undefined
          }
          actions={
            <>
              <Link to="/production" className={buttonVariants({ variant: "outline" })}>
                {assembliesLabels.cancel}
              </Link>
              <Button type="button" onClick={handleSubmit} disabled={disabled}>
                {assembliesLabels.submit}
              </Button>
            </>
          }
        />
      </div>

      {createReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={createReplay.pendingConfirmation.impact}
          onConfirm={createReplay.confirm}
          onCancel={createReplay.cancel}
          confirmLoading={createReplay.isPending}
          title={assembliesLabels.impactCreateTitle}
          description={assembliesLabels.impactCreateDescription}
          confirmLabel={assembliesLabels.submit}
        />
      ) : null}
    </>
  );
}

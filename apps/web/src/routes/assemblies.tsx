import type {
  AssemblyDefinitionDto,
  ItemDto,
  QtyDisplayUnit,
  RecordAssemblyCommand,
  RecordAssemblyResult,
  UpdateAssemblyCommand,
  UpdateAssemblyResult,
} from "@kokoro/shared";
import {
  defaultDisplayUnitFor,
  displayUnitLabel,
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
  updateAssemblyCommandSchema,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, Minus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { CalcTrace, type CalcTraceInput } from "@/components/common/CalcTrace";
import { FormPage } from "@/components/common/FormPage";
import { PinnedSummaryFooter } from "@/components/common/PinnedSummaryFooter";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { parseLineQuantityToMilliUnits } from "@/components/line-editor/line-editor-quantity";
import { OrderPicker } from "@/components/orders/OrderPicker";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { InfoTooltip } from "@/components/ui/tooltip";
import { useAssembly, useRecordAssembly, useUpdateAssembly } from "@/features/assemblies/api";
import { useAssemblyDefinition, useAssemblyDefinitions } from "@/features/assembly-definitions/api";
import { useItemsQuery } from "@/features/catalog/api";
import { useStock } from "@/features/inventory/api";
import {
  clearPersistentDraft,
  readPersistentDraft,
  writePersistentDraft,
} from "@/hooks/usePersistentDraft";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { hasUnsavedChanges, useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { assembliesLabels } from "@/lib/i18n-assemblies";
import { catalogLabels } from "@/lib/i18n-catalog";
import { ordersLabels } from "@/lib/i18n-orders";

const recordRouteApi = getRouteApi("/_authenticated/packing/new");
const editRouteApi = getRouteApi("/_authenticated/packing/$assemblyId/edit");

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
  const { sessionId } = recordRouteApi.useSearch();
  return <AssemblyForm sessionId={sessionId} />;
}

export function AssemblyEditRoute() {
  const { assemblyId } = editRouteApi.useParams();
  return <AssemblyForm assemblyId={assemblyId} />;
}

interface AssemblyFormState {
  definitionId: string;
  customOrderId: string | null;
  outputItemId: string | null;
  plannedOutputQty: string;
  actualOutputQty: string;
  businessDate: string;
  notes: string;
  lines: AssemblyLineValue[];
}

function AssemblyForm({ sessionId, assemblyId }: { sessionId?: string; assemblyId?: string }) {
  const navigate = useNavigate();
  const isEditMode = Boolean(assemblyId);
  const draftKey = assemblyId ? `assembly:${assemblyId}` : "assembly:new";

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
  const initialFormStateRef = useRef<AssemblyFormState | null>(null);
  const initializedRef = useRef(false);

  const currentFormState: AssemblyFormState = {
    definitionId,
    customOrderId,
    outputItemId,
    plannedOutputQty,
    actualOutputQty,
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

  const createMutation = useRecordAssembly();
  const updateMutation = useUpdateAssembly(assemblyId ?? "");
  const assemblyQuery = useAssembly(assemblyId);
  const assembly = assemblyQuery.data?.assembly;
  const createReplay = useReplayConfirmableMutation<RecordAssemblyCommand, RecordAssemblyResult>(
    (command) => createMutation.mutateAsync(command),
    {
      onSuccess: () => {
        clearPersistentDraft(draftKey);
        unsavedChangesGuard.markClean();
        void navigate({ to: "/packing" });
      },
    },
  );
  const editReplay = useReplayConfirmableMutation<UpdateAssemblyCommand, UpdateAssemblyResult>(
    (command) => updateMutation.mutateAsync(command),
    {
      onSuccess: () => {
        clearPersistentDraft(draftKey);
        unsavedChangesGuard.markClean();
        void navigate({ to: "/packing" });
      },
    },
  );

  const definitionsQuery = useAssemblyDefinitions({ isActive: true });
  const editingDefinitionQuery = useAssemblyDefinition(
    isEditMode ? (assembly?.definitionId ?? undefined) : undefined,
  );
  const definitions = useMemo(() => {
    const activeDefinitions = definitionsQuery.data?.assemblyDefinitions ?? [];
    const editingDefinition = editingDefinitionQuery.data?.assemblyDefinition;
    if (!editingDefinition || editingDefinition.isActive) return activeDefinitions;
    return [...activeDefinitions, editingDefinition];
  }, [definitionsQuery.data, editingDefinitionQuery.data]);
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
  const disabled = createReplay.isPending || editReplay.isPending;

  // Runs once per mount (route-owned state, KOK-141) — waits for the assembly to load before
  // seeding edit mode, then prefers a restored draft over the server DTO. Guarding on
  // `initializedRef` (rather than the old unconditional `[assembly]` effect) also stops a
  // background refetch of the SAME assembly from clobbering in-progress edits, mirroring
  // SaleForm/PurchaseForm's identical precedent.
  useEffect(() => {
    if (initializedRef.current) return;
    if (isEditMode && !assembly) return;

    const savedDraft = readPersistentDraft<AssemblyFormState>(draftKey);
    const initialFormState: AssemblyFormState = savedDraft
      ? savedDraft
      : assembly
        ? {
            definitionId: assembly.definitionId ?? "",
            customOrderId: assembly.customOrderId,
            outputItemId: assembly.outputItemId,
            plannedOutputQty:
              assembly.plannedOutputQty === null
                ? ""
                : formatIntAsDecimalInput(assembly.plannedOutputQty, 3),
            actualOutputQty: formatIntAsDecimalInput(assembly.actualOutputQty, 3),
            businessDate: assembly.businessDate,
            notes: assembly.notes ?? "",
            lines: assembly.lines.map((line) => ({
              lineKey: line.id,
              itemId: line.itemId,
              qty: formatIntAsDecimalInput(line.qty, 3),
              unit: null,
            })),
          }
        : {
            definitionId: "",
            customOrderId: null,
            outputItemId: null,
            plannedOutputQty: "",
            actualOutputQty: "",
            businessDate: toBusinessDate(nowIso()),
            notes: "",
            lines: [emptyLine()],
          };

    setDefinitionId(initialFormState.definitionId);
    setCustomOrderId(initialFormState.customOrderId);
    setOutputItemId(initialFormState.outputItemId);
    setPlannedOutputQty(initialFormState.plannedOutputQty);
    setActualOutputQty(initialFormState.actualOutputQty);
    setBusinessDate(initialFormState.businessDate);
    setNotes(initialFormState.notes);
    setLines(initialFormState.lines);
    initialFormStateRef.current = initialFormState;
    initializedRef.current = true;
  }, [assembly, draftKey, isEditMode]);

  useEffect(() => {
    if (!initializedRef.current) return;
    writePersistentDraft<AssemblyFormState>(draftKey, {
      definitionId,
      customOrderId,
      outputItemId,
      plannedOutputQty,
      actualOutputQty,
      businessDate,
      notes,
      lines,
    });
  }, [
    actualOutputQty,
    businessDate,
    customOrderId,
    definitionId,
    draftKey,
    lines,
    notes,
    outputItemId,
    plannedOutputQty,
  ]);

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
    const plannedOutputQtyValue = formatIntAsDecimalInput(definition.outputQty, 3);
    setPlannedOutputQty(plannedOutputQtyValue);
    setActualOutputQty(plannedOutputQtyValue);
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
      return <span className="text-subtle-foreground text-xs">—</span>;
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
      <span className="inline-flex items-center gap-1 font-medium text-warning">
        <AlertTriangle className="size-4" aria-hidden="true" />
        {assembliesLabels.lineStockInsufficient}
      </span>
    );

    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="numeric-cell font-medium text-foreground">
          {formatMoney(contribution)}
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

    const command = {
      definitionId: definitionId || undefined,
      customOrderId,
      sessionId: assembly?.sessionId ?? sessionId,
      outputItemId,
      plannedOutputQty: plannedOutputQtyValue,
      actualOutputQty: actualOutputQtyValue,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      occurredAt: assembly?.occurredAt ?? nowIso(),
      businessDate,
      lines: parsedLines,
    };
    const parsed = (
      isEditMode ? updateAssemblyCommandSchema : recordAssemblyCommandSchema
    ).safeParse(command);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? assembliesLabels.errors.generic);
      return;
    }

    if (isEditMode) editReplay.execute(parsed.data);
    else createReplay.execute(parsed.data);
  }

  const mutationError = isEditMode ? editReplay.error : createReplay.error;
  const displayError =
    error ??
    (mutationError instanceof ApiError
      ? mutationError.message
      : mutationError
        ? assembliesLabels.errors.generic
        : null);

  const pageTitle = isEditMode ? assembliesLabels.editTitle : assembliesLabels.recordTitle;

  return (
    <>
      <FormPage
        title={pageTitle}
        backTo="/packing"
        backLabel={assembliesLabels.backToPacking}
        footer={
          <PinnedSummaryFooter
            contentClassName="max-w-3xl px-0"
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clearPersistentDraft(draftKey);
                    unsavedChangesGuard.markClean();
                    void navigate({ to: "/packing" });
                  }}
                  disabled={disabled}
                >
                  {assembliesLabels.cancel}
                </Button>
                <Button type="button" onClick={handleSubmit} disabled={disabled}>
                  {isEditMode ? assembliesLabels.save : assembliesLabels.submit}
                </Button>
              </>
            }
          />
        }
      >
        {definitionsQuery.isLoading ? (
          <p className="text-muted-foreground text-sm">{assembliesLabels.loading}</p>
        ) : definitions.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <label className="font-medium text-foreground" htmlFor="assembly-definition">
                {assembliesLabels.fieldDefinition}
              </label>
              <InfoTooltip
                content={assembliesLabels.definitionTooltip}
                label={assembliesLabels.definitionTooltipLabel}
              />
            </div>
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
        ) : (
          <p className="text-muted-foreground text-sm">
            {assembliesLabels.definitionEmpty}{" "}
            <Link
              to="/packing/definitions"
              className="font-medium text-foreground underline underline-offset-4"
            >
              {assembliesLabels.definitionCreate}
            </Link>
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-foreground">{assembliesLabels.fieldOutputItem}</span>
          {selectedDefinition ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2 text-foreground">
              <span className="min-w-0 truncate">
                {outputItem?.name ?? selectedDefinition.outputItemId}
              </span>
              {outputItem ? (
                <span className="shrink-0 text-muted-foreground text-xs">
                  {assembliesLabels.outputItemUnit(displayUnitLabel(outputItem.unit))}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <ItemPicker
                value={outputItemId}
                onChange={setOutputItemId}
                eligibility={{ kind: "FINISHED", unit: "UNIT" }}
                emptyMessage={assembliesLabels.outputItemEmpty}
                placeholder={assembliesLabels.outputItemPlaceholder}
                disabled={disabled}
              />
              {outputItem ? (
                <span className="text-muted-foreground text-xs">
                  {assembliesLabels.outputItemUnit(displayUnitLabel(outputItem.unit))}
                </span>
              ) : null}
            </div>
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

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="font-medium text-foreground" htmlFor="assembly-actual-output">
                {assembliesLabels.fieldActualOutputQty}
              </label>
              {plannedOutputQty.trim() !== "" ? (
                <span className="text-muted-foreground text-xs">
                  {assembliesLabels.fieldPlannedOutputQty}: {plannedOutputQty}
                </span>
              ) : null}
            </div>
            <Input
              id="assembly-actual-output"
              inputMode="decimal"
              placeholder="0"
              value={actualOutputQty}
              onChange={(event) => setActualOutputQty(event.target.value)}
              disabled={disabled}
            />
            {outputItem ? (
              <span className="text-muted-foreground text-xs">
                {assembliesLabels.actualOutputUnit(
                  displayUnitLabel(outputItem.unit),
                  outputItem.name,
                )}
              </span>
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
      </FormPage>

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
      {editReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={editReplay.pendingConfirmation.impact}
          onConfirm={editReplay.confirm}
          onCancel={editReplay.cancel}
          confirmLoading={editReplay.isPending}
          title={assembliesLabels.impactEditTitle}
          description={assembliesLabels.impactEditDescription}
          confirmLabel={assembliesLabels.save}
        />
      ) : null}
    </>
  );
}

import type { AssemblyDefinitionDto, ItemDto, QtyDisplayUnit } from "@kokoro/shared";
import {
  defaultDisplayUnitFor,
  formatMoney,
  formatQty,
  recordAssemblyDefinitionCommandSchema,
  toCentavos,
} from "@kokoro/shared";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { parseLineQuantityToMilliUnits } from "@/components/line-editor/line-editor-quantity";
import { MarginBadge } from "@/components/pricing/MarginBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  useAssemblyDefinition,
  useAssemblyDefinitions,
  useRecordAssemblyDefinition,
  useSetAssemblyDefinitionActive,
  useUpdateAssemblyDefinition,
} from "@/features/assembly-definitions/api";
import { useItemsQuery } from "@/features/catalog/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { assemblyDefinitionsLabels } from "@/lib/i18n-assemblies";

interface DefinitionLineValue extends LineEditorLine {
  itemId: string | null;
  qty: string;
  unit: QtyDisplayUnit | null;
}

function emptyLine(): DefinitionLineValue {
  return { itemId: null, qty: "", unit: null };
}

export function PackingDefinitionsRoute() {
  const definitionsQuery = useAssemblyDefinitions();
  const itemsQuery = useItemsQuery();
  const [formOpen, setFormOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const itemById = useMemo(
    () => new Map((itemsQuery.data?.items ?? []).map((item) => [item.id, item])),
    [itemsQuery.data],
  );
  const columns: EventTableColumn<AssemblyDefinitionDto>[] = [
    {
      id: "name",
      header: assemblyDefinitionsLabels.columnName,
      isRowIdentifier: true,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {row.isDefault ? <Badge>{assemblyDefinitionsLabels.badgeDefault}</Badge> : null}
        </div>
      ),
      sortable: true,
      sortValue: (row) => row.name,
    },
    {
      id: "output",
      header: assemblyDefinitionsLabels.columnOutput,
      cell: (row) => itemById.get(row.outputItemId)?.name ?? row.outputItemId,
      sortable: true,
      sortValue: (row) => itemById.get(row.outputItemId)?.name ?? row.outputItemId,
    },
    {
      id: "qty",
      header: assemblyDefinitionsLabels.columnQty,
      numeric: true,
      cell: (row) => {
        const item = itemById.get(row.outputItemId);
        return item ? formatQty(row.outputQty, item.unit) : row.outputQty;
      },
      sortable: true,
      sortValue: (row) => row.outputQty,
    },
    {
      id: "cost",
      header: assemblyDefinitionsLabels.columnCost,
      numeric: true,
      cell: (row) => formatMoney(toCentavos(row.costReplacement.costPerOutputUnit)),
      sortable: true,
      sortValue: (row) => row.costReplacement.costPerOutputUnit,
    },
    {
      id: "status",
      header: assemblyDefinitionsLabels.columnStatus,
      cell: (row) =>
        row.isActive ? (
          <Badge variant="outline">{assemblyDefinitionsLabels.badgeActive}</Badge>
        ) : (
          <Badge variant="muted">{assemblyDefinitionsLabels.badgeInactive}</Badge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/packing"
        className="inline-flex w-fit items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {assemblyDefinitionsLabels.backToPacking}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl">{assemblyDefinitionsLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{assemblyDefinitionsLabels.subtitle}</p>
        </div>
        <Button type="button" onClick={() => setFormOpen(true)}>
          {assemblyDefinitionsLabels.actionCreate}
        </Button>
      </div>
      <EventTable
        columns={columns}
        rows={definitionsQuery.data?.assemblyDefinitions ?? []}
        getRowId={(row) => row.id}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyMessage={assemblyDefinitionsLabels.noDefinitions}
        loading={definitionsQuery.isLoading}
        loadingMessage={assemblyDefinitionsLabels.loading}
      />
      <AssemblyDefinitionForm open={formOpen} onOpenChange={setFormOpen} itemById={itemById} />
      <AssemblyDefinitionDetailDrawer
        definitionId={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        itemById={itemById}
      />
    </div>
  );
}

interface AssemblyDefinitionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemById: ReadonlyMap<string, ItemDto>;
  definition?: AssemblyDefinitionDto;
  minMarginPct?: number;
}

function AssemblyDefinitionForm({
  open,
  onOpenChange,
  itemById,
  definition,
  minMarginPct = 0,
}: AssemblyDefinitionFormProps) {
  const [name, setName] = useState("");
  const [outputItemId, setOutputItemId] = useState<string | null>(null);
  const [outputQty, setOutputQty] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DefinitionLineValue[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const createMutation = useRecordAssemblyDefinition();
  const updateMutation = useUpdateAssemblyDefinition(definition?.id ?? "");
  const isEdit = Boolean(definition);

  useEffect(() => {
    if (!open) return;
    setName(definition?.name ?? "");
    setOutputItemId(definition?.outputItemId ?? null);
    setOutputQty(definition ? formatIntAsDecimalInput(definition.outputQty, 3) : "");
    setIsDefault(definition?.isDefault ?? false);
    setNotes(definition?.notes ?? "");
    setLines(
      definition
        ? definition.lines.map((line) => ({
            itemId: line.itemId,
            qty: formatIntAsDecimalInput(line.qty, 3),
            unit: defaultDisplayUnitFor(itemById.get(line.itemId)?.unit ?? "UNIT"),
          }))
        : [emptyLine()],
    );
    setError(null);
  }, [definition, itemById, open]);

  const disabled = createMutation.isPending || updateMutation.isPending;
  function handleSubmit(): void {
    setError(null);
    if (!outputItemId) {
      setError(assemblyDefinitionsLabels.errors.outputRequired);
      return;
    }
    const parsedOutputQty = parseDecimalToInt(outputQty, 3);
    if (parsedOutputQty === null || parsedOutputQty <= 0) {
      setError(assemblyDefinitionsLabels.errors.outputQtyInvalid);
      return;
    }
    const parsedLines: { itemId: string; qty: number }[] = [];
    for (const line of lines) {
      const item = line.itemId ? itemById.get(line.itemId) : undefined;
      const qty = item ? parseLineQuantityToMilliUnits(line.qty, line.unit, item.unit) : null;
      if (!line.itemId || qty === null || qty <= 0) {
        setError(assemblyDefinitionsLabels.errors.invalidLine);
        return;
      }
      parsedLines.push({ itemId: line.itemId, qty });
    }
    const parsed = recordAssemblyDefinitionCommandSchema.safeParse({
      name,
      outputItemId,
      outputQty: parsedOutputQty,
      isDefault,
      notes: notes.trim() || null,
      lines: parsedLines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? assemblyDefinitionsLabels.errors.generic);
      return;
    }
    const mutation = isEdit ? updateMutation : createMutation;
    mutation.mutate(parsed.data, {
      onSuccess: () => onOpenChange(false),
      onError: (mutationError) =>
        setError(
          mutationError instanceof ApiError
            ? mutationError.message
            : assemblyDefinitionsLabels.errors.generic,
        ),
    });
  }

  const dialogTitle = isEdit
    ? assemblyDefinitionsLabels.editTitle
    : assemblyDefinitionsLabels.createTitle;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={dialogTitle} className="max-w-3xl">
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-semibold text-lg">{dialogTitle}</h2>
      </div>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <Field label={assemblyDefinitionsLabels.fieldName} htmlFor="definition-name">
          <Input
            id="definition-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={assemblyDefinitionsLabels.namePlaceholder}
            disabled={disabled}
          />
        </Field>
        <Field label={assemblyDefinitionsLabels.fieldOutput}>
          <ItemPicker
            value={outputItemId}
            onChange={setOutputItemId}
            eligibility={{ kind: "FINISHED", unit: "UNIT" }}
            emptyMessage={assemblyDefinitionsLabels.outputItemEmpty}
            placeholder={assemblyDefinitionsLabels.outputPlaceholder}
            disabled={disabled}
          />
        </Field>
        <Field label={assemblyDefinitionsLabels.fieldOutputQty} htmlFor="definition-output-qty">
          <Input
            id="definition-output-qty"
            inputMode="decimal"
            value={outputQty}
            onChange={(event) => setOutputQty(event.target.value)}
            disabled={disabled}
          />
        </Field>
        <div className="flex items-center gap-2">
          <Switch
            checked={isDefault}
            onCheckedChange={setIsDefault}
            disabled={disabled}
            aria-label={assemblyDefinitionsLabels.fieldDefault}
          />
          <span>{assemblyDefinitionsLabels.fieldDefault}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-medium">{assemblyDefinitionsLabels.linesTitle}</span>
          <LineEditor
            lines={lines}
            onChange={setLines}
            createLine={emptyLine}
            showAmount={false}
            itemKindFilter={["SEMI_FINISHED", "FINISHED", "PACKAGING"]}
            getItemUnit={(itemId) => itemById.get(itemId)?.unit}
            unitSelector={{
              getValue: (line) => line.unit,
              onChange: (index, unit) =>
                setLines((current) =>
                  current.map((line, lineIndex) =>
                    lineIndex === index ? { ...line, unit } : line,
                  ),
                ),
              label: assemblyDefinitionsLabels.unit,
            }}
            onItemChange={(_index, itemId) => {
              const item = itemId ? itemById.get(itemId) : undefined;
              return { qty: "", unit: item ? defaultDisplayUnitFor(item.unit) : null };
            }}
            labels={{
              item: assemblyDefinitionsLabels.lineItem,
              qty: assemblyDefinitionsLabels.lineQty,
              addLine: assemblyDefinitionsLabels.addLine,
              removeLine: assemblyDefinitionsLabels.removeLine,
            }}
            disabled={disabled}
          />
        </div>
        <Field label={assemblyDefinitionsLabels.fieldNotes} htmlFor="definition-notes">
          <Input
            id="definition-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={assemblyDefinitionsLabels.notesPlaceholder}
            disabled={disabled}
          />
        </Field>
        {definition ? (
          <DefinitionCostPanel definition={definition} minMarginPct={minMarginPct} />
        ) : null}
        {error ? <p className="text-negative">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
        >
          {assemblyDefinitionsLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled}>
          {isEdit ? assemblyDefinitionsLabels.save : assemblyDefinitionsLabels.create}
        </Button>
      </div>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function DefinitionCostPanel({
  definition,
  minMarginPct,
}: {
  definition: AssemblyDefinitionDto;
  minMarginPct: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted px-4 py-3">
      <span className="font-medium">{assemblyDefinitionsLabels.costTitle}</span>
      <CostRow
        label={assemblyDefinitionsLabels.costWac}
        value={formatMoney(toCentavos(definition.costWac.costPerOutputUnit))}
      />
      <CostRow
        label={assemblyDefinitionsLabels.costReplacement}
        value={formatMoney(toCentavos(definition.costReplacement.costPerOutputUnit))}
        strong
      />
      {definition.costReplacement.margin ? (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">{assemblyDefinitionsLabels.margin}</span>
          <MarginBadge
            pctBasisPoints={definition.costReplacement.margin.pctBasisPoints}
            minMarginPct={minMarginPct}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{assemblyDefinitionsLabels.noSalePrice}</p>
      )}
    </div>
  );
}

function CostRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={strong ? "numeric-cell font-semibold" : "numeric-cell"}>{value}</span>
    </div>
  );
}

function AssemblyDefinitionDetailDrawer({
  definitionId,
  open,
  onOpenChange,
  itemById,
}: {
  definitionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemById: ReadonlyMap<string, ItemDto>;
}) {
  const query = useAssemblyDefinition(definitionId ?? undefined);
  const setActive = useSetAssemblyDefinitionActive();
  const [editOpen, setEditOpen] = useState(false);
  if (!definitionId) return null;
  const definition = query.data?.assemblyDefinition;
  const settings = query.data?.settings;
  const outputItem = definition ? itemById.get(definition.outputItemId) : undefined;
  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={definition?.name ?? assemblyDefinitionsLabels.detailTitle}
        subtitle={outputItem?.name}
        entityType="assembly_definition"
        entityId={definition?.id}
      >
        {!definition ? (
          <p className="text-muted-foreground text-sm">{assemblyDefinitionsLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={definition.isActive}
                  onCheckedChange={(isActive) => setActive.mutate({ id: definition.id, isActive })}
                  disabled={setActive.isPending}
                  aria-label={
                    definition.isActive
                      ? assemblyDefinitionsLabels.deactivate
                      : assemblyDefinitionsLabels.activate
                  }
                />
                <span className="text-muted-foreground text-xs">
                  {definition.isActive
                    ? assemblyDefinitionsLabels.badgeActive
                    : assemblyDefinitionsLabels.badgeInactive}
                </span>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                {assemblyDefinitionsLabels.edit}
              </Button>
            </div>
            <div className="rounded-md bg-muted px-3 py-2.5">
              <CostRow
                label={assemblyDefinitionsLabels.columnOutput}
                value={outputItem?.name ?? definition.outputItemId}
              />
              <CostRow
                label={assemblyDefinitionsLabels.columnQty}
                value={
                  outputItem
                    ? formatQty(definition.outputQty, outputItem.unit)
                    : String(definition.outputQty)
                }
              />
            </div>
            <DefinitionCostPanel
              definition={definition}
              minMarginPct={settings?.minMarginPct ?? 0}
            />
            <div className="flex flex-col gap-2">
              <span className="font-medium">{assemblyDefinitionsLabels.linesTitle}</span>
              {definition.lines.map((line) => {
                const item = itemById.get(line.itemId);
                return (
                  <div
                    key={line.id}
                    className="flex justify-between rounded-md border border-border px-3 py-2"
                  >
                    <span>{item?.name ?? line.itemId}</span>
                    <span className="numeric-cell text-muted-foreground">
                      {item ? formatQty(line.qty, item.unit) : line.qty}
                    </span>
                  </div>
                );
              })}
            </div>
            <div>
              <span className="font-medium">{assemblyDefinitionsLabels.fieldNotes}</span>
              <p className="text-muted-foreground">
                {definition.notes ?? assemblyDefinitionsLabels.noNotes}
              </p>
            </div>
          </div>
        )}
      </DetailDrawer>
      {definition ? (
        <AssemblyDefinitionForm
          open={editOpen}
          onOpenChange={setEditOpen}
          itemById={itemById}
          definition={definition}
          minMarginPct={settings?.minMarginPct ?? 0}
        />
      ) : null}
    </>
  );
}

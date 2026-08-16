// Dialog for UC-09 "recordStockExit" (Doc 03 §3, Doc 07 SC-08 Salidas tab). Much simpler than
// PurchaseForm: a single item/qty pair, a closed reason enum, no money field at all —
// `unitCostSnapshot` is computed server-side from the item's current WAC (C-6 "invisible cost";
// see packages/shared/src/exits.ts's header comment), never entered here. No session picker for
// the same reason as PurchaseForm.tsx: Sessions (KOK-027) doesn't exist yet, so the schema's
// optional `sessionId` is simply never set from this form. Validated with the exact same
// `recordStockExitCommandSchema` the API route parses with (D-4).
//
// KOK-024 Phase G adds edit mode: pass `exit` (the `StockExitDto` being edited) and this same
// form submits via `updateStockExitCommandSchema` (PATCH, full-replacement semantics per that
// schema's own header comment) through `useUpdateStockExit` wrapped in
// `useReplayConfirmableMutation` (the shared R-5 "backdated replay" confirmation dance — see that
// hook's file header). KOK-065 wraps create mode (`exit` absent) the same way: a genuinely
// backdated new exit trips the same INV-11 gate `recordStockExit` already enforces, and needs the
// identical confirm-and-retry path rather than a dead-end error string.

import type {
  ListAssemblyDefinitionsResult,
  RecordStockExitCommand,
  RecordStockExitResult,
  StockExitDto,
  Unit,
} from "@kokoro/shared";
import {
  nowIso,
  recordStockExitCommandSchema,
  STOCK_EXIT_REASONS,
  type StockExitReason,
  toBusinessDate,
  updateStockExitCommandSchema,
} from "@kokoro/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { LineEditor, type LineEditorLine } from "@/components/line-editor/LineEditor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useItemQuery, useItemsQuery } from "@/features/catalog/api";
import { useRecordStockExit, useUpdateStockExit } from "@/features/inventory/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError, api } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { inventoryLabels } from "@/lib/i18n-inventory";

export interface ExitFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When present, the form edits this exit instead of creating a new one (KOK-024 Phase G). */
  exit?: StockExitDto | null;
}

/** The subset of `ExitForm`'s local state that depends on whether it's creating or editing —
 * kept as a plain, framework-free function (no React) so the create-vs-edit prefill logic is
 * unit-testable directly, mirroring `useReplayConfirmableMutation.test.ts`'s precedent for this
 * workspace (no jsdom/@testing-library installed, D-10 forbids adding either just for this). */
export interface ExitFormInitialState {
  itemId: string | null;
  /** Milli-units decimal string (scale 3), e.g. "1.5". */
  qty: string;
  reason: StockExitReason;
  businessDate: string;
  notes: string;
  packagingLines: PackagingLineValue[];
}

interface PackagingLineValue extends LineEditorLine {
  itemId: string | null;
  qty: string;
}

function emptyPackagingLine(): PackagingLineValue {
  return { itemId: null, qty: "" };
}

/** Absent `exit` (create) -> today's blank form. Present `exit` (edit) -> every field prefilled
 * from it. `nowIso`/`toBusinessDate` are injected as a parameter so the "create" branch stays pure
 * and testable without mocking the system clock. */
export function exitFormInitialState(
  exit: StockExitDto | null | undefined,
  nowIsoFn: () => string = nowIso,
): ExitFormInitialState {
  if (!exit) {
    return {
      itemId: null,
      qty: "",
      reason: STOCK_EXIT_REASONS[0],
      businessDate: toBusinessDate(nowIsoFn()),
      notes: "",
      packagingLines: [],
    };
  }
  return {
    itemId: exit.itemId,
    qty: formatIntAsDecimalInput(exit.qty, 3),
    reason: exit.reason,
    businessDate: exit.businessDate,
    notes: exit.notes ?? "",
    packagingLines: exit.packagingLines.map((line) => ({
      itemId: line.itemId,
      qty: formatIntAsDecimalInput(line.qty, 3),
    })),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : inventoryLabels.errors.generic;
}

export function ExitForm({ open, onOpenChange, exit }: ExitFormProps) {
  const isEditMode = Boolean(exit);

  const [itemId, setItemId] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<StockExitReason>(STOCK_EXIT_REASONS[0]);
  const [businessDate, setBusinessDate] = useState("");
  const [notes, setNotes] = useState("");
  const [packagingLines, setPackagingLines] = useState<PackagingLineValue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useRecordStockExit();
  const createReplay = useReplayConfirmableMutation<RecordStockExitCommand, RecordStockExitResult>(
    createMutation.mutateAsync,
    { onSuccess: () => onOpenChange(false) },
  );
  // `exit?.id ?? ""` keeps the hook call unconditional (rules of hooks) — the bogus "" id is never
  // actually used unless `isEditMode`, since `handleSubmit` only calls `updateReplay.execute` then.
  const updateMutation = useUpdateStockExit(exit?.id ?? "");
  const updateReplay = useReplayConfirmableMutation(updateMutation.mutateAsync, {
    onSuccess: () => onOpenChange(false),
  });

  // Resolves the item's unit for the abbreviation hint below the picker, regardless of whether
  // `ItemPicker`'s own `onChange` has fired yet this session — needed in edit mode, where the
  // form opens already knowing `itemId` but not yet the full `ItemDto` (mirrors `ItemPicker`'s own
  // internal `useItemQuery` for the same reason).
  const itemQuery = useItemQuery(itemId ?? undefined);
  const packagingItemsQuery = useItemsQuery({ isActive: true, kind: "PACKAGING" });
  const packagingItemsById = useMemo(() => {
    const map = new Map<string, Unit>();
    for (const item of packagingItemsQuery.data?.items ?? []) map.set(item.id, item.unit);
    return map;
  }, [packagingItemsQuery.data]);
  const assemblyDefinitionsQuery = useQuery({
    queryKey: ["assembly-definitions", "exit-packaging-gate", itemId ?? ""],
    queryFn: () =>
      api.get<ListAssemblyDefinitionsResult>(
        `/assembly-definitions?outputItemId=${encodeURIComponent(itemId ?? "")}&isActive=true`,
      ),
    enabled: Boolean(itemId),
  });
  const isAssembledPresentation =
    assemblyDefinitionsQuery.data?.assemblyDefinitions.some((definition) => definition.isDefault) ??
    false;

  useEffect(() => {
    if (open) {
      const initial = exitFormInitialState(exit);
      setItemId(initial.itemId);
      setQty(initial.qty);
      setReason(initial.reason);
      setBusinessDate(initial.businessDate);
      setNotes(initial.notes);
      setPackagingLines(initial.packagingLines);
      setError(null);
    }
  }, [open, exit]);

  const disabled = isEditMode ? updateReplay.isPending : createReplay.isPending;
  const activeReplay = isEditMode ? updateReplay : createReplay;
  const displayedError = error ?? (activeReplay.error ? errorMessage(activeReplay.error) : null);

  async function handleSubmit() {
    setError(null);
    if (!itemId) {
      setError(inventoryLabels.errors.itemRequired);
      return;
    }
    const qtyMilliUnits = parseDecimalToInt(qty, 3);
    if (qtyMilliUnits === null || qtyMilliUnits <= 0) {
      setError(inventoryLabels.errors.invalidQty);
      return;
    }
    const parsedPackagingLines = isAssembledPresentation
      ? []
      : packagingLines.map((line) => ({
          itemId: line.itemId,
          qty: parseDecimalToInt(line.qty, 3),
        }));
    if (parsedPackagingLines.some((line) => !line.itemId || line.qty === null || line.qty <= 0)) {
      setError(inventoryLabels.errors.invalidPackagingLine);
      return;
    }
    const validPackagingLines = parsedPackagingLines.map((line) => ({
      itemId: line.itemId as string,
      qty: line.qty as number,
    }));

    if (isEditMode && exit) {
      const parsed = updateStockExitCommandSchema.safeParse({
        itemId,
        qty: qtyMilliUnits,
        reason,
        notes: notes.trim() === "" ? undefined : notes.trim(),
        // Full-replacement semantics (PATCH) preserve the original instant — only `businessDate`
        // is user-editable here, exactly like create mode only exposes that field.
        occurredAt: exit.occurredAt,
        businessDate,
        packagingLines: validPackagingLines,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? inventoryLabels.errors.generic);
        return;
      }
      updateReplay.execute(parsed.data);
      return;
    }

    const parsed = recordStockExitCommandSchema.safeParse({
      itemId,
      qty: qtyMilliUnits,
      reason,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      occurredAt: nowIso(),
      businessDate,
      packagingLines: validPackagingLines,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? inventoryLabels.errors.generic);
      return;
    }

    createReplay.execute(parsed.data);
  }

  const title = isEditMode ? inventoryLabels.editExitTitle : inventoryLabels.recordExitTitle;
  const submitLabel = isEditMode ? inventoryLabels.saveExitChanges : inventoryLabels.submitExit;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} aria-label={title} className="max-w-4xl">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-foreground text-md">{title}</h2>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-foreground">{inventoryLabels.fieldItem}</span>
            <ItemPicker value={itemId} onChange={(id) => setItemId(id)} disabled={disabled} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="ef-qty">
                {inventoryLabels.fieldQty}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="ef-qty"
                  className="min-w-0 flex-1"
                  inputMode="decimal"
                  placeholder="0"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  disabled={disabled}
                />
                {itemQuery.data ? (
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {inventoryLabels.unitAbbrev[itemQuery.data.unit]}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground" htmlFor="ef-reason">
                {inventoryLabels.fieldReason}
              </label>
              <Select
                id="ef-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as StockExitReason)}
                disabled={disabled}
              >
                {STOCK_EXIT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {inventoryLabels.reasonLabels[r]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="ef-date">
              {inventoryLabels.fieldDate}
            </label>
            <Input
              id="ef-date"
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              disabled={disabled}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="ef-notes">
              {inventoryLabels.fieldNotes}
            </label>
            <Input
              id="ef-notes"
              placeholder={inventoryLabels.notesPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={disabled}
            />
          </div>

          {itemId && assemblyDefinitionsQuery.isSuccess && !isAssembledPresentation ? (
            <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div>
                <h3 className="font-medium text-foreground">
                  {inventoryLabels.packagingLinesTitle}
                </h3>
                <p className="text-muted-foreground text-xs">
                  {inventoryLabels.packagingLinesDescription}
                </p>
              </div>
              <LineEditor
                lines={packagingLines}
                onChange={setPackagingLines}
                createLine={emptyPackagingLine}
                labels={{
                  item: inventoryLabels.packagingLineItem,
                  qty: inventoryLabels.packagingLineQty,
                  addLine: inventoryLabels.addPackagingLine,
                  removeLine: inventoryLabels.removePackagingLine,
                }}
                itemKindFilter="PACKAGING"
                showAmount={false}
                disabled={disabled}
                getItemUnit={(itemId) => packagingItemsById.get(itemId)}
              />
            </section>
          ) : null}

          {displayedError ? <p className="text-negative text-sm">{displayedError}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={disabled}
          >
            {inventoryLabels.cancel}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={disabled || !itemId}>
            {submitLabel}
          </Button>
        </div>
      </Dialog>

      {isEditMode && updateReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={updateReplay.pendingConfirmation.impact}
          onConfirm={updateReplay.confirm}
          onCancel={updateReplay.cancel}
          confirmLoading={updateReplay.isPending}
          title={inventoryLabels.impactEditExitTitle}
          description={inventoryLabels.impactEditExitDescription}
        />
      ) : null}
      {!isEditMode && createReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={createReplay.pendingConfirmation.impact}
          onConfirm={createReplay.confirm}
          onCancel={createReplay.cancel}
          confirmLoading={createReplay.isPending}
          title={inventoryLabels.impactCreateExitTitle}
          description={inventoryLabels.impactCreateExitDescription}
          confirmLabel={inventoryLabels.submitExit}
        />
      ) : null}
    </>
  );
}

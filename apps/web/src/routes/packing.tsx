import type { AssemblyDto, ItemDto, SessionListItemDto } from "@kokoro/shared";
import {
  formatMoney,
  formatQty,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  type DateRange,
  DateRangeFilter,
  getDefaultDateRange,
} from "@/components/common/DateRangeFilter";
import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { Button, buttonVariants } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { useToast } from "@/components/ui/toast";
import {
  useAssemblies,
  useAssembly,
  useDeleteAssembly,
  useRestoreAssembly,
} from "@/features/assemblies/api";
import { useAssemblyDefinitions } from "@/features/assembly-definitions/api";
import { useItemsQuery } from "@/features/catalog/api";
import { useSessions } from "@/features/sessions/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { assembliesLabels } from "@/lib/i18n-assemblies";
import { sessionsLabels } from "@/lib/i18n-sessions";

const routeApi = getRouteApi("/_authenticated/packing");

function formatUnitCost(value: number): string {
  return formatMoney(totalCentavos(toMilliCentavosPerUnit(value), WHOLE_UNIT_MILLI_UNITS));
}

export function PackingRoute() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const defaults = getDefaultDateRange();
  const fromDate = search.fromDate ?? defaults.fromDate;
  const toDate = search.toDate ?? defaults.toDate;
  const assembliesQuery = useAssemblies({ fromDate, toDate });
  const itemsQuery = useItemsQuery();
  const sessionsQuery = useSessions({ fromDate, toDate });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const itemById = useMemo(
    () => new Map((itemsQuery.data?.items ?? []).map((item) => [item.id, item])),
    [itemsQuery.data],
  );
  const sessionById = useMemo(
    () => new Map((sessionsQuery.data?.sessions ?? []).map((session) => [session.id, session])),
    [sessionsQuery.data],
  );

  function updateDateRange(range: DateRange): void {
    void navigate({ search: (previous) => ({ ...previous, ...range }) });
  }

  const columns: EventTableColumn<AssemblyDto>[] = [
    {
      id: "date",
      header: assembliesLabels.columnDate,
      cell: (row) => row.businessDate,
      sortable: true,
      sortValue: (row) => row.businessDate,
    },
    {
      id: "output",
      header: assembliesLabels.columnOutput,
      cell: (row) => itemById.get(row.outputItemId)?.name ?? row.outputItemId,
      sortable: true,
      sortValue: (row) => itemById.get(row.outputItemId)?.name ?? row.outputItemId,
    },
    {
      id: "qty",
      header: assembliesLabels.columnQty,
      numeric: true,
      cell: (row) => {
        const item = itemById.get(row.outputItemId);
        return item ? formatQty(row.actualOutputQty, item.unit) : row.actualOutputQty;
      },
      sortable: true,
      sortValue: (row) => row.actualOutputQty,
    },
    {
      id: "unitCost",
      header: assembliesLabels.columnUnitCost,
      numeric: true,
      cell: (row) => formatUnitCost(row.outputUnitCostMc),
      sortable: true,
      sortValue: (row) => row.outputUnitCostMc,
    },
    {
      id: "session",
      header: assembliesLabels.columnSession,
      cell: (row) => {
        const session = sessionById.get(row.sessionId);
        return session ? sessionsLabels.typeLabels[session.type] : row.sessionId;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{assembliesLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{assembliesLabels.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/packing/definitions" className={buttonVariants({ variant: "outline" })}>
            {assembliesLabels.actionDefinitions}
          </Link>
          <Link to="/packing/new" className={buttonVariants()}>
            {assembliesLabels.actionRecord}
          </Link>
        </div>
      </div>
      <DateRangeFilter fromDate={fromDate} toDate={toDate} onChange={updateDateRange} />
      <EventTable
        columns={columns}
        rows={assembliesQuery.data?.assemblies ?? []}
        getRowId={(row) => row.id}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyMessage={assembliesLabels.noAssemblies}
        loading={assembliesQuery.isLoading}
        loadingMessage={assembliesLabels.loading}
      />
      <AssemblyDetailDrawer
        assemblyId={selectedId}
        open={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        itemById={itemById}
        sessionById={sessionById}
      />
    </div>
  );
}

interface AssemblyDetailDrawerProps {
  assemblyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemById: ReadonlyMap<string, ItemDto>;
  sessionById: ReadonlyMap<string, SessionListItemDto>;
}

function AssemblyDetailDrawer({
  assemblyId,
  open,
  onOpenChange,
  itemById,
  sessionById,
}: AssemblyDetailDrawerProps) {
  const definitionsQuery = useAssemblyDefinitions();
  const { showUndo } = useToast();
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const deleteMutation = useDeleteAssembly(assemblyId ?? "");
  const restoreMutation = useRestoreAssembly(pendingRestoreId ?? "");
  const restoreReplay = useReplayConfirmableMutation((command) =>
    restoreMutation.mutateAsync(command),
  );
  const deleteReplay = useReplayConfirmableMutation(
    (command) => deleteMutation.mutateAsync(command),
    {
      onSuccess: () => {
        setPendingRestoreId(assemblyId);
        onOpenChange(false);
        showUndo({
          message: assembliesLabels.deletedUndo,
          actionLabel: assembliesLabels.undo,
          onAction: () => restoreReplay.execute({}),
        });
      },
    },
  );
  const query = useAssembly(
    assemblyId ?? undefined,
    !deleteReplay.isPending && !deleteReplay.pendingConfirmation,
  );
  if (!assemblyId) return null;
  const assembly = query.data?.assembly;
  const outputItem = assembly ? itemById.get(assembly.outputItemId) : undefined;
  const definition = assembly
    ? definitionsQuery.data?.assemblyDefinitions.find((value) => value.id === assembly.definitionId)
    : undefined;
  const session = assembly ? sessionById.get(assembly.sessionId) : undefined;

  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={outputItem?.name ?? assembliesLabels.detailTitle}
        subtitle={assembly?.businessDate}
        entityType="assemblies"
        entityId={assembly?.id}
        footer={
          assembly
            ? assembliesLabels.createdUpdated(
                new Date(assembly.createdAt).toLocaleDateString("es-BO"),
                new Date(assembly.updatedAt).toLocaleDateString("es-BO"),
              )
            : undefined
        }
      >
        {!assembly ? (
          <p className="text-muted-foreground text-sm">{assembliesLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex justify-end gap-2">
              <Link
                to="/packing/$assemblyId/edit"
                params={{ assemblyId: assembly.id }}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {assembliesLabels.edit}
              </Link>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => deleteReplay.execute({})}
                disabled={deleteReplay.isPending}
              >
                {assembliesLabels.delete}
              </Button>
            </div>
            <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2.5">
              <DetailRow
                label={assembliesLabels.detailDefinition}
                value={definition?.name ?? assembliesLabels.noDefinition}
              />
              <DetailRow
                label={assembliesLabels.columnQty}
                value={
                  outputItem
                    ? formatQty(assembly.actualOutputQty, outputItem.unit)
                    : String(assembly.actualOutputQty)
                }
              />
              <DetailRow
                label={assembliesLabels.columnUnitCost}
                value={formatUnitCost(assembly.outputUnitCostMc)}
              />
              <DetailRow
                label={assembliesLabels.detailDirectCost}
                value={formatMoney(toCentavos(assembly.directCost))}
              />
              <DetailRow
                label={assembliesLabels.columnSession}
                value={session ? sessionsLabels.typeLabels[session.type] : assembly.sessionId}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium">{assembliesLabels.detailComponents}</span>
              {assembly.lines.map((line) => {
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
              <span className="font-medium">{assembliesLabels.fieldNotes}</span>
              <p className="text-muted-foreground">{assembly.notes ?? assembliesLabels.noNotes}</p>
            </div>
          </div>
        )}
      </DetailDrawer>
      {deleteReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={deleteReplay.pendingConfirmation.impact}
          onConfirm={deleteReplay.confirm}
          onCancel={deleteReplay.cancel}
          confirmLoading={deleteReplay.isPending}
          title={assembliesLabels.impactDeleteTitle}
          description={assembliesLabels.impactDeleteDescription}
        />
      ) : null}
      {restoreReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={restoreReplay.pendingConfirmation.impact}
          onConfirm={restoreReplay.confirm}
          onCancel={restoreReplay.cancel}
          confirmLoading={restoreReplay.isPending}
          title={assembliesLabels.impactRestoreTitle}
          description={assembliesLabels.impactRestoreDescription}
        />
      ) : null}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="numeric-cell text-right font-medium">{value}</span>
    </div>
  );
}

// Detail drawer for a single order (Doc 06 §4 DetailDrawer contract, Doc 07 SC-04). Full lifecycle
// actions live here: Confirmar/Iniciar producción/Marcar listo/Entregar/Cancelar, each opening its
// own small dialog (mirrors SalesTable's inline "Cobrar" + SaleDetailDrawer's edit/delete split).
//
// Unresolved (free-text) lines are resolved inline via `resolveOrderLine` (KOK-034, the narrow
// exception to "no generic update order" — packages/shared/src/orders.ts's header) — an ItemPicker
// appears next to any line missing an `itemId`, and "Entregar" stays disabled until every line has
// one, per the KOK-033 dev doc's explicit callout of what this drawer must gate.
//
// The order-profitability panel (agreed total − order-linked run costs) sums `totalCost` across
// every ProductionRun linked via `custom_order_id` (O-4) — one extra list fetch, no N+1.

import type {
  CustomOrderStatus,
  ItemDto,
  OrderDto,
  OrderTransitionResult,
  UndoDeliverOrderCommand,
} from "@kokoro/shared";
import { formatMoney, toCentavos } from "@kokoro/shared";
import { useMemo, useState } from "react";

import { ItemPicker } from "@/components/catalog/ItemPicker";
import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { useItemsQuery } from "@/features/catalog/api";
import {
  useMarkOrderReady,
  useOrder,
  useResolveOrderLine,
  useStartOrderProduction,
  useUndoDeliverOrder,
  useUndoMarkOrderReady,
  useUndoStartOrderProduction,
} from "@/features/orders/api";
import { useProductionRuns } from "@/features/production-runs/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError } from "@/lib/api";
import { ordersLabels } from "@/lib/i18n-orders";

import { CancelOrderDialog } from "./CancelOrderDialog";
import { ConfirmOrderDialog } from "./ConfirmOrderDialog";
import { DeliverOrderDialog } from "./DeliverOrderDialog";

/** Cancel is legal from every non-terminal status (same set `cancelOrder` accepts). */
const CANCELLABLE_STATUSES: readonly CustomOrderStatus[] = [
  "QUOTING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
];

export interface OrderDetailDrawerProps {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function UnresolvedLineRow({
  orderId,
  lineId,
  description,
}: {
  orderId: string;
  lineId: string;
  description: string | null;
}) {
  const [itemId, setItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolveMutation = useResolveOrderLine(orderId);

  async function handleResolve() {
    if (!itemId) return;
    setError(null);
    try {
      await resolveMutation.mutateAsync({ lineId, itemId });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : ordersLabels.errors.generic);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-warning-bg px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">{description ?? ordersLabels.lineItem}</span>
        <Badge variant="warning">{ordersLabels.lineUnresolvedBadge}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <ItemPicker value={itemId} onChange={setItemId} kindFilter="FINISHED" />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleResolve}
          disabled={!itemId || resolveMutation.isPending}
        >
          {ordersLabels.lineResolveSubmit}
        </Button>
      </div>
      {error ? <p className="text-negative text-xs">{error}</p> : null}
    </li>
  );
}

export function OrderDetailDrawer({ orderId, open, onOpenChange }: OrderDetailDrawerProps) {
  const orderQuery = useOrder(orderId ?? undefined);
  const itemsQuery = useItemsQuery({ isActive: true });
  const runsQuery = useProductionRuns(orderId ? { customOrderId: orderId } : {});

  const startMutation = useStartOrderProduction(orderId ?? "");
  const readyMutation = useMarkOrderReady(orderId ?? "");
  const undoStartMutation = useUndoStartOrderProduction(orderId ?? "");
  const undoReadyMutation = useUndoMarkOrderReady(orderId ?? "");
  const undoDeliverMutation = useUndoDeliverOrder(orderId ?? "");
  const undoDeliverReplay = useReplayConfirmableMutation<
    UndoDeliverOrderCommand,
    OrderTransitionResult
  >((command) => undoDeliverMutation.mutateAsync(command));

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const itemById = useMemo(() => {
    const map = new Map<string, ItemDto>();
    for (const item of itemsQuery.data?.items ?? []) map.set(item.id, item);
    return map;
  }, [itemsQuery.data]);

  if (!orderId) return null;
  const order: OrderDto | undefined = orderQuery.data;

  const runs = runsQuery.data?.productionRuns ?? [];
  const linkedCost = runs.reduce((sum, run) => sum + run.totalCost, 0);
  const margin =
    order?.agreedTotal !== null && order?.agreedTotal !== undefined
      ? order.agreedTotal - linkedCost
      : null;

  const allLinesResolved = order ? order.lines.every((line) => line.itemId !== null) : false;

  async function runTransition(mutation: { mutateAsync: () => Promise<unknown> }) {
    setTransitionError(null);
    try {
      await mutation.mutateAsync();
    } catch (err) {
      setTransitionError(err instanceof ApiError ? err.message : ordersLabels.errors.generic);
    }
  }

  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={ordersLabels.detailTitle}
        subtitle={order?.description}
        entityType="custom_orders"
        entityId={order?.id}
        footer={
          order ? (
            <span>
              Creado {new Date(order.createdAt).toLocaleDateString("es-BO")} · Actualizado{" "}
              {new Date(order.updatedAt).toLocaleDateString("es-BO")}
            </span>
          ) : undefined
        }
      >
        {!order ? (
          <p className="text-muted-foreground text-sm">{ordersLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {order.status === "QUOTING" ? (
                <Button type="button" size="sm" onClick={() => setConfirmOpen(true)}>
                  {ordersLabels.actionConfirm}
                </Button>
              ) : null}
              {order.status === "CONFIRMED" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => runTransition(startMutation)}
                  disabled={startMutation.isPending}
                >
                  {ordersLabels.actionStartProduction}
                </Button>
              ) : null}
              {order.status === "IN_PRODUCTION" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(ordersLabels.confirmUndoStart))
                      runTransition(undoStartMutation);
                  }}
                  disabled={undoStartMutation.isPending}
                >
                  {ordersLabels.actionUndoStart}
                </Button>
              ) : null}
              {order.status === "IN_PRODUCTION" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => runTransition(readyMutation)}
                  disabled={readyMutation.isPending}
                >
                  {ordersLabels.actionMarkReady}
                </Button>
              ) : null}
              {order.status === "READY" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(ordersLabels.confirmUndoReady))
                      runTransition(undoReadyMutation);
                  }}
                  disabled={undoReadyMutation.isPending}
                >
                  {ordersLabels.actionUndoReady}
                </Button>
              ) : null}
              {order.status === "READY" ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setDeliverOpen(true)}
                  disabled={!allLinesResolved}
                  title={!allLinesResolved ? ordersLabels.deliverUnresolvedWarning : undefined}
                >
                  {ordersLabels.actionDeliver}
                </Button>
              ) : null}
              {order.status === "DELIVERED" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(ordersLabels.confirmUndoDeliver))
                      undoDeliverReplay.execute({});
                  }}
                  disabled={undoDeliverReplay.isPending}
                >
                  {ordersLabels.actionUndoDeliver}
                </Button>
              ) : null}
              {CANCELLABLE_STATUSES.includes(order.status) ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setCancelOpen(true)}
                >
                  {ordersLabels.actionCancel}
                </Button>
              ) : null}
            </div>

            {transitionError ? <p className="text-negative text-sm">{transitionError}</p> : null}
            {undoDeliverReplay.error ? (
              <p className="text-negative text-sm">
                {undoDeliverReplay.error instanceof ApiError
                  ? undoDeliverReplay.error.message
                  : ordersLabels.errors.generic}
              </p>
            ) : null}
            {order.status === "READY" && !allLinesResolved ? (
              <p className="text-warning text-xs">{ordersLabels.deliverUnresolvedWarning}</p>
            ) : null}

            <div className="flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{ordersLabels.columnStatus}</span>
                <Badge>{ordersLabels.statusLabels[order.status]}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{ordersLabels.columnCustomer}</span>
                <span className="font-medium text-foreground">
                  {order.customerName ?? order.customerId}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{ordersLabels.columnAgreedTotal}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {order.agreedTotal !== null
                    ? formatMoney(toCentavos(order.agreedTotal))
                    : ordersLabels.noAgreedTotal}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{ordersLabels.columnDepositPaid}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {formatMoney(toCentavos(order.depositPaid))}
                </span>
              </div>
              {order.balanceDue !== null ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{ordersLabels.columnBalanceDue}</span>
                  <span className="numeric-cell font-medium text-foreground">
                    {formatMoney(toCentavos(order.balanceDue))}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{ordersLabels.columnDeliveryDate}</span>
                <span className="font-medium text-foreground">
                  {order.deliveryDate ?? ordersLabels.noDeliveryDate}
                </span>
              </div>
              {order.deliveryPlace ? (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{ordersLabels.columnDeliveryPlace}</span>
                  <span className="font-medium text-foreground">{order.deliveryPlace}</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">{ordersLabels.detailLines}</span>
              <ul className="flex flex-col gap-2">
                {order.lines.map((line) =>
                  line.itemId !== null ? (
                    <li
                      key={line.id}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                    >
                      <span className="font-medium text-foreground">
                        {itemById.get(line.itemId)?.name ?? line.itemId}
                      </span>
                      <span className="numeric-cell text-muted-foreground text-xs">
                        {line.lineTotal !== null ? formatMoney(toCentavos(line.lineTotal)) : "—"}
                      </span>
                    </li>
                  ) : (
                    <UnresolvedLineRow
                      key={line.id}
                      orderId={order.id}
                      lineId={line.id}
                      description={line.description}
                    />
                  ),
                )}
              </ul>
            </div>

            <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5">
              <span className="font-medium text-foreground">{ordersLabels.profitabilityTitle}</span>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {ordersLabels.profitabilityAgreedTotal}
                </span>
                <span className="numeric-cell text-foreground">
                  {order.agreedTotal !== null ? formatMoney(toCentavos(order.agreedTotal)) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {ordersLabels.profitabilityLinkedCosts}
                </span>
                <span className="numeric-cell text-foreground">
                  {formatMoney(toCentavos(linkedCost))}
                </span>
              </div>
              <div className="flex items-center justify-between border-border border-t pt-2 text-xs">
                <span className="text-muted-foreground">{ordersLabels.profitabilityMargin}</span>
                <span
                  className={`numeric-cell font-medium ${margin !== null && margin < 0 ? "text-negative" : "text-foreground"}`}
                >
                  {margin !== null ? formatMoney(toCentavos(margin)) : "—"}
                </span>
              </div>

              <span className="mt-1 font-medium text-foreground text-xs">
                {ordersLabels.linkedRunsTitle}
              </span>
              {runs.length === 0 ? (
                <p className="text-muted-foreground text-xs">{ordersLabels.noLinkedRuns}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {runs.map((run) => (
                    <li key={run.id} className="flex items-center justify-between text-xs">
                      <span className="text-foreground">{run.businessDate}</span>
                      <span className="numeric-cell text-foreground">
                        {formatMoney(toCentavos(run.totalCost))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{ordersLabels.fieldNotes}</span>
              <p className="text-muted-foreground">{order.notes ?? ordersLabels.noNotes}</p>
            </div>
          </div>
        )}
      </DetailDrawer>

      {order ? (
        <>
          <ConfirmOrderDialog order={order} open={confirmOpen} onOpenChange={setConfirmOpen} />
          <DeliverOrderDialog order={order} open={deliverOpen} onOpenChange={setDeliverOpen} />
          <CancelOrderDialog order={order} open={cancelOpen} onOpenChange={setCancelOpen} />
        </>
      ) : null}

      {undoDeliverReplay.pendingConfirmation ? (
        <ImpactConfirmDialog
          open
          impact={undoDeliverReplay.pendingConfirmation.impact}
          onConfirm={undoDeliverReplay.confirm}
          onCancel={undoDeliverReplay.cancel}
          confirmLoading={undoDeliverReplay.isPending}
          title={ordersLabels.impactUndoDeliverTitle}
          description={ordersLabels.impactUndoDeliverDescription}
        />
      ) : null}
    </>
  );
}

import type {
  AssemblyDto,
  FinancialAccountDto,
  FinancialTransactionDto,
  ItemDto,
  OrderDto,
  OrderSaleHistoryDto,
  OrderTransitionResult,
  ProductionRunDto,
  PurchaseDto,
  UndoDeliverOrderCommand,
} from "@kokoro/shared";
import { formatMoney, formatQty, toCentavos } from "@kokoro/shared";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { RecordTransactionDialog } from "@/components/finance/RecordTransactionDialog";
import { CancelOrderDialog } from "@/components/orders/CancelOrderDialog";
import { ConfirmOrderDialog } from "@/components/orders/ConfirmOrderDialog";
import { DeliverOrderDialog } from "@/components/orders/DeliverOrderDialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ImpactConfirmDialog } from "@/components/ui/ImpactConfirmDialog";
import { useAssemblies } from "@/features/assemblies/api";
import { useItemsQuery } from "@/features/catalog/api";
import { useAccounts, useTransactions } from "@/features/finance/api";
import {
  signedTransactionAmount,
  transactionAmountColorClass,
} from "@/features/finance/transaction-styling";
import {
  useMarkOrderReady,
  useOrderSales,
  useStartOrderProduction,
  useUndoDeliverOrder,
  useUndoMarkOrderReady,
  useUndoStartOrderProduction,
} from "@/features/orders/api";
import { useProductionRuns } from "@/features/production-runs/api";
import { usePurchases } from "@/features/purchases/api";
import { useReplayConfirmableMutation } from "@/hooks/useReplayConfirmableMutation";
import { ApiError } from "@/lib/api";
import { financeLabels } from "@/lib/i18n-finance";
import { ordersLabels } from "@/lib/i18n-orders";
import { summarizeOrderCash, summarizeOrderSaleMargin } from "@/lib/order-detail-summary";

type OrderReturnSearch = {
  ordersView?: "active" | "history";
  historyFilter?: "all" | "outstanding" | "paid" | "cancelled";
  fromDate?: string;
  toDate?: string;
};

type RelatedTarget =
  | { type: "finance"; orderId: string }
  | { type: "purchase" | "production" | "assembly" | "sale" | "session" | "order"; id: string };

interface OrderTimelineEntry {
  id: string;
  occurredAt: string;
  businessDate: string;
  code: string | null;
  title: string;
  description: string;
  amount?:
    | { kind: "cash"; value: number; transactionType: FinancialTransactionDto["type"] }
    | { kind: "cost"; value: number };
  target?: RelatedTarget;
  origin?: { label: string; target: RelatedTarget };
}

interface OrderDetailPageProps {
  order: OrderDto;
  returnSearch: OrderReturnSearch;
}

const ACTIVE_STATUSES = ["QUOTING", "CONFIRMED", "IN_PRODUCTION", "READY"] as const;

function isActiveOrder(order: OrderDto): boolean {
  return ACTIVE_STATUSES.includes(order.status as (typeof ACTIVE_STATUSES)[number]);
}

function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-card px-3 py-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="numeric-cell break-words font-semibold text-foreground">{value}</span>
      {detail ? <span className="text-muted-foreground text-xs">{detail}</span> : null}
    </div>
  );
}

function RelatedEventLink({
  target,
  children,
  className,
}: {
  target: RelatedTarget;
  children: ReactNode;
  className?: string;
}) {
  const linkClassName = className ?? "text-primary underline-offset-2 hover:underline";
  switch (target.type) {
    case "finance":
      return (
        <Link
          to="/finance"
          search={() => ({ customOrderId: target.orderId })}
          className={linkClassName}
        >
          {children}
        </Link>
      );
    case "purchase":
      return (
        <Link to="/purchases" search={() => ({ open: target.id })} className={linkClassName}>
          {children}
        </Link>
      );
    case "production":
      return (
        <Link to="/production" search={() => ({ open: target.id })} className={linkClassName}>
          {children}
        </Link>
      );
    case "assembly":
      return (
        <Link to="/packing" search={() => ({ open: target.id })} className={linkClassName}>
          {children}
        </Link>
      );
    case "sale":
      return (
        <Link to="/sales" search={() => ({ open: target.id })} className={linkClassName}>
          {children}
        </Link>
      );
    case "session":
      return (
        <Link to="/sessions" search={() => ({ open: target.id })} className={linkClassName}>
          {children}
        </Link>
      );
    case "order":
      return (
        <Link to="/orders/$orderId" params={{ orderId: target.id }} className={linkClassName}>
          {children}
        </Link>
      );
  }
}

function targetForSourceEvent(
  sourceEvent: NonNullable<FinancialTransactionDto["sourceEvent"]>,
): RelatedTarget {
  switch (sourceEvent.type) {
    case "purchase":
      return { type: "purchase", id: sourceEvent.id };
    case "sale":
      return { type: "sale", id: sourceEvent.id };
    case "custom_order":
      return { type: "order", id: sourceEvent.id };
    case "session":
      return { type: "session", id: sourceEvent.id };
  }
}

function transactionTimelineEntry(
  transaction: FinancialTransactionDto,
  orderId: string,
): OrderTimelineEntry {
  const sourceEvent = transaction.sourceEvent;
  return {
    id: `finance:${transaction.id}`,
    occurredAt: transaction.occurredAt,
    businessDate: transaction.businessDate,
    code: transaction.code ?? sourceEvent?.code ?? null,
    title: `${financeLabels.typeLabels[transaction.type]} · ${financeLabels.categoryLabels[transaction.category]}`,
    description: transaction.description ?? financeLabels.relatedOrderWithoutCode,
    amount: { kind: "cash", value: transaction.amount, transactionType: transaction.type },
    target: { type: "finance", orderId },
    ...(sourceEvent
      ? {
          origin: {
            label: [financeLabels.sourceEventTypeLabels[sourceEvent.type], sourceEvent.code]
              .filter((part): part is string => part !== null)
              .join(" "),
            target: targetForSourceEvent(sourceEvent),
          },
        }
      : {}),
  };
}

function purchaseTimelineEntry(purchase: PurchaseDto): OrderTimelineEntry {
  return {
    id: `purchase:${purchase.id}`,
    occurredAt: purchase.occurredAt,
    businessDate: purchase.businessDate,
    code: purchase.code,
    title: ordersLabels.timelinePurchase,
    description: purchase.supplierName ?? financeLabels.categoryLabels.SUPPLY_PURCHASE,
    amount: { kind: "cost", value: purchase.total },
    target: { type: "purchase", id: purchase.id },
  };
}

function productionTimelineEntry(
  run: ProductionRunDto,
  itemName: string | undefined,
): OrderTimelineEntry {
  return {
    id: `production:${run.id}`,
    occurredAt: run.occurredAt,
    businessDate: run.businessDate,
    code: run.code,
    title: ordersLabels.timelineProduction,
    description: itemName ?? ordersLabels.productionEvidence,
    amount: { kind: "cost", value: run.totalCost },
    target: { type: "production", id: run.id },
  };
}

function assemblyTimelineEntry(
  assembly: AssemblyDto,
  itemName: string | undefined,
  itemUnit: ItemDto["unit"] | undefined,
): OrderTimelineEntry {
  const qty = itemUnit ? formatQty(assembly.actualOutputQty, itemUnit) : null;
  return {
    id: `assembly:${assembly.id}`,
    occurredAt: assembly.occurredAt,
    businessDate: assembly.businessDate,
    code: assembly.code,
    title: ordersLabels.timelineAssembly,
    description: [itemName ?? ordersLabels.assemblyEvidence, qty].filter(Boolean).join(" · "),
    amount: { kind: "cost", value: assembly.directCost },
    target: { type: "assembly", id: assembly.id },
  };
}

function saleTimelineEntry({ sale, deletedAt }: OrderSaleHistoryDto): OrderTimelineEntry {
  return {
    id: `sale:${sale.id}`,
    occurredAt: sale.occurredAt,
    businessDate: sale.businessDate,
    code: sale.code,
    title: deletedAt ? ordersLabels.timelineSaleUndone : ordersLabels.timelineSale,
    description: formatMoney(toCentavos(sale.total)),
    ...(deletedAt ? {} : { target: { type: "sale" as const, id: sale.id } }),
  };
}

function ActivityRow({ entry }: { entry: OrderTimelineEntry }) {
  const signedValue =
    entry.amount?.kind === "cash"
      ? signedTransactionAmount(entry.amount.transactionType, entry.amount.value)
      : null;
  return (
    <li className="grid min-w-0 grid-cols-1 gap-2 border-border border-t py-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start">
      <time className="text-muted-foreground text-xs" dateTime={entry.occurredAt}>
        {entry.businessDate}
      </time>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">{entry.title}</span>
          <span className="font-mono text-muted-foreground text-xs">
            {entry.code ?? ordersLabels.noCode}
          </span>
        </div>
        <p className="break-words text-muted-foreground text-sm">{entry.description}</p>
        {entry.origin ? (
          <p className="mt-1 text-muted-foreground text-xs">
            {ordersLabels.timelineOrigin}:{" "}
            <RelatedEventLink target={entry.origin.target}>{entry.origin.label}</RelatedEventLink>
          </p>
        ) : null}
        {entry.target ? (
          <RelatedEventLink
            target={entry.target}
            className="mt-1 inline-flex min-h-11 items-center text-primary text-xs underline-offset-2 hover:underline sm:min-h-0"
          >
            {ordersLabels.openLinkedEvent}
          </RelatedEventLink>
        ) : null}
      </div>
      {entry.amount ? (
        <span
          className={`numeric-cell font-medium ${entry.amount.kind === "cash" ? transactionAmountColorClass(entry.amount.transactionType) : "text-muted-foreground"}`}
        >
          {entry.amount.kind === "cash" && signedValue !== null
            ? formatMoney(toCentavos(signedValue), { signed: true })
            : formatMoney(toCentavos(entry.amount.value))}
        </span>
      ) : null}
    </li>
  );
}

function MoneyValue({ value }: { value: number | null }) {
  return value === null ? ordersLabels.notComputed : formatMoney(toCentavos(value));
}

export function OrderDetailPage({ order, returnSearch }: OrderDetailPageProps) {
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [undoStartOpen, setUndoStartOpen] = useState(false);
  const [undoReadyOpen, setUndoReadyOpen] = useState(false);
  const [readyNoWorkOpen, setReadyNoWorkOpen] = useState(false);
  const [undoDeliverOpen, setUndoDeliverOpen] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const accountsQuery = useAccounts();
  const transactionsQuery = useTransactions({ customOrderId: order.id, limit: 500 });
  const purchasesQuery = usePurchases({ customOrderId: order.id, limit: 500 });
  const runsQuery = useProductionRuns({ customOrderId: order.id, limit: 500 });
  const assembliesQuery = useAssemblies({ customOrderId: order.id, limit: 500 });
  const saleHistoryQuery = useOrderSales(order.id);
  const itemsQuery = useItemsQuery();
  const accounts: FinancialAccountDto[] = accountsQuery.data?.accounts ?? [];
  const runs: ProductionRunDto[] = runsQuery.data?.productionRuns ?? [];
  const assemblies: AssemblyDto[] = assembliesQuery.data?.assemblies ?? [];
  const purchases: PurchaseDto[] = purchasesQuery.data?.purchases ?? [];
  const transactions: FinancialTransactionDto[] = transactionsQuery.data?.transactions ?? [];
  const saleHistory: OrderSaleHistoryDto[] = saleHistoryQuery.data?.sales ?? [];
  const activeSale = saleHistory.find(
    (entry) => entry.sale.id === order.saleId && entry.deletedAt === null,
  )?.sale;
  const itemById = useMemo(
    () => new Map((itemsQuery.data?.items ?? []).map((item) => [item.id, item])),
    [itemsQuery.data],
  );

  const startMutation = useStartOrderProduction(order.id);
  const readyMutation = useMarkOrderReady(order.id);
  const undoStartMutation = useUndoStartOrderProduction(order.id);
  const undoReadyMutation = useUndoMarkOrderReady(order.id);
  const undoDeliverMutation = useUndoDeliverOrder(order.id);
  const undoDeliverReplay = useReplayConfirmableMutation<
    UndoDeliverOrderCommand,
    OrderTransitionResult
  >((command) => undoDeliverMutation.mutateAsync(command));

  const cashSummary = transactionsQuery.data ? summarizeOrderCash(transactions) : null;
  const saleMargin = activeSale ? summarizeOrderSaleMargin(activeSale) : null;
  const workReadsLoading = runsQuery.isLoading || assembliesQuery.isLoading;
  const workReadsError = runsQuery.isError || assembliesQuery.isError;
  const workReadsReady = runsQuery.data !== undefined && assembliesQuery.data !== undefined;
  const hasNoLinkedWork = workReadsReady && runs.length === 0 && assemblies.length === 0;
  const allLinesResolved =
    order.lines.length > 0 && order.lines.every((line) => line.itemId !== null);

  const timelineEntries = useMemo(() => {
    const entries: OrderTimelineEntry[] = [
      ...transactions.map((transaction) => transactionTimelineEntry(transaction, order.id)),
      ...purchases.map(purchaseTimelineEntry),
      ...runs.map((run) => productionTimelineEntry(run, itemById.get(run.outputItemId)?.name)),
      ...assemblies.map((assembly) => {
        const item = itemById.get(assembly.outputItemId);
        return assemblyTimelineEntry(assembly, item?.name, item?.unit);
      }),
      ...saleHistory.map(saleTimelineEntry),
    ];
    return entries.sort(
      (left, right) =>
        right.businessDate.localeCompare(left.businessDate) ||
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.id.localeCompare(left.id),
    );
  }, [assemblies, itemById, order.id, purchases, runs, saleHistory, transactions]);

  const timelineQueries = [
    transactionsQuery,
    purchasesQuery,
    runsQuery,
    assembliesQuery,
    saleHistoryQuery,
  ];
  const deliveredSaleMissing =
    order.status === "DELIVERED" && saleHistoryQuery.data !== undefined && activeSale === undefined;
  const timelineLoading = timelineQueries.some((query) => query.isLoading);
  const timelineError = timelineQueries.some((query) => query.isError) || deliveredSaleMissing;
  const timelineComplete =
    timelineQueries.every((query) => query.data !== undefined) && !deliveredSaleMissing;

  async function runTransition(action: () => Promise<unknown>): Promise<void> {
    setTransitionError(null);
    try {
      await action();
    } catch (error) {
      setTransitionError(error instanceof ApiError ? error.message : ordersLabels.errors.generic);
    }
  }

  function retryTimeline(): void {
    for (const query of timelineQueries) void query.refetch();
  }

  const orderContext = { id: order.id, code: order.code };
  const customerAmount = order.balance.customerAmount;
  const expectedBalance =
    order.status === "DELIVERED"
      ? order.balance.receivableBalance
      : order.status === "CANCELLED"
        ? null
        : order.balance.expectedBalance;

  return (
    <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-5 pb-6">
      <header className="flex min-w-0 flex-col gap-4 border-border border-b pb-4">
        <Link
          to="/orders"
          search={returnSearch}
          className="inline-flex min-h-11 w-fit items-center text-muted-foreground text-sm hover:text-foreground"
        >
          ← {ordersLabels.detailBackToBoard}
        </Link>
        <div className="flex min-w-0 flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words font-semibold text-2xl text-foreground">
                {order.code ?? ordersLabels.orderCodeUnavailable}
              </h1>
              <Badge>{ordersLabels.statusLabels[order.status]}</Badge>
            </div>
            <p className="mt-1 break-words text-muted-foreground text-sm">{order.description}</p>
            <p className="mt-1 text-muted-foreground text-sm">
              {ordersLabels.columnCustomer}:{" "}
              {order.customerName ?? ordersLabels.orderCodeUnavailable}
            </p>
            <p className="font-mono text-muted-foreground text-xs">
              {ordersLabels.orderContextId}: {order.code ?? ordersLabels.orderCodeUnavailable}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isActiveOrder(order) ? (
              <Link
                to="/orders/$orderId/edit"
                params={{ orderId: order.id }}
                search={returnSearch}
                className={buttonVariants({ variant: "outline" })}
              >
                {ordersLabels.actionEditAgreement}
              </Link>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => setExpenseOpen(true)}
              disabled={!accountsQuery.data}
            >
              {ordersLabels.actionRecordExpense}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIncomeOpen(true)}
              disabled={!accountsQuery.data}
            >
              {ordersLabels.actionRecordIncome}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRefundOpen(true)}
              disabled={!accountsQuery.data}
            >
              {ordersLabels.actionRecordRefund}
            </Button>
          </div>
        </div>
        {accountsQuery.isLoading ? (
          <p className="text-muted-foreground text-xs" role="status">
            {ordersLabels.accountsLoading}
          </p>
        ) : null}
        {accountsQuery.isError ? (
          <div className="flex flex-wrap items-center gap-2 text-negative text-sm" role="alert">
            <span>{ordersLabels.accountsError}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void accountsQuery.refetch()}
            >
              {ordersLabels.retry}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Link
            to="/finance"
            search={() => ({ customOrderId: order.id })}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {ordersLabels.actionViewFinance}
          </Link>
          <Link
            to="/packing"
            search={() => ({ customOrderId: order.id })}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {ordersLabels.actionViewPacking}
          </Link>
        </div>
      </header>

      <section aria-label={ordersLabels.detailTitle} className="flex flex-col gap-3">
        <h2 className="font-semibold text-foreground">{ordersLabels.detailTitle}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label={ordersLabels.fieldAgreedTotal}
            value={<MoneyValue value={order.agreedTotal} />}
          />
          <Metric
            label={ordersLabels.fieldAdditionalCharge}
            value={formatMoney(toCentavos(order.additionalCharge))}
          />
          <Metric
            label={ordersLabels.customerPrice}
            value={<MoneyValue value={customerAmount} />}
          />
          <Metric
            label={ordersLabels.receiptsReceived}
            value={formatMoney(toCentavos(order.balance.qualifyingReceipts))}
          />
          <Metric
            label={
              order.status === "DELIVERED" ? ordersLabels.actualDebt : ordersLabels.expectedBalance
            }
            value={
              order.status === "CANCELLED" ? (
                ordersLabels.noDebtForCancelled
              ) : (
                <MoneyValue value={expectedBalance} />
              )
            }
          />
          <Metric
            label={ordersLabels.receiptExcess}
            value={<MoneyValue value={order.balance.excess} />}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4">
          <h2 className="font-semibold text-foreground">{ordersLabels.linkedCostEvidence}</h2>
          {workReadsLoading ? (
            <p className="text-muted-foreground text-sm" role="status">
              {ordersLabels.loadingCostEvidence}
            </p>
          ) : workReadsError ? (
            <div className="flex flex-col gap-2" role="alert">
              <p className="text-negative text-sm">{ordersLabels.timelineError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void runsQuery.refetch();
                  void assembliesQuery.refetch();
                }}
              >
                {ordersLabels.retry}
              </Button>
            </div>
          ) : hasNoLinkedWork ? (
            <p className="rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-warning text-sm">
              {ordersLabels.missingCostInputs}
            </p>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">{ordersLabels.partialCostExplanation}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground text-sm">
                    {ordersLabels.productionEvidence}
                  </p>
                  {runs.length ? (
                    <ul className="mt-1 flex flex-col gap-1 text-sm">
                      {runs.map((run) => (
                        <li key={run.id} className="flex flex-wrap justify-between gap-2">
                          <RelatedEventLink target={{ type: "production", id: run.id }}>
                            {run.code ?? ordersLabels.noCode}
                          </RelatedEventLink>
                          <span className="numeric-cell text-muted-foreground">
                            {formatMoney(toCentavos(run.totalCost))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted-foreground text-xs">
                      {ordersLabels.noLinkedWork}
                    </p>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground text-sm">
                    {ordersLabels.assemblyEvidence}
                  </p>
                  {assemblies.length ? (
                    <ul className="mt-1 flex flex-col gap-1 text-sm">
                      {assemblies.map((assembly) => (
                        <li key={assembly.id} className="flex flex-wrap justify-between gap-2">
                          <RelatedEventLink target={{ type: "assembly", id: assembly.id }}>
                            {assembly.code ?? ordersLabels.noCode}
                          </RelatedEventLink>
                          <span className="numeric-cell text-muted-foreground">
                            {formatMoney(toCentavos(assembly.directCost))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted-foreground text-xs">
                      {ordersLabels.noLinkedWork}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
          {order.status === "DELIVERED" ? (
            saleHistoryQuery.isLoading ? (
              <p className="text-muted-foreground text-sm" role="status">
                {ordersLabels.productMarginUnavailable}
              </p>
            ) : saleHistoryQuery.isError || !activeSale || !saleMargin ? (
              <div className="flex flex-wrap items-center gap-2 text-negative text-sm" role="alert">
                <span>
                  {order.status === "DELIVERED"
                    ? ordersLabels.deliveredSaleMissing
                    : ordersLabels.productMarginUnavailable}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void saleHistoryQuery.refetch()}
                >
                  {ordersLabels.retry}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1 border-border border-t pt-3">
                <h3 className="font-medium text-foreground text-sm">
                  {ordersLabels.productMarginTitle}
                </h3>
                <DetailAmount
                  label={ordersLabels.productRevenue}
                  value={saleMargin.merchandiseRevenue}
                />
                <DetailAmount label={ordersLabels.frozenCogs} value={saleMargin.frozenCogs} />
                <DetailAmount
                  label={ordersLabels.productGrossMargin}
                  value={saleMargin.productGrossMargin}
                  emphasized
                />
              </div>
            )
          ) : (
            <p className="border-border border-t pt-3 text-muted-foreground text-sm">
              {ordersLabels.productMarginUnavailable}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4">
          <h2 className="font-semibold text-foreground">{ordersLabels.cashResultTitle}</h2>
          {transactionsQuery.isLoading ? (
            <p className="text-muted-foreground text-sm" role="status">
              {ordersLabels.timelineLoading}
            </p>
          ) : transactionsQuery.isError || !cashSummary ? (
            <div className="flex flex-wrap items-center gap-2 text-negative text-sm" role="alert">
              <span>{ordersLabels.timelineError}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void transactionsQuery.refetch()}
              >
                {ordersLabels.retry}
              </Button>
            </div>
          ) : (
            <>
              <DetailAmount label={ordersLabels.cashIncome} value={cashSummary.incomeTotal} />
              <DetailAmount label={ordersLabels.cashExpenses} value={cashSummary.expenseTotal} />
              <DetailAmount
                label={ordersLabels.cashResult}
                value={cashSummary.cashResult}
                emphasized
              />
              <p className="text-muted-foreground text-xs">{ordersLabels.cashResultExplanation}</p>
            </>
          )}
        </div>
      </section>

      <section className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4">
        <h2 className="font-semibold text-foreground">{ordersLabels.orderLinesHeading}</h2>
        {order.lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{ordersLabels.noOrderLines}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {order.lines.map((line) => {
              const item = line.itemId ? itemById.get(line.itemId) : undefined;
              return (
                <li
                  key={line.id}
                  className="flex min-w-0 flex-wrap justify-between gap-2 border-border border-t pt-2"
                >
                  <span className="min-w-0 break-words text-foreground">
                    {item?.name ?? line.description ?? ordersLabels.lineItem}
                    {item ? (
                      <span className="ml-2 text-muted-foreground text-xs">
                        {formatQty(line.qty, item.unit)}
                      </span>
                    ) : null}
                  </span>
                  <span className="numeric-cell text-muted-foreground">
                    {line.lineTotal === null ? "—" : formatMoney(toCentavos(line.lineTotal))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {order.deliveryDate ? (
          <p className="text-muted-foreground text-sm">
            {ordersLabels.fieldDeliveryDate}: {order.deliveryDate}
            {order.deliveryPlace ? ` · ${order.deliveryPlace}` : ""}
          </p>
        ) : null}
        {order.notes ? (
          <p className="whitespace-pre-wrap text-muted-foreground text-sm">{order.notes}</p>
        ) : null}
      </section>

      <section className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-foreground">{ordersLabels.detailTimeline}</h2>
          {timelineError ? (
            <Button type="button" size="sm" variant="outline" onClick={retryTimeline}>
              {ordersLabels.timelineRetry}
            </Button>
          ) : null}
        </div>
        {timelineLoading ? (
          <p className="text-muted-foreground text-sm" role="status">
            {ordersLabels.timelineLoading}
          </p>
        ) : null}
        {timelineError ? (
          <p className="text-negative text-sm" role="alert">
            {ordersLabels.timelineError}
          </p>
        ) : null}
        {timelineComplete && !timelineLoading && timelineEntries.length === 0 && !timelineError ? (
          <p className="text-muted-foreground text-sm">{ordersLabels.timelineEmpty}</p>
        ) : null}
        {timelineEntries.length > 0 ? (
          <ol className="flex min-w-0 flex-col">
            {timelineEntries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ol>
        ) : null}
        {itemsQuery.isError ? (
          <p className="text-muted-foreground text-xs">{ordersLabels.itemNamesUnavailable}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-border border-t pt-4">
        {transitionError ? (
          <p className="text-negative text-sm" role="alert">
            {transitionError}
          </p>
        ) : null}
        {order.status === "READY" && !allLinesResolved ? (
          <p className="rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-warning text-sm">
            {ordersLabels.deliverUnresolvedWarning}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {order.status === "QUOTING" ? (
            <Button type="button" onClick={() => setConfirmOpen(true)}>
              {ordersLabels.actionConfirm}
            </Button>
          ) : null}
          {order.status === "CONFIRMED" ? (
            <Button
              type="button"
              onClick={() => void runTransition(() => startMutation.mutateAsync())}
              disabled={startMutation.isPending}
            >
              {ordersLabels.actionStartProduction}
            </Button>
          ) : null}
          {order.status === "IN_PRODUCTION" ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUndoStartOpen(true)}
                disabled={undoStartMutation.isPending}
              >
                {ordersLabels.actionUndoStart}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!workReadsReady || workReadsError) {
                    setTransitionError(ordersLabels.workDataUnavailable);
                    return;
                  }
                  if (hasNoLinkedWork) {
                    setReadyNoWorkOpen(true);
                    return;
                  }
                  void runTransition(() => readyMutation.mutateAsync());
                }}
                disabled={readyMutation.isPending || workReadsLoading || workReadsError}
              >
                {ordersLabels.actionMarkReady}
              </Button>
            </>
          ) : null}
          {order.status === "READY" ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setUndoReadyOpen(true)}
                disabled={undoReadyMutation.isPending}
              >
                {ordersLabels.actionUndoReady}
              </Button>
              <Button
                type="button"
                onClick={() => setDeliverOpen(true)}
                disabled={!allLinesResolved}
                title={!allLinesResolved ? ordersLabels.deliverUnresolvedWarning : undefined}
              >
                {ordersLabels.actionDeliver}
              </Button>
            </>
          ) : null}
          {order.status === "DELIVERED" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setUndoDeliverOpen(true)}
              disabled={undoDeliverReplay.isPending}
            >
              {ordersLabels.actionUndoDeliver}
            </Button>
          ) : null}
          {isActiveOrder(order) ? (
            <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
              {ordersLabels.actionCancel}
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {ordersLabels.orderCreatedAt} {new Date(order.createdAt).toLocaleDateString("es-BO")} ·{" "}
          {ordersLabels.orderUpdatedAt} {new Date(order.updatedAt).toLocaleDateString("es-BO")}
        </p>
      </section>

      <RecordTransactionDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        type="EXPENSE"
        accounts={accounts}
        orderContext={orderContext}
      />
      <RecordTransactionDialog
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        type="INCOME"
        accounts={accounts}
        orderContext={orderContext}
      />
      <RecordTransactionDialog
        open={refundOpen}
        onOpenChange={setRefundOpen}
        type="EXPENSE"
        accounts={accounts}
        orderContext={orderContext}
        fixedCategory="ORDER_REFUND"
      />
      <ConfirmOrderDialog order={order} open={confirmOpen} onOpenChange={setConfirmOpen} />
      <DeliverOrderDialog order={order} open={deliverOpen} onOpenChange={setDeliverOpen} />
      <CancelOrderDialog order={order} open={cancelOpen} onOpenChange={setCancelOpen} />

      <ConfirmDialog
        open={undoStartOpen}
        title={ordersLabels.actionUndoStart}
        description={ordersLabels.confirmUndoStart}
        onCancel={() => setUndoStartOpen(false)}
        confirmLoading={undoStartMutation.isPending}
        onConfirm={() => {
          setUndoStartOpen(false);
          void runTransition(() => undoStartMutation.mutateAsync());
        }}
      />
      <ConfirmDialog
        open={readyNoWorkOpen}
        title={ordersLabels.actionMarkReady}
        description={ordersLabels.readyNoWorkWarning}
        onCancel={() => setReadyNoWorkOpen(false)}
        confirmLoading={readyMutation.isPending}
        onConfirm={() => {
          setReadyNoWorkOpen(false);
          void runTransition(() => readyMutation.mutateAsync());
        }}
      />
      <ConfirmDialog
        open={undoReadyOpen}
        title={ordersLabels.actionUndoReady}
        description={ordersLabels.confirmUndoReady}
        onCancel={() => setUndoReadyOpen(false)}
        confirmLoading={undoReadyMutation.isPending}
        onConfirm={() => {
          setUndoReadyOpen(false);
          void runTransition(() => undoReadyMutation.mutateAsync());
        }}
      />
      <ConfirmDialog
        open={undoDeliverOpen}
        title={ordersLabels.actionUndoDeliver}
        description={ordersLabels.confirmUndoDeliver}
        destructive
        onCancel={() => setUndoDeliverOpen(false)}
        confirmLoading={undoDeliverReplay.isPending}
        onConfirm={() => {
          setUndoDeliverOpen(false);
          undoDeliverReplay.execute({});
        }}
      />
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
    </div>
  );
}

function DetailAmount({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: number;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 ${emphasized ? "border-border border-t pt-2" : ""}`}
    >
      <span
        className={
          emphasized ? "font-medium text-foreground text-sm" : "text-muted-foreground text-sm"
        }
      >
        {label}
      </span>
      <span
        className={`numeric-cell ${value < 0 ? "text-negative" : emphasized ? "font-semibold text-foreground" : "text-foreground"}`}
      >
        {formatMoney(toCentavos(value))}
      </span>
    </div>
  );
}

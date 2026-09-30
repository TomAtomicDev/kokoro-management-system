import type { ReceivablesGroupDto, ReceivablesSaleDto } from "@kokoro/shared";
import { formatMoney, toCentavos } from "@kokoro/shared";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { receivablesLabels } from "@/lib/i18n-receivables";
import { salesLabels } from "@/lib/i18n-sales";
import { cn } from "@/lib/utils";

export interface ReceivablesGroupsProps {
  groups: ReceivablesGroupDto[];
  onCollect: (sale: ReceivablesSaleDto) => void;
}

function formatBalance(amount: number): string {
  return formatMoney(toCentavos(amount));
}

function groupKey(group: ReceivablesGroupDto): string {
  return group.groupType === "NO_CUSTOMER" ? "no-customer" : group.customerId;
}

function SaleBalance({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/60 px-3 py-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="numeric-cell font-medium text-foreground text-sm">
        {formatBalance(amount)}
      </span>
    </div>
  );
}

function ReceivableSaleRow({
  sale,
  onCollect,
}: {
  sale: ReceivablesSaleDto;
  onCollect: (sale: ReceivablesSaleDto) => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            to="/sales"
            search={{ open: sale.saleId }}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {sale.code ?? receivablesLabels.saleCodeFallback}
          </Link>
          <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
            {salesLabels.channelLabels[sale.channel]}
          </span>
          {sale.customOrderId ? (
            <Link
              to="/orders"
              search={{ open: sale.customOrderId }}
              className="text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
            >
              {receivablesLabels.orderLink}
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <span>{receivablesLabels.age}:</span>
          <span className="numeric-cell font-medium text-foreground">
            {receivablesLabels.ageValue(sale.ageDays)}
          </span>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        {receivablesLabels.date}: <time dateTime={sale.occurredAt}>{sale.businessDate}</time>
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SaleBalance label={receivablesLabels.saleTotal} amount={sale.saleTotal} />
        <SaleBalance label={receivablesLabels.depositApplied} amount={sale.depositApplied} />
        <SaleBalance label={receivablesLabels.outstandingBalance} amount={sale.outstandingAmount} />
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 w-full sm:w-auto"
          onClick={() => onCollect(sale)}
        >
          {receivablesLabels.collectBalance}
        </Button>
      </div>
    </article>
  );
}

export function ReceivablesGroups({ groups, onCollect }: ReceivablesGroupsProps) {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(() => new Set());

  function toggleGroup(key: string): void {
    setExpandedGroupKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const key = groupKey(group);
        const expanded = expandedGroupKeys.has(key);
        const listId = `receivable-group-${key}`;
        const isNoCustomer = group.groupType === "NO_CUSTOMER";
        const title = isNoCustomer
          ? receivablesLabels.noCustomer
          : (group.customerName ?? receivablesLabels.customerFallback);

        return (
          <section
            key={key}
            className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
          >
            <h2>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={expanded ? listId : undefined}
                onClick={() => toggleGroup(key)}
                className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground text-sm">
                    {title}
                  </span>
                  <span className="block text-muted-foreground text-xs">
                    {receivablesLabels.customerSalesCount(group.pendingSaleCount)}
                    {isNoCustomer ? ` · ${receivablesLabels.noCustomerDescription}` : null}
                  </span>
                </span>
                {!isNoCustomer ? (
                  <span className="numeric-cell shrink-0 font-semibold text-foreground text-sm">
                    {formatBalance(group.outstandingTotal)}
                  </span>
                ) : null}
                <span className="shrink-0 text-muted-foreground text-xs">
                  {expanded ? receivablesLabels.hideSales : receivablesLabels.showSales}
                </span>
              </button>
            </h2>
            {expanded ? (
              <section
                id={listId}
                aria-label={`${title} · ${receivablesLabels.customerSalesCount(group.pendingSaleCount)}`}
                className="flex flex-col gap-2 border-border border-t p-3 sm:p-4"
              >
                {group.sales.map((sale) => (
                  <ReceivableSaleRow key={sale.saleId} sale={sale} onCollect={onCollect} />
                ))}
              </section>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

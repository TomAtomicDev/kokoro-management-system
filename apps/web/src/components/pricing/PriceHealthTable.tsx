// SC-12 table (KOK-036, Doc 07 SC-12, Doc 03 §4 C-5): every active FINISHED item, price vs both
// cost bases, the C-5 margins, the target-margin suggestion, and price staleness. Only
// `marginReplacement` — the anti-decapitalization figure — gets `MarginBadge`; `marginWac`
// ("margen histórico") is plain text, matching Doc 07's own distinction between the two columns.

import type { PriceHealthRowDto } from "@kokoro/shared";
import {
  formatMoney,
  toCentavos,
  toMilliCentavosPerUnit,
  totalCentavos,
  WHOLE_UNIT_MILLI_UNITS,
} from "@kokoro/shared";

import { EventTable, type EventTableColumn } from "@/components/data-table/EventTable";
import { MarginBadge } from "@/components/pricing/MarginBadge";
import { Button } from "@/components/ui/button";
import { pricingLabels } from "@/lib/i18n-pricing";

export interface PriceHealthTableProps {
  rows: PriceHealthRowDto[];
  minMarginPct: number;
  loading?: boolean;
  onUpdatePrice: (row: PriceHealthRowDto) => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return pricingLabels.never;
  return new Date(iso).toLocaleDateString("es-BO");
}

/** `salePriceMc`/`wacMc`/`replacementCostMc` are milli-centavo RATES per WHOLE unit (ADR-017),
 * not plain centavos — mirrors StockTable's identical `formatUnitCostMc` precedent. */
function formatRateMc(rateMc: number): string {
  return formatMoney(totalCentavos(toMilliCentavosPerUnit(rateMc), WHOLE_UNIT_MILLI_UNITS));
}

/** `null` covers both "no sale price yet" and "sale price is zero" (computePriceMargin's own
 * early-out) — either way there is nothing to badge. */
function MarginReplacementCell({
  row,
  minMarginPct,
}: {
  row: PriceHealthRowDto;
  minMarginPct: number;
}) {
  // A missing replacement cost (C-3 hasn't run yet for this item) would otherwise read as a
  // 100%-margin green badge — actively misleading, not merely absent data — so it gets its own
  // neutral state instead of falling through to the badge.
  if (row.replacementCostMc === 0) {
    return <span className="text-muted-foreground">{pricingLabels.costPending}</span>;
  }
  if (row.marginReplacement === null) {
    return <span className="text-muted-foreground">{pricingLabels.noPrice}</span>;
  }
  return (
    <MarginBadge
      pctBasisPoints={row.marginReplacement.pctBasisPoints}
      minMarginPct={minMarginPct}
    />
  );
}

export function PriceHealthTable({
  rows,
  minMarginPct,
  loading,
  onUpdatePrice,
}: PriceHealthTableProps) {
  const columns: EventTableColumn<PriceHealthRowDto>[] = [
    {
      id: "name",
      header: pricingLabels.columnName,
      cell: (row) => <span className="font-medium text-foreground">{row.name}</span>,
    },
    {
      id: "price",
      header: pricingLabels.columnPrice,
      numeric: true,
      cell: (row) =>
        row.salePriceMc === null
          ? pricingLabels.noPrice
          : formatMoney(totalCentavos(row.salePriceMc, WHOLE_UNIT_MILLI_UNITS)),
    },
    {
      id: "wac",
      header: pricingLabels.columnWac,
      numeric: true,
      cell: (row) => formatRateMc(row.wacMc),
    },
    {
      id: "replacementCost",
      header: pricingLabels.columnReplacementCost,
      numeric: true,
      cell: (row) => formatRateMc(row.replacementCostMc),
    },
    {
      id: "marginWac",
      header: pricingLabels.columnMarginWac,
      numeric: true,
      cell: (row) =>
        row.marginWac === null ? (
          <span className="text-muted-foreground">{pricingLabels.noPrice}</span>
        ) : (
          `${formatMoney(toCentavos(row.marginWac.amount))} (${(row.marginWac.pctBasisPoints / 100).toFixed(1)}%)`
        ),
    },
    {
      id: "marginReplacement",
      header: pricingLabels.columnMarginReplacement,
      numeric: true,
      cell: (row) => <MarginReplacementCell row={row} minMarginPct={minMarginPct} />,
    },
    {
      id: "priceSuggested",
      header: pricingLabels.columnSuggestedPrice,
      numeric: true,
      cell: (row) =>
        row.priceSuggested === null
          ? pricingLabels.noSuggestion
          : formatMoney(toCentavos(row.priceSuggested)),
    },
    {
      id: "lastPriceChangeAt",
      header: pricingLabels.columnLastChange,
      cell: (row) => formatDate(row.lastPriceChangeAt),
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onUpdatePrice(row);
          }}
        >
          {pricingLabels.updatePriceButton}
        </Button>
      ),
    },
  ];

  return (
    <EventTable
      columns={columns}
      rows={rows}
      getRowId={(row) => row.itemId}
      emptyMessage={pricingLabels.noItems}
      loading={loading}
      loadingMessage={pricingLabels.loading}
    />
  );
}

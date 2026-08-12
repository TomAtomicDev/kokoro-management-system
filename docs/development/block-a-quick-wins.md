# Block A — Quick Wins (KOK-104…120, KOK-152)

18 small-to-medium UI/UX fixes from the owner's first hands-on session (Phase 3.2 Block A,
`docs/development/acuerdos-prueba-usuario-1.md`). Most were unremarkable applications of existing
patterns; this collects the handful of decisions and new shared surfaces later tasks — especially
KOK-140 (the full-page form rework) and KOK-121+ (Block B, Presentation/Combo) — will want to reuse
rather than reinvent.

## New shared components other tasks should reuse

| Component | File | Built by | Reuse for |
| --- | --- | --- | --- |
| `PinnedSummaryFooter` | `apps/web/src/components/common/PinnedSummaryFooter.tsx` | KOK-112 | Any form needing a total/destination/warnings bar that stays visible while the body scrolls — KOK-140 explicitly needs this for Compra/Producción/Envasado/Pedido/Conteo. |
| `PaymentAccountSelect` | `apps/web/src/components/common/PaymentAccountSelect.tsx` | KOK-113 | Every future money-moving form (order confirm/deliver already migrated; a future Envasado/Armado session-cost payment, if one is ever added, should use this instead of two selectors). |
| `DateRangeFilter` + `getDefaultDateRange` | `apps/web/src/components/common/DateRangeFilter.tsx` | KOK-114 | Any new period-based list screen. |
| `InfoTooltip` | `apps/web/src/components/ui/tooltip.tsx` | KOK-108 | Any future explanatory-tooltip need — click-triggered/portaled, no dependency added (no shadcn/Radix tooltip primitive existed in this repo before this task, despite shadcn/ui having been initialized in KOK-003). |
| `DetailDrawer`'s `headerAction` prop | `apps/web/src/components/data-table/DetailDrawer.tsx` | KOK-110 | Any drawer needing a header-level affordance (icon button) next to the title. Additive/optional — every existing `DetailDrawer` caller is unaffected. |
| `useTheme` / `initializeTheme` | `apps/web/src/features/theme/use-theme.ts` | KOK-152 | The only `localStorage` usage in `apps/web` — the established pattern (defensive try/catch around storage access, matching `use-session-draft.ts`'s `sessionStorage` wrapper) for any future client-persisted preference. |
| `safeText(maxLength)` | `packages/shared/src/text.ts` | KOK-120 | Any new free-text Zod field — strips Unicode `Cc`/`Cf` control/invisible characters (preserving space/tab/newline), composed via `.pipe(safeText(N))`. |

## Decisions worth knowing about

**KOK-113 — payment method/account pairing has no Zod `.refine()`, service-layer only.**
`assertPaymentMethodMatchesAccountType` (`apps/worker/src/core/finance/accounts.ts`) is the single
enforcement point, called after `findActiveAccountRowOrThrow` resolves the account row, from sale
create/update, `collectPayment`, `confirmOrder`, and `deliverOrder`. No schema-level `.refine()`
exists because `accountId` alone can't reveal `account.type` without a database lookup — the schema
only knows the two fields were both supplied, not whether they're consistent. The web UI
(`PaymentAccountSelect`) makes a mismatch structurally unreachable from the browser, so the service
check is defense-in-depth for any future caller (e.g. a Telegram/AI capture path, Doc 08) that
doesn't go through this UI. `PAYMENT_METHOD_ACCOUNT_TYPES` (`packages/shared/src/enums.ts`) is the
one place the CASH↔CASH / BANK_QR↔BANK mapping lives — it's data-driven off `financial_accounts.type`,
not hardcoded against the two seeded account IDs/names, so a future third payment method or account
type only needs one map entry.

**KOK-114 — `v_waste` didn't get a migration; the query moved off the view instead.** The
view's month-locked `GROUP BY strftime('%Y-%m', business_date)` couldn't express an exact
day range, but rather than alter the view (a SQLite view swap that would've meant a
drop-view/create-view migration touching the same rebuild machinery as `0011_opening_in_movement_type.sql`),
`listWasteSummary` (`apps/worker/src/core/inventory/waste.ts`) now selects from `stock_exits`
directly with the *same* projection/formula the view uses (`SUM(CAST(ROUND(qty *
unit_cost_snapshot_mc / 1000000.0) AS INTEGER))`) and applies `business_date` bounds before the
aggregation. `v_waste` itself is untouched and still used elsewhere at month granularity — if a
future task needs day-range reads from a *different* aggregate view, this is the precedent: query
the base table with the view's own formula rather than reshape the view, when the view has other
consumers.

**KOK-114 also made `listOrders`' date filter mean creation date, not delivery date** — a real
behavior change (`apps/worker/src/core/orders/index.ts`, filters on `t.createdAt` now, was
`t.deliveryDate`), per agreements §A-3. `listOrdersFiltersSchema`'s `fromDate`/`toDate` doc comment
was updated to say so; nothing else reads that filter's semantics.

**Production form dirty-tracking (KOK-117/KOK-116).** `ProductionRunForm.tsx` consumption lines
now carry a stable `lineKey` (not array index) specifically so batches-driven recompute can tell
"still at its last auto-computed value" apart from "the owner typed something here" — a value is
only overwritten by a later `batches` edit if it still equals what was last auto-set
(`lineAutoQtyRef`/`actualOutputQtyAutoRef`) and hasn't been explicitly dirtied
(`dirtyLineKeysRef`/`actualOutputQtyDirtyRef`). Any future form with the same "recompute a prefilled
value unless the user already touched it" need (recipe-driven forms are the obvious candidate)
should copy this ref-pair pattern rather than a single boolean flag — a boolean can't distinguish
"recipe changed, recompute everything" from "one line got hand-edited, leave that one alone."

## Orchestration note (not business-relevant, but worth flagging)

Three tasks (the second grounding-report worker, KOK-110's revision, KOK-152's and KOK-118's first
`worker_done`) had their completion messages rejected by Orca's dispatch-lifecycle layer
(`dispatch_capability_invalid` / `unknown_dispatch`) despite the underlying work being complete and
correct — verified directly via `git diff` and manually closed. Task-list state and mailbox
delivery are not always in sync in this environment; when a worker reports done but the lifecycle
message is rejected, verify the actual file changes directly rather than assuming failure.

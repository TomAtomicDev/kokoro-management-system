import {
  type ItemKind,
  listAssembliesFiltersSchema,
  listOrdersFiltersSchema,
  listSalesFiltersSchema,
  listStockExitsFiltersSchema,
  listStockFiltersSchema,
} from "@kokoro/shared";
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { getDefaultDateRange } from "@/components/common/DateRangeFilter";
import type { EventTableSortDirection } from "@/components/data-table/EventTable";
import { AppShell } from "@/components/layout/AppShell";
import { GlobalErrorDialogProvider } from "@/components/ui/global-error-dialog";
import { fetchSession, sessionQueryKey } from "@/features/auth/api";
import { queryClient } from "@/lib/query-client";
import { AssemblyEditRoute, AssemblyRecordRoute } from "@/routes/assemblies";
import { AssistantRoute } from "@/routes/assistant";
import { FinanceRoute } from "@/routes/finance";
import { InventoryRoute } from "@/routes/inventory";
import { LoginRoute } from "@/routes/login";
import { OnboardingRoute } from "@/routes/onboarding";
import { OrdersRoute } from "@/routes/orders";
import { PackingRoute } from "@/routes/packing";
import { PackingDefinitionsRoute } from "@/routes/packing-definitions";
import { PanelRoute } from "@/routes/panel";
import { PriceHealthRoute } from "@/routes/price-health";
import { ProductionRoute } from "@/routes/production";
import { PurchaseEditRoute, PurchaseRecordRoute, PurchasesRoute } from "@/routes/purchases";
import { RecipesRoute } from "@/routes/recipes";
import { ReportsRoute } from "@/routes/reports";
import { SaleEditRoute, SaleRecordRoute, SalesRoute } from "@/routes/sales";
import { SessionsRoute } from "@/routes/sessions";
import { SettingsRoute } from "@/routes/settings";
import { SettingsAiRoute } from "@/routes/settings-ai";
import { SettingsBackupsRoute } from "@/routes/settings-backups";
import { SettingsCatalogRoute } from "@/routes/settings-catalog";

// Code-based routing (not file-based): the true root is bare (just an <Outlet/>, TanStack
// Router's default). Every screen except /login sits under `authenticatedRoute`, a pathless
// layout route (KOK-063, SC-18) that renders the persistent AppShell and gates on a session via
// `beforeLoad`. /login is a sibling of that layout, not a child — it must render without the
// sidebar/topbar chrome. See Doc 06 §2 for the nav tree this mirrors 1:1.
interface RouterContext {
  queryClient: QueryClient;
}

interface TableSortSearch {
  sort?: string;
  sortDirection?: EventTableSortDirection;
}

function parseTableSortSearch(search: Record<string, unknown>): TableSortSearch {
  return {
    sort: typeof search.sort === "string" && search.sort.length > 0 ? search.sort : undefined,
    sortDirection:
      search.sortDirection === "ascending" || search.sortDirection === "descending"
        ? search.sortDirection
        : undefined,
  };
}

interface SalesSearch extends TableSortSearch {
  fromDate?: string;
  toDate?: string;
  paymentStatus?: "PAID" | "ON_CREDIT";
}

interface OrdersSearch {
  fromDate?: string;
  toDate?: string;
}

interface PackingSearch {
  fromDate?: string;
  toDate?: string;
}

type InventoryTab = "stock" | "salidas" | "conteos";

interface InventorySearch extends TableSortSearch {
  fromDate?: string;
  toDate?: string;
  tab?: InventoryTab;
  kind?: ItemKind;
  lowStockOnly?: boolean;
  negativeOnly?: boolean;
}

type ProductionSearch = TableSortSearch;
type PurchasesSearch = TableSortSearch;
type FinanceSearch = TableSortSearch;
type CatalogSearch = TableSortSearch;

function dateRangeDefaults<T extends { fromDate?: string; toDate?: string }>(
  parsed: T,
): T & { fromDate: string; toDate: string } {
  const defaults = getDefaultDateRange();
  return {
    ...parsed,
    fromDate: parsed.fromDate ?? defaults.fromDate,
    toDate: parsed.toDate ?? defaults.toDate,
  };
}

// GlobalErrorDialogProvider renders a ConfirmDialog, which needs a RouterProvider ancestor
// (Dialog -> useUnsavedChangesGuard -> useBlocker). Mounting it here, as the root route's own
// component, keeps it inside the router tree and covers every route including /login — wrapping
// <RouterProvider> itself in main.tsx crashes on mount instead (KOK-171 follow-up fix).
function RootLayout() {
  return (
    <GlobalErrorDialogProvider>
      <Outlet />
    </GlobalErrorDialogProvider>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: RootLayout });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  // Loosely typed on purpose (no zod dependency here, D-10): just the one optional field the
  // _authenticated guard below writes when it redirects an unauthenticated visit.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: LoginRoute,
});

const authenticatedRoute = createRoute({
  id: "_authenticated",
  getParentRoute: () => rootRoute,
  component: AppShell,
  beforeLoad: async ({ context, location }) => {
    try {
      // ensureQueryData reuses a still-fresh cache entry (e.g. just seeded by useLogin, or by a
      // recent navigation) instead of re-checking the session on every route change.
      await context.queryClient.ensureQueryData({
        queryKey: sessionQueryKey,
        queryFn: fetchSession,
        retry: false,
      });
    } catch {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
});

const panelRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/",
  component: PanelRoute,
});

const salesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/sales",
  validateSearch: (search: Record<string, unknown>): SalesSearch => {
    const parsed = listSalesFiltersSchema.parse(search);
    const range = dateRangeDefaults(parsed);
    return {
      fromDate: range.fromDate,
      toDate: range.toDate,
      paymentStatus: parsed.paymentStatus,
      ...parseTableSortSearch(search),
    };
  },
  component: SalesRoute,
});

const salesRecordRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/sales/new",
  component: SaleRecordRoute,
});

const salesEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/sales/$saleId/edit",
  component: SaleEditRoute,
});

const ordersRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/orders",
  validateSearch: (search: Record<string, unknown>): OrdersSearch => {
    const parsed = listOrdersFiltersSchema.parse(search);
    const range = dateRangeDefaults(parsed);
    return { fromDate: range.fromDate, toDate: range.toDate };
  },
  component: OrdersRoute,
});

const productionRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/production",
  validateSearch: (search: Record<string, unknown>): ProductionSearch =>
    parseTableSortSearch(search),
  component: ProductionRoute,
});

const purchasesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/purchases",
  validateSearch: (search: Record<string, unknown>): PurchasesSearch =>
    parseTableSortSearch(search),
  component: PurchasesRoute,
});

const purchasesRecordRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/purchases/new",
  validateSearch: (search: Record<string, unknown>): { sessionId?: string } => ({
    sessionId: typeof search.sessionId === "string" ? search.sessionId : undefined,
  }),
  component: PurchaseRecordRoute,
});

const purchasesEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/purchases/$purchaseId/edit",
  component: PurchaseEditRoute,
});

// Sibling of productionRoute, NOT a nested child — /production stays a bare placeholder route
// (KOK-026 owns building the real nested Production layout later). Doc 06 §2's nav tree lists
// only one top-level "Producción" entry; recipes is reached from within that screen via a link
// card, not a second sidebar item (see nav-items.ts's AppPath union / primaryNav).
const productionRecipesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/production/recipes",
  component: RecipesRoute,
});

const packingRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/packing",
  validateSearch: (search: Record<string, unknown>): PackingSearch => {
    const parsed = listAssembliesFiltersSchema.parse(search);
    const range = dateRangeDefaults(parsed);
    return { fromDate: range.fromDate, toDate: range.toDate };
  },
  component: PackingRoute,
});

const packingRecordRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/packing/new",
  validateSearch: (search: Record<string, unknown>): { sessionId?: string } => ({
    sessionId: typeof search.sessionId === "string" ? search.sessionId : undefined,
  }),
  component: AssemblyRecordRoute,
});

const packingEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/packing/$assemblyId/edit",
  component: AssemblyEditRoute,
});

const packingDefinitionsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/packing/definitions",
  component: PackingDefinitionsRoute,
});

const inventoryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/inventory",
  validateSearch: (search: Record<string, unknown>): InventorySearch => {
    const parsed = listStockExitsFiltersSchema.parse(search);
    const stockFilters = listStockFiltersSchema.parse(search);
    const range = dateRangeDefaults(parsed);
    const tab = search.tab;
    const validTab: InventoryTab =
      tab === "salidas" || tab === "conteos" || tab === "stock" ? tab : "stock";
    return {
      fromDate: range.fromDate,
      toDate: range.toDate,
      tab: validTab,
      kind: stockFilters.kind,
      lowStockOnly: stockFilters.lowStockOnly,
      negativeOnly: stockFilters.negativeOnly,
      ...parseTableSortSearch(search),
    };
  },
  component: InventoryRoute,
});

const sessionsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/sessions",
  // `?open=<id>` deep-links straight into one session's detail drawer (KOK-027's own addition,
  // consumed by SessionsRoute via `getRouteApi("/sessions").useSearch()`) — the topbar SessionChip
  // uses this to jump right into the close-session flow for the one currently OPEN session,
  // mirroring loginRoute's `redirect` search param as the only other precedent for a validated
  // search param in this router. Loosely typed on purpose, same as loginRoute (no zod dependency
  // here, D-10).
  validateSearch: (
    search: Record<string, unknown>,
  ): { open?: string; view?: "list" | "calendar" } => ({
    open: typeof search.open === "string" ? search.open : undefined,
    view: search.view === "list" || search.view === "calendar" ? search.view : undefined,
  }),
  component: SessionsRoute,
});

const financeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/finance",
  validateSearch: (search: Record<string, unknown>): FinanceSearch => parseTableSortSearch(search),
  component: FinanceRoute,
});

const priceHealthRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/price-health",
  component: PriceHealthRoute,
});

const reportsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/reports",
  component: ReportsRoute,
});

const assistantRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/assistant",
  component: AssistantRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/settings",
  component: SettingsRoute,
});

const settingsAiRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/settings/ai",
  component: SettingsAiRoute,
});

const settingsCatalogRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/settings/catalog",
  validateSearch: (search: Record<string, unknown>): CatalogSearch => parseTableSortSearch(search),
  component: SettingsCatalogRoute,
});

const settingsBackupsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/settings/backups",
  component: SettingsBackupsRoute,
});

const onboardingRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/onboarding",
  component: OnboardingRoute,
});

const routeTree = rootRoute.addChildren([
  authenticatedRoute.addChildren([
    panelRoute,
    salesRoute,
    salesRecordRoute,
    salesEditRoute,
    ordersRoute,
    productionRoute,
    productionRecipesRoute,
    packingRoute,
    packingRecordRoute,
    packingEditRoute,
    packingDefinitionsRoute,
    purchasesRoute,
    purchasesRecordRoute,
    purchasesEditRoute,
    inventoryRoute,
    sessionsRoute,
    financeRoute,
    priceHealthRoute,
    reportsRoute,
    assistantRoute,
    settingsRoute,
    settingsAiRoute,
    settingsCatalogRoute,
    settingsBackupsRoute,
    onboardingRoute,
  ]),
  loginRoute,
]);

export const router = createRouter({ routeTree, context: { queryClient } });

// Register the router instance for type-safe `Link`/`useNavigate`/etc. across the app.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

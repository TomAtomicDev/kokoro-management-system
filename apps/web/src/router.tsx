import {
  type ItemKind,
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
  redirect,
} from "@tanstack/react-router";
import { getDefaultDateRange } from "@/components/common/DateRangeFilter";
import { AppShell } from "@/components/layout/AppShell";
import { fetchSession, sessionQueryKey } from "@/features/auth/api";
import { queryClient } from "@/lib/query-client";
import { AssistantRoute } from "@/routes/assistant";
import { FinanceRoute } from "@/routes/finance";
import { InventoryRoute } from "@/routes/inventory";
import { LoginRoute } from "@/routes/login";
import { OnboardingRoute } from "@/routes/onboarding";
import { OrdersRoute } from "@/routes/orders";
import { PanelRoute } from "@/routes/panel";
import { PriceHealthRoute } from "@/routes/price-health";
import { ProductionRoute } from "@/routes/production";
import { PurchasesRoute } from "@/routes/purchases";
import { RecipesRoute } from "@/routes/recipes";
import { ReportsRoute } from "@/routes/reports";
import { SalesRoute } from "@/routes/sales";
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

interface SalesSearch {
  fromDate?: string;
  toDate?: string;
  paymentStatus?: "PAID" | "ON_CREDIT";
}

interface OrdersSearch {
  fromDate?: string;
  toDate?: string;
}

type InventoryTab = "stock" | "salidas" | "conteos";

interface InventorySearch {
  fromDate?: string;
  toDate?: string;
  tab?: InventoryTab;
  kind?: ItemKind;
  lowStockOnly?: boolean;
  negativeOnly?: boolean;
}

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

const rootRoute = createRootRouteWithContext<RouterContext>()({});

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
    };
  },
  component: SalesRoute,
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
  component: ProductionRoute,
});

const purchasesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/purchases",
  component: PurchasesRoute,
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
    ordersRoute,
    productionRoute,
    productionRecipesRoute,
    purchasesRoute,
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

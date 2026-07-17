import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { AppShell } from "@/components/layout/AppShell";
import { AssistantRoute } from "@/routes/assistant";
import { FinanceRoute } from "@/routes/finance";
import { InventoryRoute } from "@/routes/inventory";
import { OnboardingRoute } from "@/routes/onboarding";
import { OrdersRoute } from "@/routes/orders";
import { PanelRoute } from "@/routes/panel";
import { PriceHealthRoute } from "@/routes/price-health";
import { ProductionRoute } from "@/routes/production";
import { PurchasesRoute } from "@/routes/purchases";
import { ReportsRoute } from "@/routes/reports";
import { SalesRoute } from "@/routes/sales";
import { SessionsRoute } from "@/routes/sessions";
import { SettingsRoute } from "@/routes/settings";
import { SettingsAiRoute } from "@/routes/settings-ai";
import { SettingsCatalogRoute } from "@/routes/settings-catalog";

// Code-based routing (not file-based): the root route renders the persistent AppShell, every
// other route is a flat child rendered into its <Outlet />. See Doc 06 §2 for the nav tree this
// mirrors 1:1.
const rootRoute = createRootRoute({
  component: AppShell,
});

const panelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: PanelRoute,
});

const salesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sales",
  component: SalesRoute,
});

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/orders",
  component: OrdersRoute,
});

const productionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/production",
  component: ProductionRoute,
});

const purchasesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/purchases",
  component: PurchasesRoute,
});

const inventoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inventory",
  component: InventoryRoute,
});

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions",
  component: SessionsRoute,
});

const financeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/finance",
  component: FinanceRoute,
});

const priceHealthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/price-health",
  component: PriceHealthRoute,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  component: ReportsRoute,
});

const assistantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/assistant",
  component: AssistantRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsRoute,
});

const settingsAiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/ai",
  component: SettingsAiRoute,
});

const settingsCatalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/catalog",
  component: SettingsCatalogRoute,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingRoute,
});

const routeTree = rootRoute.addChildren([
  panelRoute,
  salesRoute,
  ordersRoute,
  productionRoute,
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
  onboardingRoute,
]);

export const router = createRouter({ routeTree });

// Register the router instance for type-safe `Link`/`useNavigate`/etc. across the app.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

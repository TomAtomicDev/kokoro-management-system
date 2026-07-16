import {
  BarChart3,
  Bot,
  ClipboardList,
  Clock,
  Factory,
  LayoutDashboard,
  MessageSquare,
  Package,
  PlusCircle,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";

import { navLabels } from "@/lib/i18n-nav";

// Literal union of every route registered in `src/router.tsx` — kept in sync with the
// `path` passed to each `createRoute` call there. Declaring `to` as this union (rather than
// plain `string`) lets these data-driven `<Link to={entry.to}>` calls type-check against
// TanStack Router's generated route map without a type cast.
export type AppPath =
  | "/"
  | "/sales"
  | "/orders"
  | "/production"
  | "/purchases"
  | "/inventory"
  | "/sessions"
  | "/finance"
  | "/price-health"
  | "/reports"
  | "/assistant"
  | "/settings"
  | "/settings/ai"
  | "/settings/catalog";

export interface NavLinkItem {
  kind: "link";
  label: string;
  to: AppPath;
  icon: ComponentType<{ className?: string }>;
}

export interface NavActionItem {
  kind: "action";
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface NavDivider {
  kind: "divider";
  label: string;
}

export type NavEntry = NavLinkItem | NavActionItem | NavDivider;

// Exact nav tree from Doc 06 §2. Order matters — it drives both Sidebar and the mobile "Más" sheet.
export const primaryNav: NavEntry[] = [
  { kind: "link", label: navLabels.panel, to: "/", icon: LayoutDashboard },
  { kind: "action", label: navLabels.registrar, icon: PlusCircle },
  { kind: "divider", label: navLabels.sectionOperacion },
  { kind: "link", label: navLabels.ventas, to: "/sales", icon: ShoppingCart },
  { kind: "link", label: navLabels.pedidos, to: "/orders", icon: ClipboardList },
  { kind: "link", label: navLabels.produccion, to: "/production", icon: Factory },
  { kind: "link", label: navLabels.compras, to: "/purchases", icon: Truck },
  { kind: "link", label: navLabels.inventario, to: "/inventory", icon: Package },
  { kind: "link", label: navLabels.sesiones, to: "/sessions", icon: Clock },
  { kind: "divider", label: navLabels.sectionDinero },
  { kind: "link", label: navLabels.finanzas, to: "/finance", icon: Wallet },
  { kind: "divider", label: navLabels.sectionAnalisis },
  { kind: "link", label: navLabels.preciosYMargenes, to: "/price-health", icon: TrendingUp },
  { kind: "link", label: navLabels.reportes, to: "/reports", icon: BarChart3 },
  { kind: "link", label: navLabels.asistente, to: "/assistant", icon: MessageSquare },
];

// Pinned below the main nav list, per Doc 06 §2's "⚙ Configuración /settings · 🤖 IA Ops /settings/ai".
export const footerNav: NavLinkItem[] = [
  { kind: "link", label: navLabels.configuracion, to: "/settings", icon: Settings },
  { kind: "link", label: navLabels.iaOps, to: "/settings/ai", icon: Bot },
];

// The 5 items of the mobile bottom-tab bar (Doc 06 §2, "Mobile web").
export const mobileTabs: NavLinkItem[] = [
  { kind: "link", label: navLabels.panel, to: "/", icon: LayoutDashboard },
  { kind: "link", label: navLabels.ventas, to: "/sales", icon: ShoppingCart },
  { kind: "link", label: navLabels.inventario, to: "/inventory", icon: Package },
  { kind: "link", label: navLabels.finanzas, to: "/finance", icon: Wallet },
];

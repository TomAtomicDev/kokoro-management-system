// Spanish (es-BO) copy for the Dashboard screen (SC-01 reduced scope, KOK-023).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-finance.ts / i18n-inventory.ts.

export const dashboardLabels = {
  title: "Panel",
  subtitle: "Cómo está el negocio hoy.",

  // Doc 07 SC-01's exact labels for the two in-scope StatCards.
  cashTotal: "Caja total",
  cashBank: "Banco",
  cashCash: "Caja chica",
  stockValue: "Valor de inventario",

  // No glossary entry exists yet for "low stock" on the dashboard strip (judgment call): reuses
  // the same natural Spanish as the Inventory screen's own flag (i18n-inventory.ts's
  // `flagLowStock`), so the word is consistent wherever it appears rather than introducing a
  // second phrase for the same idea.
  lowStockTitle: "Stock bajo",
  lowStockViewAll: "Ver inventario",
  lowStockEmpty: "Todo el stock está en niveles normales.",

  quickAddTitle: "Registro rápido",
  quickAddSale: "Venta",
  quickAddPurchase: "Compra",
  quickAddExpense: "Gasto",
  quickAddProduction: "Producción",

  loading: "Cargando…",
} as const;

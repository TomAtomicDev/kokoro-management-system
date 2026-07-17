// Spanish (es-BO) copy for the Inventory screen (SC-08): Stock tab (KOK-017 frontend), Salidas
// tab (KOK-018 frontend, UC-09/SC-08 "costo invisible"), and Conteos tab (KOK-019 frontend,
// UC-10 physical inventory counts).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-finance.ts / i18n-catalog.ts.

import type {
  InventoryCountStatus,
  ItemCategory,
  ItemKind,
  StockExitReason,
  StockMovementType,
  Unit,
} from "@kokoro/shared";

export const inventoryLabels = {
  title: "Inventario",
  subtitle: "Stock actual, alertas y movimientos por ítem.",

  tabStock: "Stock",
  tabSalidas: "Salidas",
  tabConteos: "Conteos",

  comingSoonSalidas: "Registro de salidas — próximamente.",

  // `satisfies Record<Enum, string>` guarantees every enum member has a translation — a missing
  // case fails `tsc`, not a blank cell at runtime (same precedent as i18n-finance.ts).
  kindLabels: {
    RAW_MATERIAL: "Materia prima",
    SEMI_FINISHED: "Semielaborado",
    FINISHED: "Producto final",
  } satisfies Record<ItemKind, string>,
  categoryLabels: {
    INGREDIENT: "Ingrediente",
    PACKAGING: "Empaque",
    LABEL: "Etiqueta",
    BAKERY: "Panadería",
    DAIRY: "Lácteo",
    OTHER: "Otro",
  } satisfies Record<ItemCategory, string>,
  unitAbbrev: {
    G: "g",
    KG: "kg",
    ML: "ml",
    L: "l",
    UNIT: "u",
  } satisfies Record<Unit, string>,

  movementTypeLabels: {
    PURCHASE_IN: "Compra",
    PRODUCTION_IN: "Producción (entrada)",
    PRODUCTION_OUT: "Producción (consumo)",
    SALE_OUT: "Venta",
    EXIT_OUT: "Salida",
    ADJUST: "Ajuste",
  } satisfies Record<StockMovementType, string>,

  // Stock table columns.
  columnName: "Ítem",
  columnKind: "Tipo",
  columnCategory: "Categoría",
  columnUnit: "Unidad",
  columnOnHand: "En stock",
  columnMinStock: "Stock mínimo",
  columnWac: "Costo promedio",
  columnReplacementCost: "Costo de reposición",
  columnStockValue: "Valor de inventario",

  flagLowStock: "Stock bajo",
  flagNegative: "Negativo",

  filterLowStockOnly: "Solo bajo stock",
  filterNegativeOnly: "Solo negativo",
  filterKindAll: "Todos los tipos",

  noStock: "No hay ítems que coincidan con el filtro.",
  loading: "Cargando…",
  calculated: "calculado",
  stockValueFormula: "cantidad en stock × costo promedio ponderado",

  // Kardex drawer.
  kardexTitlePrefix: "Kardex",
  kardexColumnDate: "Fecha",
  kardexColumnType: "Tipo",
  kardexColumnQty: "Cantidad",
  kardexColumnUnitCost: "Costo unitario",
  kardexColumnTotalCost: "Costo total",
  kardexColumnBalance: "Saldo",
  kardexColumnSource: "Origen",
  noMovements: "No hay movimientos registrados para este ítem.",

  sourceEventLabels: {
    purchase: "Compra",
  } as Record<string, string>,

  // --- Salidas tab (KOK-018) ---------------------------------------------------------------

  reasonLabels: {
    WASTE: "Merma",
    SELF_CONSUMPTION: "Autoconsumo",
    GIFT_SAMPLE: "Regalo / muestra",
    SPOILAGE: "Deterioro",
    OTHER: "Otro",
  } satisfies Record<StockExitReason, string>,

  recordExitTitle: "Registrar salida",
  recordExitButton: "Registrar salida",

  fieldItem: "Ítem",
  fieldQty: "Cantidad",
  fieldReason: "Motivo",
  fieldDate: "Fecha",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",

  submitExit: "Registrar salida",
  cancel: "Cancelar",

  errors: {
    itemRequired: "Selecciona un ítem.",
    invalidQty: "La cantidad debe ser un número mayor a 0.",
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
  },

  exitsColumnDate: "Fecha",
  exitsColumnItem: "Ítem",
  exitsColumnQty: "Cantidad",
  exitsColumnReason: "Motivo",
  exitsColumnValuedCost: "Costo valorado",
  noExits: "No hay salidas registradas.",

  wasteSummaryTitle: "Costo invisible del mes",
  wasteSummaryTotalLabel: "Total del mes",
  wasteSummaryByReasonLabel: "Por motivo",
  wasteSummaryEmpty: "Sin salidas este mes.",

  // --- Conteos tab (KOK-019) --------------------------------------------------------------

  countStatusLabels: {
    DRAFT: "Borrador",
    COMMITTED: "Confirmado",
  } satisfies Record<InventoryCountStatus, string>,

  newCountButton: "Nuevo conteo",
  startCountTitle: "Nuevo conteo",
  startCountSubmit: "Iniciar conteo",

  fieldCountKind: "Tipo",
  fieldCountCategory: "Categoría",
  filterCategoryAll: "Todas las categorías",

  countsColumnDate: "Fecha",
  countsColumnStatus: "Estado",
  countsColumnLines: "Ítems",
  countsColumnVariance: "Con variación",
  noCounts: "No hay conteos registrados.",

  countDetailTitlePrefix: "Conteo",
  countColumnItem: "Ítem",
  countColumnExpected: "Esperado",
  countColumnCounted: "Contado",
  countColumnDelta: "Variación",
  noCountLines: "Este conteo no tiene ítems.",

  confirmCountButton: "Confirmar conteo",
  confirmCountDialogTitle: "Confirmar conteo",
  confirmCountSummaryIntro: "Se registrarán los siguientes ajustes de inventario:",
  confirmCountNoVariance: "No hay variaciones — el conteo coincide con el stock esperado.",
  confirmCountBack: "Volver",
  confirmCountSubmit: "Confirmar y ajustar stock",
} as const;

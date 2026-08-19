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

  // `satisfies Record<Enum, string>` guarantees every enum member has a translation â€” a missing
  // case fails `tsc`, not a blank cell at runtime (same precedent as i18n-finance.ts).
  kindLabels: {
    RAW_MATERIAL: "Materia prima",
    SEMI_FINISHED: "Semielaborado",
    FINISHED: "Producto final",
    PACKAGING: "Empaque",
  } satisfies Record<ItemKind, string>,
  categoryLabels: {
    INGREDIENT: "Ingrediente",
    NOT_EATABLE: "No comestible",
    BAKERY: "Panadería",
    DAIRY: "Lácteo",
    PASTRY: "Pastelería",
    OTHER: "Otro",
  } satisfies Record<ItemCategory, string>,
  unitAbbrev: {
    KG: "kg",
    L: "L",
    UNIT: "u",
    M: "m",
  } satisfies Record<Unit, string>,

  movementTypeLabels: {
    OPENING_IN: "Stock inicial",
    PURCHASE_IN: "Compra",
    PRODUCTION_IN: "Producción (entrada)",
    PRODUCTION_OUT: "Producción (consumo)",
    SALE_OUT: "Venta",
    EXIT_OUT: "Salida",
    ADJUST: "Ajuste",
    ASSEMBLY_IN: "Envasado/Armado (entrada)",
    ASSEMBLY_OUT: "Envasado/Armado (consumo)",
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
  dateRangeFrom: "Desde",
  dateRangeTo: "Hasta",

  noStock: "No hay ítems que coincidan con el filtro.",
  loading: "Cargando…",
  calculated: "calculado",
  stockValueFormula: "cantidad en stock × costo promedio ponderado",

  // --- Replacement-cost refresh (KOK-029, Doc 03 Â§4 C-3) -----------------------------------
  refreshReplacementCostsButton: "Recalcular costos de reposición",
  /** `count` is `ReplacementCostRefreshResultDto.refreshedItemIds.length`. */
  replacementCostMcRefreshSuccess: (count: number) =>
    count === 1
      ? "Se actualizó el costo de reposición de 1 ítem."
      : `Se actualizaron los costos de reposición de ${count} ítems.`,

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

  fieldExitKind: "Tipo de ítem",
  fieldItem: "Ítem",
  itemPickerEmpty: "No hay ítems medibles disponibles para registrar una salida.",
  fieldQty: "Cantidad",
  fieldReason: "Motivo",
  fieldDate: "Fecha",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",
  packagingLinesTitle: "Empaque adicional",
  packagingLinesDescription: "Agrégalo solo si este ítem sale sin una presentación ya armada.",
  packagingLineItem: "Ítem de empaque",
  packagingLineQty: "Cantidad",
  addPackagingLine: "Agregar empaque",
  removePackagingLine: "Quitar empaque",

  submitExit: "Registrar salida",
  cancel: "Cancelar",

  errors: {
    itemRequired: "Selecciona un ítem.",
    invalidQty: "La cantidad debe ser un número mayor a 0.",
    invalidPackagingLine: "Completa cada línea de empaque con un ítem y una cantidad mayor a 0.",
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
  },

  exitsColumnCode: "Código",
  exitsColumnDate: "Fecha",
  exitsColumnItem: "Ítem",
  exitsColumnQty: "Cantidad",
  exitsColumnReason: "Motivo",
  exitsColumnValuedCost: "Costo valorado",
  noExits: "No hay salidas registradas.",

  wasteSummaryTitle: "Costo invisible del periodo",
  wasteSummaryTotalLabel: "Total del periodo",
  wasteSummaryByReasonLabel: "Por motivo",
  wasteSummaryEmpty: "Sin salidas en este periodo.",

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

  countsColumnCode: "Código",
  countsColumnDate: "Fecha",
  countsColumnStatus: "Estado",
  countsColumnLines: "Ítems",
  countsColumnVariance: "Con variación",
  noCounts: "No hay conteos registrados.",

  countDetailTitlePrefix: "Conteo",
  countColumnItem: "Ítem",
  countColumnExpected: "Esperado",
  countColumnCounted: "Stock inicial",
  countColumnDelta: "Variación",
  noCountLines: "Este conteo no tiene ítems.",

  confirmCountButton: "Confirmar conteo",
  confirmCountDialogTitle: "Confirmar conteo",
  confirmCountSummaryIntro: "Se registrarán los siguientes ajustes de inventario:",
  confirmCountNoVariance: "No hay variaciones — el conteo coincide con el stock esperado.",
  confirmCountBack: "Volver",
  confirmCountSubmit: "Confirmar y ajustar stock",

  // --- Edit / delete / restore de salidas (KOK-024 Phase G) ----------------------------------

  editExit: "Editar",
  deleteExit: "Eliminar",
  /** ExitForm's dialog header + submit button when it's editing an existing exit rather than
   * creating a new one. */
  editExitTitle: "Editar salida",
  saveExitChanges: "Guardar cambios",
  exitDetailTitle: "Salida",
  noExitNotes: "Sin notas.",
  /** Doc 06 principle 6: an ordinary delete gets no confirm-dialog wall, only the toast below. */
  exitDeletedUndo: "Salida eliminada.",
  undoExit: "Deshacer",
  restoreExitFailed: "No se pudo deshacer la eliminación. Intenta de nuevo.",

  /** ImpactConfirmDialog copy â€” only shown when the server refuses with
   * REPLAY_CONFIRMATION_REQUIRED (a backdated edit/delete that moves already-booked cost). */
  impactEditExitTitle: "¿Guardar los cambios?",
  impactEditExitDescription:
    "Esta salida tiene una fecha anterior a movimientos ya registrados de este ítem. Guardar los cambios recalculará el costo de esos movimientos.",
  impactDeleteExitTitle: "¿Eliminar esta salida?",
  impactDeleteExitDescription:
    "Esta salida tiene una fecha anterior a movimientos ya registrados de este ítem. Eliminarla recalculará el costo de esos movimientos.",
  /** Shown only if "Deshacer" itself comes back with REPLAY_CONFIRMATION_REQUIRED â€” restoring a
   * backdated exit re-weights C-1 for every later entry of that item exactly like create/edit. */
  impactRestoreExitTitle: "¿Deshacer esta eliminación?",
  impactRestoreExitDescription:
    "Esta salida tiene una fecha anterior a movimientos ya registrados de este ítem. Deshacer la eliminación recalculará el costo de esos movimientos.",

  /** KOK-065: shown when a genuinely backdated NEW exit trips the same R-5 gate a backdated edit
   * does (INV-11 on create) â€” closes the dead-end where this refusal had no confirm path. */
  impactCreateExitTitle: "¿Registrar esta salida?",
  impactCreateExitDescription:
    "Esta salida tiene una fecha anterior a movimientos ya registrados de este ítem. Registrarla recalculará el costo de esos movimientos.",
} as const;

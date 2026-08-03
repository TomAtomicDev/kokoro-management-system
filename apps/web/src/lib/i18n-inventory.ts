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
  subtitle: "Stock actual, alertas y movimientos por Ã­tem.",

  tabStock: "Stock",
  tabSalidas: "Salidas",
  tabConteos: "Conteos",

  comingSoonSalidas: "Registro de salidas â€” prÃ³ximamente.",

  // `satisfies Record<Enum, string>` guarantees every enum member has a translation â€” a missing
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
    BAKERY: "PanaderÃ­a",
    DAIRY: "LÃ¡cteo",
    OTHER: "Otro",
  } satisfies Record<ItemCategory, string>,
  unitAbbrev: {
    G: "g",
    KG: "kg",
    ML: "ml",
    L: "L",
    UNIT: "u",
  } satisfies Record<Unit, string>,

  movementTypeLabels: {
    OPENING_IN: "Stock inicial",
    PURCHASE_IN: "Compra",
    PRODUCTION_IN: "ProducciÃ³n (entrada)",
    PRODUCTION_OUT: "ProducciÃ³n (consumo)",
    SALE_OUT: "Venta",
    EXIT_OUT: "Salida",
    ADJUST: "Ajuste",
  } satisfies Record<StockMovementType, string>,

  // Stock table columns.
  columnName: "Ãtem",
  columnKind: "Tipo",
  columnCategory: "CategorÃ­a",
  columnUnit: "Unidad",
  columnOnHand: "En stock",
  columnMinStock: "Stock mÃ­nimo",
  columnWac: "Costo promedio",
  columnReplacementCost: "Costo de reposiciÃ³n",
  columnStockValue: "Valor de inventario",

  flagLowStock: "Stock bajo",
  flagNegative: "Negativo",

  filterLowStockOnly: "Solo bajo stock",
  filterNegativeOnly: "Solo negativo",
  filterKindAll: "Todos los tipos",

  noStock: "No hay Ã­tems que coincidan con el filtro.",
  loading: "Cargandoâ€¦",
  calculated: "calculado",
  stockValueFormula: "cantidad en stock Ã— costo promedio ponderado",

  // --- Replacement-cost refresh (KOK-029, Doc 03 Â§4 C-3) -----------------------------------
  refreshReplacementCostsButton: "Recalcular costos de reposiciÃ³n",
  /** `count` is `ReplacementCostRefreshResultDto.refreshedItemIds.length`. */
  replacementCostMcRefreshSuccess: (count: number) =>
    count === 1
      ? "Se actualizÃ³ el costo de reposiciÃ³n de 1 Ã­tem."
      : `Se actualizaron los costos de reposiciÃ³n de ${count} Ã­tems.`,

  // Kardex drawer.
  kardexTitlePrefix: "Kardex",
  kardexColumnDate: "Fecha",
  kardexColumnType: "Tipo",
  kardexColumnQty: "Cantidad",
  kardexColumnUnitCost: "Costo unitario",
  kardexColumnTotalCost: "Costo total",
  kardexColumnBalance: "Saldo",
  kardexColumnSource: "Origen",
  noMovements: "No hay movimientos registrados para este Ã­tem.",

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

  fieldItem: "Ãtem",
  fieldQty: "Cantidad",
  fieldReason: "Motivo",
  fieldDate: "Fecha",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",

  submitExit: "Registrar salida",
  cancel: "Cancelar",

  errors: {
    itemRequired: "Selecciona un Ã­tem.",
    invalidQty: "La cantidad debe ser un nÃºmero mayor a 0.",
    generic: "OcurriÃ³ un error inesperado. Intenta de nuevo.",
  },

  exitsColumnDate: "Fecha",
  exitsColumnItem: "Ãtem",
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
  fieldCountCategory: "CategorÃ­a",
  filterCategoryAll: "Todas las categorÃ­as",

  countsColumnDate: "Fecha",
  countsColumnStatus: "Estado",
  countsColumnLines: "Ãtems",
  countsColumnVariance: "Con variaciÃ³n",
  noCounts: "No hay conteos registrados.",

  countDetailTitlePrefix: "Conteo",
  countColumnItem: "Ãtem",
  countColumnExpected: "Esperado",
  countColumnCounted: "Contado",
  countColumnDelta: "VariaciÃ³n",
  noCountLines: "Este conteo no tiene Ã­tems.",

  confirmCountButton: "Confirmar conteo",
  confirmCountDialogTitle: "Confirmar conteo",
  confirmCountSummaryIntro: "Se registrarÃ¡n los siguientes ajustes de inventario:",
  confirmCountNoVariance: "No hay variaciones â€” el conteo coincide con el stock esperado.",
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
  restoreExitFailed: "No se pudo deshacer la eliminaciÃ³n. Intenta de nuevo.",

  /** ImpactConfirmDialog copy â€” only shown when the server refuses with
   * REPLAY_CONFIRMATION_REQUIRED (a backdated edit/delete that moves already-booked cost). */
  impactEditExitTitle: "Â¿Guardar los cambios?",
  impactEditExitDescription:
    "Esta salida tiene una fecha anterior a movimientos ya registrados de este Ã­tem. Guardar los cambios recalcularÃ¡ el costo de esos movimientos.",
  impactDeleteExitTitle: "Â¿Eliminar esta salida?",
  impactDeleteExitDescription:
    "Esta salida tiene una fecha anterior a movimientos ya registrados de este Ã­tem. Eliminarla recalcularÃ¡ el costo de esos movimientos.",
  /** Shown only if "Deshacer" itself comes back with REPLAY_CONFIRMATION_REQUIRED â€” restoring a
   * backdated exit re-weights C-1 for every later entry of that item exactly like create/edit. */
  impactRestoreExitTitle: "Â¿Deshacer esta eliminaciÃ³n?",
  impactRestoreExitDescription:
    "Esta salida tiene una fecha anterior a movimientos ya registrados de este Ã­tem. Deshacer la eliminaciÃ³n recalcularÃ¡ el costo de esos movimientos.",

  /** KOK-065: shown when a genuinely backdated NEW exit trips the same R-5 gate a backdated edit
   * does (INV-11 on create) â€” closes the dead-end where this refusal had no confirm path. */
  impactCreateExitTitle: "Â¿Registrar esta salida?",
  impactCreateExitDescription:
    "Esta salida tiene una fecha anterior a movimientos ya registrados de este Ã­tem. Registrarla recalcularÃ¡ el costo de esos movimientos.",
} as const;

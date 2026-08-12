// Spanish (es-BO) copy for the Production screen (SC-05, KOK-026): ProductionRunForm,
// ProductionRunsTable, ProductionRunDetailDrawer, and the Producción hub route itself.
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-purchases.ts / i18n-recipes.ts.

import type { Unit } from "@kokoro/shared";

export const productionLabels = {
  title: "Producción",
  subtitle: "Registra tandas de producción, su consumo de insumos y el costo resultante.",
  actionRecord: "Nueva producción",
  /** Secondary link kept on this screen — Recetas has no other nav entry (Doc 06 §2 lists only one
   * top-level "Producción" item). */
  goToRecipes: "Ver recetas",

  columnDate: "Fecha",
  columnRecipe: "Receta",
  columnBatches: "Tandas",
  columnYield: "Rendimiento",
  columnTotalCost: "Costo total",
  columnUnitCost: "Costo unitario",
  columnSession: "Sesión",
  columnOrder: "Pedido",

  unknownRecipe: "—",
  noProductionRuns: "No hay producciones registradas.",
  loading: "Cargando…",

  recordTitle: "Nueva producción",
  editTitle: "Editar producción",
  fieldRecipe: "Receta",
  recipePlaceholder: "Selecciona una receta",
  fieldBatches: "Tandas",
  fieldDate: "Fecha",
  fieldActualOutputQty: "Salida real",
  fieldIndirectCost: "Costo indirecto estimado (Bs)",
  tooltipIndirectCost:
    "Es un costo estimado: no genera ningún movimiento financiero y se usa únicamente para calcular el costo del producto.",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",

  linesTitle: "Insumos consumidos",
  lineItem: "Insumo",
  lineQty: "Cantidad",
  addLine: "Agregar insumo",
  removeLine: "Quitar insumo",
  lineContribution: "Aporte al costo",
  lineStockSufficient: "Stock suficiente",
  lineStockInsufficient: "Stock insuficiente",
  unitCostLabel: "Costo unitario",

  save: "Guardar",
  cancel: "Cancelar",
  submit: "Registrar producción",

  costPanelTitle: "Costo de la producción",
  costDirectLabel: "Costo directo",
  costDirectFormula: "Σ(cantidad consumida × costo promedio ponderado del insumo)",
  costIndirectLabel: "Costo indirecto estimado",
  costTotalLabel: "Costo total",
  costTotalFormula: "costo directo + costo indirecto",
  costUnitLabel: "Costo unitario",
  costUnitFormula: "costo total ÷ salida real",

  detailTitle: "Producción",
  detailLines: "Insumos consumidos",
  detailRecipe: "Receta",
  detailBatches: "Tandas",
  detailOutputItem: "Ítem de salida",
  detailActualOutput: "Salida real",
  detailDirectCost: "Costo directo",
  detailIndirectCost: "Costo indirecto",
  detailAllocatedCost: "Costo asignado de sesión",
  detailTotalCost: "Costo total",
  detailUnitCost: "Costo unitario",
  noNotes: "Sin notas.",

  /** Abbreviation for the "/ kg" style suffix — mirrors purchasesLabels.unitAbbrev. */
  unitAbbrev: {
    KG: "kg",
    L: "L",
    UNIT: "u",
    M: "m",
  } satisfies Record<Unit, string>,

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidLine: "Cada insumo necesita un ítem y una cantidad válida.",
    recipeRequired: "Selecciona una receta.",
    batchesInvalid: "Ingresa un número de tandas válido (mayor a cero).",
    outputQtyInvalid: "Ingresa una salida real válida (mayor a cero).",
  },

  // --- Edit / delete / restore -----------------------------------------------------------------

  edit: "Editar",
  delete: "Eliminar",
  /** Doc 06 principle 6: an ordinary delete gets no confirm-dialog wall, only the toast below. */
  deletedUndo: "Producción eliminada.",
  undo: "Deshacer",
  restoreFailed: "No se pudo deshacer la eliminación. Intenta de nuevo.",

  /** ImpactConfirmDialog copy — only shown when the server refuses with
   * REPLAY_CONFIRMATION_REQUIRED (a backdated edit/delete that moves already-booked cost). */
  impactEditTitle: "¿Guardar los cambios?",
  impactEditDescription:
    "Esta producción tiene una fecha anterior a movimientos ya registrados de sus insumos o su ítem de salida. Guardar los cambios recalculará el costo de esos movimientos.",
  impactDeleteTitle: "¿Eliminar esta producción?",
  impactDeleteDescription:
    "Esta producción tiene una fecha anterior a movimientos ya registrados de sus insumos o su ítem de salida. Eliminarla recalculará el costo de esos movimientos.",
  /** Restore's own R-5 edge case: something else happened to the item(s) between the delete and
   * the "Deshacer" click, so undoing the delete itself now moves already-booked cost. */
  impactRestoreTitle: "¿Deshacer la eliminación?",
  impactRestoreDescription:
    "Esta producción tiene una fecha anterior a movimientos ya registrados de sus insumos o su ítem de salida. Deshacer la eliminación recalculará el costo de esos movimientos.",
} as const;

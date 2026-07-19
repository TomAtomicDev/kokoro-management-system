// Spanish (es-BO) copy for the Purchases screen (SC-07, UC-01), PurchaseForm, PurchasesTable, and
// PurchaseDetailDrawer.
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-catalog.ts / i18n-finance.ts.

import type { Unit } from "@kokoro/shared";

export const purchasesLabels = {
  title: "Compras",
  subtitle: "Registra compras de insumos, con recibo y aviso de subida de precios.",
  actionRecord: "Registrar compra",

  columnDate: "Fecha",
  columnSupplier: "Proveedor",
  columnItems: "Ítems",
  columnTotal: "Total",
  columnAccount: "Cuenta",
  columnPhoto: "Recibo",

  noSupplier: "—",
  itemsSummaryMore: (count: number) => `y ${count} más`,
  noPurchases: "No hay compras registradas.",
  loading: "Cargando…",

  recordTitle: "Registrar compra",
  fieldSupplier: "Proveedor",
  supplierPlaceholder: "Opcional",
  fieldAccount: "Cuenta",
  fieldDate: "Fecha",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",
  fieldPhoto: "Foto del recibo",
  photoUploading: "Subiendo…",
  photoReady: "Foto lista ✓",

  linesTitle: "Líneas de compra",
  lineItem: "Ítem",
  lineQty: "Cantidad",
  lineTotal: "Total de línea (Bs)",
  addLine: "Agregar línea",
  removeLine: "Quitar línea",
  unitCostLabel: "Costo unitario",
  vsReplacementCost: "vs. costo de reposición anterior",

  save: "Guardar",
  cancel: "Cancelar",
  submit: "Registrar compra",

  detailTitle: "Compra",
  detailLines: "Líneas",
  detailPhoto: "Recibo",
  viewPhoto: "Ver / descargar",
  noNotes: "Sin notas.",

  /** Abbreviation for the "/ kg" style suffix on unit-cost figures — mirrors ItemForm's private
   * UNIT_ABBREV map, exported here so both PurchaseForm and PurchaseDetailDrawer share one copy. */
  unitAbbrev: {
    G: "g",
    KG: "kg",
    ML: "ml",
    L: "l",
    UNIT: "u",
  } satisfies Record<Unit, string>,

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidLine: "Cada línea necesita un ítem, una cantidad y un total válidos.",
    accountRequired: "Selecciona una cuenta.",
    photoUploadFailed: "No se pudo subir la foto del recibo. Intenta de nuevo.",
  },

  // --- Edit / delete / restore (KOK-024 Phase G) ---------------------------------------------

  edit: "Editar",
  delete: "Eliminar",
  /** Doc 06 principle 6: an ordinary delete gets no confirm-dialog wall, only the toast below. */
  deletedUndo: "Compra eliminada.",
  undo: "Deshacer",
  restoreFailed: "No se pudo deshacer la eliminación. Intenta de nuevo.",

  /** ImpactConfirmDialog copy — only shown when the server refuses with
   * REPLAY_CONFIRMATION_REQUIRED (a backdated edit/delete that moves already-booked cost). */
  impactEditTitle: "¿Guardar los cambios?",
  impactEditDescription:
    "Esta compra tiene una fecha anterior a movimientos ya registrados de sus ítems. Guardar los cambios recalculará el costo de esos movimientos.",
  impactDeleteTitle: "¿Eliminar esta compra?",
  impactDeleteDescription:
    "Esta compra tiene una fecha anterior a movimientos ya registrados de sus ítems. Eliminarla recalculará el costo de esos movimientos.",
} as const;

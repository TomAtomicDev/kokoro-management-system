// Spanish (es-BO) copy for the Sales screen (SC-02, UC-03/UC-04), SaleForm, SalesTable,
// CollectPaymentDialog, and SaleDetailDrawer.
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-purchases.ts / i18n-finance.ts.
//
// Scope note: KOK-030 shipped CREATE + READ only. KOK-031 added the "cobrar" (collectPayment)
// copy below. KOK-064 adds "editar"/"eliminar"/restore + impact-confirm copy, mirroring
// i18n-purchases.ts's KOK-024 Phase G additions.

import type { PaymentMethod, PaymentStatus } from "@kokoro/shared";

export const salesLabels = {
  title: "Ventas",
  subtitle: "Registra ventas del catálogo, al contado o por cobrar.",
  actionRecord: "Nueva venta",

  columnDate: "Fecha",
  columnChannel: "Canal",
  columnCustomer: "Cliente",
  columnItems: "Ítems",
  columnTotal: "Total",
  columnMargin: "Margen",
  columnStatus: "Estado",
  columnMethod: "Método",

  noCustomer: "—",
  itemsSummaryMore: (count: number) => `y ${count} más`,
  noSales: "No hay ventas registradas.",
  loading: "Cargando…",

  filterAll: "Todas",
  filterReceivable: "Por cobrar",

  channelLabels: {
    CATALOG: "Catálogo",
    CUSTOM_ORDER: "Pedido",
  } as const,

  paymentStatusLabels: {
    PAID: "Pagado",
    ON_CREDIT: "Por cobrar",
  } satisfies Record<PaymentStatus, string>,

  paymentMethodLabels: {
    CASH: "Efectivo",
    BANK_QR: "QR / transferencia",
  } satisfies Record<PaymentMethod, string>,

  recordTitle: "Nueva venta",
  fieldPaymentStatus: "Estado de pago",
  fieldPaymentMethod: "Método de pago",
  fieldAccount: "Cuenta",
  fieldCustomer: "Cliente",
  fieldDate: "Fecha",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",

  linesTitle: "Líneas de venta",
  lineItem: "Ítem",
  lineQty: "Cantidad",
  lineUnitPrice: "Precio unitario (Bs)",
  addLine: "Agregar línea",
  removeLine: "Quitar línea",
  lineSubtotal: "Subtotal",

  totalPreviewLabel: "Total estimado",

  warnings: {
    /** INV-8: this line's (aggregated-by-item) qty would take the item's on-hand stock negative. */
    negativeStock: "El stock quedaría negativo.",
    /** C-5: this line's unit price is below the item's stored replacement cost. */
    belowReplacementCost: "Precio por debajo del costo de reposición.",
  },

  save: "Guardar",
  cancel: "Cancelar",
  submit: "Registrar venta",

  detailTitle: "Venta",
  detailLines: "Líneas",
  noNotes: "Sin notas.",

  columnDaysOutstanding: "Días",
  daysOutstandingValue: (days: number) => `${days} d`,
  actionCollect: "Cobrar",
  collectTitle: "Cobrar venta",
  collectSubmit: "Confirmar cobro",

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidLine: "Cada línea necesita un ítem, una cantidad y un precio unitario válidos.",
    accountRequired: "Selecciona una cuenta.",
  },

  // --- Edit / delete / restore (KOK-064) ------------------------------------------------------

  editTitle: "Editar venta",
  edit: "Editar",
  delete: "Eliminar",
  /** Doc 06 principle 6: an ordinary delete gets no confirm-dialog wall, only the toast below. */
  deletedUndo: "Venta eliminada.",
  undo: "Deshacer",
  restoreFailed: "No se pudo deshacer la eliminación. Intenta de nuevo.",

  /** ImpactConfirmDialog copy — only shown when the server refuses with
   * REPLAY_CONFIRMATION_REQUIRED (a backdated create/edit/delete/restore that moves already-booked
   * cost). Mirrors i18n-purchases.ts's identical set. */
  impactCreateTitle: "¿Registrar esta venta?",
  impactCreateDescription:
    "Esta venta tiene una fecha anterior a movimientos ya registrados de sus ítems. Registrarla recalculará el costo de esos movimientos.",
  impactEditTitle: "¿Guardar los cambios?",
  impactEditDescription:
    "Esta venta tiene una fecha anterior a movimientos ya registrados de sus ítems. Guardar los cambios recalculará el costo de esos movimientos.",
  impactDeleteTitle: "¿Eliminar esta venta?",
  impactDeleteDescription:
    "Esta venta tiene una fecha anterior a movimientos ya registrados de sus ítems. Eliminarla recalculará el costo de esos movimientos.",
  impactRestoreTitle: "¿Deshacer la eliminación?",
  impactRestoreDescription:
    "Esta venta tiene una fecha anterior a movimientos ya registrados de sus ítems. Deshacer la eliminación recalculará el costo de esos movimientos.",
} as const;

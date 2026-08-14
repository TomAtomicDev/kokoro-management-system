// Spanish (es-BO) copy for the Orders board (SC-04, UC-05…UC-08), OrderBoard, OrderCard,
// OrderDetailDrawer, QuoteOrderForm, and the lifecycle action dialogs (KOK-034).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-sales.ts / i18n-purchases.ts.

import type { CancelResolution, CustomOrderStatus, PaymentMethod } from "@kokoro/shared";

export const ordersLabels = {
  title: "Pedidos",
  subtitle: "Cotiza, confirma y entrega pedidos personalizados.",
  actionQuote: "Nuevo pedido",
  loading: "Cargando…",
  noOrders: "No hay pedidos en este estado.",

  statusLabels: {
    QUOTING: "Cotizando",
    CONFIRMED: "Confirmado",
    IN_PRODUCTION: "En producción",
    READY: "Listo",
    DELIVERED: "Entregado",
    CANCELLED: "Cancelado",
  } satisfies Record<CustomOrderStatus, string>,

  cancelResolutionLabels: {
    REFUND: "Devuelto",
    FORFEIT: "Retenido",
  } satisfies Record<CancelResolution, string>,

  paymentMethodLabels: {
    CASH: "Efectivo",
    BANK_QR: "QR / transferencia",
  } satisfies Record<PaymentMethod, string>,

  // --- Board / card ----------------------------------------------------------------------------

  columnDeliveryDate: "Entrega",
  noDeliveryDate: "Sin fecha",
  cardDeposit: "Anticipo",
  cardBalance: "Saldo",
  depositPendingBadge: "Sin anticipo",
  depositPaidBadge: "Con anticipo",
  noAgreedTotal: "Sin total acordado",

  // --- Quote form (create) ----------------------------------------------------------------------

  quoteTitle: "Nuevo pedido",
  fieldCustomer: "Cliente",
  fieldDescription: "Descripción",
  descriptionPlaceholder: "¿Qué se va a entregar?",
  fieldAgreedTotal: "Total acordado (Bs)",
  fieldDepositRequired: "Anticipo esperado (Bs)",
  fieldDeliveryDate: "Fecha de entrega",
  fieldDeliveryPlace: "Lugar de entrega",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",
  linesTitle: "Artículos del pedido",
  linesHint:
    "Opcional: puedes dejarlo en blanco o describirlo con texto libre; vincula el ítem del catálogo más tarde, antes de entregar.",
  lineItem: "Ítem (opcional)",
  lineDescription: "Descripción libre",
  lineDescriptionPlaceholder: "Si aún no hay un ítem del catálogo",
  lineQty: "Cantidad",
  lineLineTotal: "Importe de la línea (Bs, opcional)",
  addLine: "Agregar línea",
  removeLine: "Quitar línea",
  orderPickerPlaceholder: "Buscar pedido…",
  orderPickerEmpty: "No hay pedidos disponibles.",
  orderPickerNone: "Quitar pedido vinculado",
  orderPickerDeletedCustomer: "(cliente eliminado)",
  orderPickerFieldLabel: "Pedido vinculado (opcional)",
  confirmReadyNoProduction: "Este pedido no tiene producción vinculada — ¿continuar?",

  cancel: "Cancelar",
  submit: "Registrar pedido",
  save: "Guardar",

  // --- Detail drawer -----------------------------------------------------------------------------

  detailTitle: "Pedido",
  detailLines: "Líneas",
  noNotes: "Sin notas.",
  columnStatus: "Estado",
  columnCustomer: "Cliente",
  columnAgreedTotal: "Total acordado",
  columnDepositPaid: "Anticipo pagado",
  columnBalanceDue: "Saldo pendiente",
  columnDeliveryPlace: "Lugar",

  lineUnresolvedBadge: "Sin ítem del catálogo",
  lineResolveAction: "Vincular ítem",
  lineResolveTitle: "Vincular ítem del catálogo",
  lineResolveSubmit: "Vincular",
  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    itemRequired: "Selecciona un ítem del catálogo.",
    customerRequired: "Selecciona un cliente.",
  },

  // --- Lifecycle actions ---------------------------------------------------------------------

  actionConfirm: "Confirmar",
  actionStartProduction: "Iniciar producción",
  actionMarkReady: "Marcar listo",
  actionDeliver: "Entregar",
  actionCancel: "Cancelar pedido",
  actionUndoStart: "Volver a confirmado",
  actionUndoReady: "Volver a en producción",
  actionUndoDeliver: "Deshacer entrega",
  confirmUndoStart: "¿Volver este pedido a confirmado?",
  confirmUndoReady: "¿Volver este pedido a en producción?",
  confirmUndoDeliver:
    "¿Deshacer la entrega de este pedido? Se eliminará la venta generada y se revertirá el saldo cobrado; el anticipo volverá a contar como pendiente.",
  impactUndoDeliverTitle: "¿Deshacer esta entrega?",
  impactUndoDeliverDescription:
    "Esta entrega tiene movimientos posteriores que dependen de su costo. Deshacerla recalculará esos costos.",

  confirmDialogTitle: "Confirmar pedido",
  confirmFieldAgreedTotal: "Total acordado (Bs)",
  confirmFieldDepositAmount: "Anticipo (Bs)",
  confirmFieldPaymentAccount: "Cuenta y método de pago",
  confirmFieldDate: "Fecha del anticipo",
  confirmSubmit: "Confirmar y cobrar anticipo",

  deliverDialogTitle: "Entregar pedido",
  deliverUnresolvedWarning:
    "Todas las líneas deben tener un ítem del catálogo vinculado antes de entregar.",
  deliverFieldBalanceStatus: "Estado del saldo",
  deliverBalancePaid: "Pagado",
  deliverBalanceOnCredit: "Por cobrar",
  deliverFieldPaymentAccount: "Cuenta y método de pago",
  deliverFieldDate: "Fecha de entrega",
  deliverSubmit: "Confirmar entrega",
  deliverBalanceZero: "El anticipo cubre el total; no queda saldo por cobrar.",

  cancelDialogTitle: "Cancelar pedido",
  cancelFieldResolution: "¿Qué pasa con el anticipo?",
  cancelResolutionRefund: "Devolver (REFUND)",
  cancelResolutionForfeit: "Retener (FORFEIT)",
  cancelFieldAccount: "Cuenta de devolución",
  cancelNoDeposit: "Este pedido no tiene anticipo; se cancelará sin efecto en el dinero.",
  cancelSubmit: "Confirmar cancelación",

  /** ImpactConfirmDialog copy — only shown when the server refuses with
   * REPLAY_CONFIRMATION_REQUIRED (a backdated delivery that moves already-booked cost). Mirrors
   * i18n-sales.ts's identical set. */
  impactDeliverTitle: "¿Entregar este pedido?",
  impactDeliverDescription:
    "Esta entrega tiene una fecha anterior a movimientos ya registrados de sus ítems. Entregarla recalculará el costo de esos movimientos.",

  // --- Order-profitability panel (linked production runs) -------------------------------------

  profitabilityTitle: "Rentabilidad del pedido",
  profitabilityAgreedTotal: "Total acordado",
  profitabilityLinkedCosts: "Costo de producción vinculado",
  profitabilityMargin: "Margen",
  linkedRunsTitle: "Producción vinculada",
  noLinkedRuns: "Sin producción vinculada todavía.",
} as const;

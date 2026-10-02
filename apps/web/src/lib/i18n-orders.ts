// Spanish (es-BO) copy for the Orders board (SC-04, UC-05…UC-08), OrderBoard, OrderCard,
// OrderDetailPage, QuoteOrderForm, the orders board, and lifecycle action dialogs.
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-sales.ts / i18n-purchases.ts.

import type { CustomOrderStatus } from "@kokoro/shared";

export type OrdersHistoryFilter = "all" | "outstanding" | "paid" | "cancelled";

export const ordersLabels = {
  title: "Pedidos",
  subtitle: "Cotiza, confirma y entrega pedidos personalizados.",
  actionQuote: "Nuevo pedido",
  loading: "Cargando…",
  noOrders: "No hay pedidos en este estado.",
  loadError: "No se pudieron cargar los pedidos. Intenta de nuevo.",
  retry: "Reintentar",
  viewActive: "Activos",
  viewHistory: "Historial",
  viewNavigation: "Vista de pedidos",
  historyFilterNavigation: "Filtrar historial de pedidos",
  activeTitle: "Pedidos activos",
  historyTitle: "Historial de pedidos",
  historyFilters: {
    all: "Todos",
    outstanding: "Por cobrar",
    paid: "Pagados",
    cancelled: "Cancelados",
  } satisfies Record<OrdersHistoryFilter, string>,
  historyEmpty: {
    all: "No hay pedidos en el historial.",
    outstanding: "No hay pedidos con saldo pendiente.",
    paid: "No hay pedidos pagados.",
    cancelled: "No hay pedidos cancelados.",
  } satisfies Record<OrdersHistoryFilter, string>,
  creationDate: "Fecha de creación",
  dateFrom: "Desde",
  dateTo: "Hasta",
  clearCreationDate: "Limpiar fechas",

  statusLabels: {
    QUOTING: "Cotizando",
    CONFIRMED: "Confirmado",
    IN_PRODUCTION: "En producción",
    READY: "Listo",
    DELIVERED: "Entregado",
    CANCELLED: "Cancelado",
  } satisfies Record<CustomOrderStatus, string>,

  // --- Board / card ----------------------------------------------------------------------------

  columnDeliveryDate: "Entrega",
  noDeliveryDate: "Sin fecha",
  noAgreedTotal: "Sin total acordado",

  // --- Quote form (create) ----------------------------------------------------------------------

  quoteTitle: "Nuevo pedido",
  editTitle: "Editar pedido",
  backToOrders: "Volver a pedidos",
  fieldCustomer: "Cliente",
  fieldDescription: "Descripción",
  descriptionPlaceholder: "¿Qué se va a entregar?",
  fieldAgreedTotal: "Subtotal de artículos (Bs)",
  fieldAdditionalCharge: "Cargo adicional al cliente (Bs)",
  customerAmount: "Importe al cliente",
  qualifyingReceipts: "Recibos vinculados",
  draftExpectedBalance: "Saldo previsto con este cambio",
  draftExcess: "Exceso con este cambio",
  receiptPreviewNoAgreement: "Define el subtotal de artículos para ver el saldo y el exceso.",
  customerAmountOutOfRange: "El importe al cliente excede el rango permitido.",
  receiptPreviewInfo: "Vista informativa; puedes ajustar el acuerdo por debajo de los recibos.",
  receiptSummaryError: "No se pudieron actualizar los recibos vinculados.",
  receiptSummaryLoading: "Actualizando recibos…",
  customerLocked: "El cliente no se puede cambiar porque ya hay un recibo vinculado.",
  terminalOrderNotEditable: "Los pedidos entregados o cancelados no se pueden editar.",
  saved: "Cambios guardados; recibos actualizados.",
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
  detailBackToBoard: "Volver a pedidos",
  orderCodeUnavailable: "Pedido",
  orderCreatedAt: "Creado",
  orderUpdatedAt: "Actualizado",
  orderContextId: "Pedido actual",
  actionRecordExpense: "Registrar gasto",
  actionRecordIncome: "Registrar ingreso",
  actionRecordRefund: "Registrar devolución",
  actionViewFinance: "Ver movimientos en Finanzas",
  actionViewPacking: "Ver armados en Envasar",
  actionEditAgreement: "Editar acuerdo",
  accountsLoading: "Cargando cuentas…",
  accountsError: "No se pudieron cargar las cuentas para registrar dinero.",
  workDataUnavailable:
    "No se pudo verificar la producción vinculada. Intenta de nuevo antes de marcar listo.",
  customerPrice: "Importe al cliente",
  receiptsReceived: "Recibos de anticipo y saldo",
  expectedBalance: "Saldo previsto",
  actualDebt: "Saldo por cobrar",
  receiptExcess: "Exceso recibido",
  noDebtForCancelled: "Sin deuda cobrable: el pedido está cancelado.",
  notComputed: "Sin acuerdo de precio",
  balanceUnavailable: "No disponible",
  productMarginTitle: "Margen bruto de artículos",
  productRevenue: "Venta de artículos",
  frozenCogs: "Costo congelado al entregar",
  productGrossMargin: "Margen bruto de artículos",
  productMarginUnavailable: "El margen aparece cuando la venta vinculada esté disponible.",
  cashResultTitle: "Resultado de caja del pedido",
  cashIncome: "Ingresos vinculados",
  cashExpenses: "Gastos vinculados",
  cashResult: "Resultado neto de caja",
  cashResultExplanation:
    "Incluye compras, gastos, anticipos, saldos, devoluciones y otros ingresos. El cargo cobrado al cliente no se iguala automáticamente a un gasto de delivery. No es margen bruto ni se suma al costo congelado.",
  linkedCostEvidence: "Evidencia parcial de costos",
  loadingCostEvidence: "Cargando producción y armados vinculados…",
  missingCostInputs:
    "Aún no hay producción ni armados vinculados. Sin esos datos no se puede estimar el costo del pedido.",
  partialCostExplanation:
    "Estos registros documentan parte del trabajo; no son el costo final ni un margen. La venta entregada aporta el costo congelado de los artículos.",
  noLinkedWork: "No hay producción ni armados vinculados.",
  productionEvidence: "Producción vinculada",
  assemblyEvidence: "Armados vinculados",
  detailTimeline: "Actividad del pedido",
  timelineLoading: "Cargando actividad vinculada…",
  timelineError: "No se pudo cargar toda la actividad del pedido. La lista puede estar incompleta.",
  timelineEmpty: "Todavía no hay movimientos ni eventos vinculados a este pedido.",
  timelineRetry: "Reintentar lecturas",
  timelineOrderIncome: "Ingreso del pedido",
  timelineOrderExpense: "Gasto del pedido",
  timelinePurchase: "Compra vinculada",
  timelineProduction: "Producción vinculada",
  timelineAssembly: "Armado vinculado",
  timelineSale: "Venta entregada",
  timelineSaleUndone: "Venta entregada · entrega deshecha",
  deliveredSaleMissing: "El pedido figura como entregado, pero no hay una venta activa vinculada.",
  timelineOrigin: "Origen",
  openLinkedEvent: "Abrir evento",
  noCode: "Sin código",
  itemNamesUnavailable: "No se pudieron cargar los nombres del catálogo.",
  orderLinesHeading: "Artículos acordados",
  noOrderLines: "No se agregaron artículos al acuerdo.",
  readyNoWorkWarning:
    "Este pedido no tiene producción ni armados vinculados. Puedes marcarlo listo si se atenderá con stock existente.",
  detailLines: "Líneas",
  noNotes: "Sin notas.",
  columnStatus: "Estado",
  columnCustomer: "Cliente",
  columnAgreedTotal: "Subtotal de artículos",
  columnDeliveryPlace: "Lugar",

  lineUnresolvedBadge: "Sin ítem del catálogo",
  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    itemRequired: "Selecciona un ítem del catálogo.",
    customerRequired: "Selecciona un cliente.",
    agreedTotalRequired: "Define el subtotal antes de confirmar el pedido.",
    linesNotAllocatable: "Ajusta las líneas para repartir exactamente el subtotal.",
  },

  // --- Lifecycle actions ---------------------------------------------------------------------

  actionConfirm: "Confirmar",
  actionEdit: "Editar pedido",
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
    "¿Deshacer la entrega? Se eliminará la venta del inventario y se revertirá el stock; los movimientos de dinero no cambiarán.",
  impactUndoDeliverTitle: "¿Deshacer esta entrega?",
  impactUndoDeliverDescription:
    "Esta entrega tiene movimientos posteriores que dependen de su costo. Deshacerla recalculará esos costos.",

  confirmDialogTitle: "Confirmar pedido",
  confirmDescription: "El pedido pasará a confirmado. Este cambio no registra ni modifica dinero.",
  confirmSubmit: "Confirmar pedido",

  deliverDialogTitle: "Entregar pedido",
  deliverUnresolvedWarning:
    "Todas las líneas deben tener un ítem del catálogo vinculado antes de entregar.",
  deliverFieldDate: "Fecha de entrega",
  deliverSubmit: "Confirmar entrega",
  deliverDescription:
    "Se guardará la venta y el movimiento de stock; no se registrará ningún pago.",

  cancelDialogTitle: "Cancelar pedido",
  cancelDescription:
    "El pedido quedará cancelado. Los recibos no cambiarán; registra cualquier devolución por separado.",
  cancelSubmit: "Confirmar cancelación",

  /** ImpactConfirmDialog copy — only shown when the server refuses with
   * REPLAY_CONFIRMATION_REQUIRED (a backdated delivery that moves already-booked cost). Mirrors
   * i18n-sales.ts's identical set. */
  impactDeliverTitle: "¿Entregar este pedido?",
  impactDeliverDescription:
    "Esta entrega tiene una fecha anterior a movimientos ya registrados de sus ítems. Entregarla recalculará el costo de esos movimientos.",

  // --- Order-profitability panel (linked production runs) -------------------------------------

  profitabilityTitle: "Rentabilidad del pedido",
  profitabilityAgreedTotal: "Subtotal de artículos",
  profitabilityLinkedCosts: "Costo de producción vinculado",
  profitabilityMargin: "Margen",
  linkedRunsTitle: "Producción vinculada",
  noLinkedRuns: "Sin producción vinculada todavía.",
} as const;

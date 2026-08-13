// Spanish (es-BO) copy for the Sessions screen (SC-09, UC-14), SessionForm, SessionsTable,
// SessionDetailDrawer, and the topbar SessionChip (KOK-027).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-purchases.ts / i18n-production.ts.

import type { SessionType } from "@kokoro/shared";

export const sessionsLabels = {
  title: "Sesiones",
  subtitle: "Registra tramos de tiempo (producción, compras, entregas) y sus costos compartidos.",
  actionRecord: "Nueva sesión",

  columnDate: "Fecha",
  columnType: "Tipo",
  columnDuration: "Duración",
  columnCosts: "Costos compartidos",
  columnLinkedEvents: "Eventos vinculados",
  columnStatus: "Estado",

  noSessions: "No hay sesiones registradas.",
  loading: "Cargando…",
  noDuration: "—",

  /** Doc 13 glossary only translates PURCHASE_TRIP/DELIVERY_RUN explicitly; PRODUCTION/ADMIN/OTHER
   * have no KB-given label (gap) — these follow the same short, concrete, no-jargon style. */
  typeLabels: {
    PRODUCTION: "Producción",
    PURCHASE_TRIP: "Compras",
    DELIVERY_RUN: "Entregas",
    ADMIN: "Administración",
    OTHER: "Otro",
  } satisfies Record<SessionType, string>,

  statusLabels: {
    OPEN: "Abierta",
    CLOSED: "Cerrada",
  },

  recordTitle: "Nueva sesión",
  editTitle: "Editar sesión",
  modeLabel: "Modo de registro",
  startNowTab: "Iniciar ahora",
  logPastTab: "Registrar sesión pasada",
  required: "requerido",
  fieldType: "Tipo",
  fieldDate: "Fecha",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",
  fieldStart: "Inicio",
  fieldEnd: "Fin",
  fieldDuration: "Duración (minutos)",
  durationHint: "Completa el inicio y fin, o directamente la duración en minutos.",

  costLinesTitle: "Costos compartidos",
  tooltipCostLinesTitle:
    "Son costos indirectos o compartidos de la sesión, como gas o alquiler, que se distribuyen entre sus eventos y no están ligados a un ítem específico.",
  costLineLabel: "Etiqueta",
  costLineLabelPlaceholder: "Ej. transporte, alquiler de local",
  costLineLabelPlaceholderPurchaseTrip: "Combustible o Transporte",
  costLineLabelPlaceholderProduction: "Energía eléctrica Horno",
  costLineAmount: "Monto (Bs)",
  costLineEstimate: "Estimación",
  tooltipCostLineEstimate:
    "Al marcar un costo como estimación, este no mueve el efectivo: las estimaciones nunca afectan la caja.",
  costLineAccount: "Cuenta",
  addLine: "Agregar costo",
  removeLine: "Quitar costo",
  noCostLines: "Sin costos compartidos.",

  save: "Guardar",
  cancel: "Cancelar",
  submit: "Registrar sesión",

  detailTitle: "Sesión",
  detailCosts: "Costos compartidos",
  detailCostsTotal: "Total",
  estimateBadge: "estimado",
  noNotes: "Sin notas.",
  bsPerHourPlaceholder: "—",

  linkedEventsTitle: "Eventos vinculados",
  linkedPurchases: "Compras",
  linkedProductionRuns: "Producción",
  linkedSales: "Ventas",
  linkedStockExits: "Salidas de stock",
  noLinkedEvents: "Sin eventos vinculados.",

  closeAction: "Cerrar sesión",
  closeTitle: "Cerrar sesión",
  closeDescription: "Registra la hora de fin o la duración total antes de cerrar.",
  closeConfirm: "Cerrar sesión",
  closeCancel: "Cancelar",

  edit: "Editar",
  delete: "Eliminar",
  deletedUndo: "Sesión eliminada.",
  undo: "Deshacer",
  restoreFailed: "No se pudo deshacer la eliminación. Intenta de nuevo.",

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    typeRequired: "Selecciona un tipo de sesión.",
    dateRequired: "Selecciona una fecha.",
    startRequired: "Indica la hora de inicio.",
    invalidCostLine: "Cada costo compartido necesita una etiqueta y un monto válido.",
    accountRequired: "Selecciona una cuenta para un costo que no es una estimación.",
    closeRequiresDuration: "Indica la hora de fin o la duración para cerrar la sesión.",
  },

  chip: {
    noOpenSession: "Sin sesión abierta",
    multipleOpen: (count: number) => `${count} sesiones abiertas`,
    elapsedUnknown: "en curso",
    viewDetail: "Ver detalle",
    stopNow: "Detener sesión ahora",
  },

  quickStart: {
    title: "Iniciar sesión",
    chooseType: "Elige el tipo de sesión a iniciar.",
    conflictMessage: (typeLabel: string) =>
      `Ya hay una sesión de ${typeLabel} abierta. ¿Cerrarla ahora e iniciar una nueva?`,
    confirmCloseAndStart: "Cerrar la anterior e iniciar",
    cancel: "Cancelar",
  },
} as const;

// Spanish (es-BO) copy for the Sessions screen (SC-09, UC-14), SessionForm, SessionsTable,
// SessionDetailDrawer, and the topbar SessionChip (KOK-027).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-purchases.ts / i18n-production.ts.

import type { SessionType } from "@kokoro/shared";

export const sessionsLabels = {
  title: "Sesiones",
  subtitle: "Registra tramos de tiempo (producción, compras, entregas) y sus costos compartidos.",
  actionRecord: "Nueva sesión",

  columnCode: "Código",
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

  calendar: {
    activeLabel: "Activa",
    moreSessions: (count: number) => `+${count} más`,
    noSessionsWeek: "No hay sesiones esta semana.",
    viewList: "Lista",
    viewCalendar: "Semana",
    today: "Hoy",
    prevWeek: "Semana anterior",
    nextWeek: "Semana siguiente",
    weekRangeLabel: (start: string, end: string) => `${start}–${end}`,
  },

  hours: {
    title: "Horas del periodo",
    subtitle:
      "Compara la suma de tus sesiones con las horas reales de reloj que alimentan el Bs/hora mensual.",
    summedLabel: "Suma de duraciones",
    summedDescription: "La duración propia de cada sesión, sin quitar solapamientos.",
    deduplicatedLabel: "Horas de reloj",
    deduplicatedDescription: "La base del Bs/hora mensual: cada minuto se cuenta una sola vez.",
    overlapExplanation:
      "Las sesiones superpuestas cuentan una sola vez en las horas de reloj, porque transcurrieron al mismo tiempo.",
    noOverlapExplanation: "No hay solapamiento entre las sesiones con duración de este periodo.",
    excludedSessions: (count: number) =>
      `${count} ${count === 1 ? "sesión queda" : "sesiones quedan"} fuera hasta registrar su duración.`,
    loading: "Calculando…",
    error: "No se pudieron cargar las horas de este periodo.",
    empty: "Aún no hay sesiones cerradas con duración en este periodo.",
  },

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
  durationHint: "La hora de fin y la duración se mantienen sincronizadas.",

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
  linkedEvents: {
    registerProductionRun: "Registrar producción",
    registerPurchase: "Registrar compra",
  },

  closeAction: "Cerrar sesión",
  closeTitle: "Cerrar sesión",
  closeDescription:
    "La hora de fin se completa con la hora actual; puedes editarla o indicar la duración.",
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
    invalidDuration: "La duración debe ser un número entero positivo.",
    invalidCostLine: "Cada costo compartido necesita una etiqueta y un monto válido.",
    accountRequired: "Selecciona una cuenta para un costo que no es una estimación.",
    closeRequiresDuration: "Indica la hora de fin o la duración para cerrar la sesión.",
    closeEndRequired: "Indica la hora de fin para cerrar la sesión.",
    endBeforeStart: "La hora de fin debe ser posterior al inicio.",
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

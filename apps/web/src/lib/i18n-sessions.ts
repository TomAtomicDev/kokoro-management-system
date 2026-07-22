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
  fieldType: "Tipo",
  fieldDate: "Fecha",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",
  fieldStart: "Inicio",
  fieldEnd: "Fin",
  fieldDuration: "Duración (minutos)",
  durationHint: "Completa el inicio y fin, o directamente la duración en minutos.",

  costLinesTitle: "Costos compartidos",
  costLineLabel: "Etiqueta",
  costLineLabelPlaceholder: "Ej. transporte, alquiler de local",
  costLineAmount: "Monto (Bs)",
  costLineEstimate: "Estimación",
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

  /** RecordSessionResult.openSessionWarning is a plain Spanish string built by core/sessions — this
   * entry is unused for that (server-provided) case, but kept in case a client-side echo is ever
   * needed. */
  openSessionWarningTitle: "Aviso",

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    typeRequired: "Selecciona un tipo de sesión.",
    dateRequired: "Selecciona una fecha.",
    invalidCostLine: "Cada costo compartido necesita una etiqueta y un monto válido.",
    accountRequired: "Selecciona una cuenta para un costo que no es una estimación.",
    closeRequiresDuration: "Indica la hora de fin o la duración para cerrar la sesión.",
  },

  chip: {
    noOpenSession: "Sin sesión abierta",
    multipleOpen: (count: number) => `${count} sesiones abiertas`,
    elapsedUnknown: "en curso",
  },
} as const;

// Spanish (es-BO) copy for the Backups settings screen (KOK-022, SC-16).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-finance.ts / i18n-dashboard.ts.

export const backupsLabels = {
  title: "Respaldos",
  subtitle: "Copia de seguridad automática de los datos del negocio, todas las noches.",

  lastBackup: "Último respaldo",
  statusOk: "Correcto",
  statusFailed: "Falló",
  never: "Todavía no se generó ningún respaldo.",

  sizeLabel: "Tamaño",
  download: "Descargar respaldo",

  loading: "Cargando…",
  error: "No se pudo cargar el estado del respaldo.",
} as const;

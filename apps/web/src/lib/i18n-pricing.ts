// Spanish (es-BO) copy for the Price-health screen (SC-12, KOK-036) and the "Actualizar precio"
// dialog it shares with nothing else (the form itself is intentionally NOT `ItemForm` — this
// action only ever touches one field).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-inventory.ts / i18n-catalog.ts.

export const pricingLabels = {
  title: "Precios y márgenes",
  subtitle: "Qué precio subir esta semana — margen real sobre costo de reposición, no histórico.",

  columnName: "Ítem",
  columnPrice: "Precio",
  columnWac: "Costo prom. (WAC)",
  columnReplacementCost: "Costo de reposición",
  columnMarginWac: "Margen histórico",
  columnMarginReplacement: "Margen real",
  columnSuggestedPrice: "Sugerencia",
  columnLastChange: "Último cambio",

  noPrice: "Sin precio",
  costPending: "Costo pendiente",
  never: "Nunca",
  noSuggestion: "—",

  updatePriceButton: "Actualizar precio",
  updatePriceDialogTitle: "Actualizar precio",
  fieldNewPrice: "Nuevo precio (Bs)",
  save: "Guardar",
  cancel: "Cancelar",

  noItems: "No hay productos activos con precio a revisar.",
  loading: "Cargando...",

  errors: {
    invalidPrice: "El precio debe ser un número válido mayor o igual a cero.",
    generic: "Ocurrió un error. Intenta de nuevo.",
  },
} as const;

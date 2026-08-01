// Spanish (es-BO) copy for the Recipes module (KOK-025, Doc 07 SC-06): RecipeForm, RecipesTable,
// RecipeDetailDrawer, and the Producción hub's pointer card to /production/recipes.
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-purchases.ts / i18n-catalog.ts.

import type { Unit } from "@kokoro/shared";

export const recipesLabels = {
  title: "Recetas",
  subtitle: "Ingredientes, rendimiento esperado y costo teórico de cada receta.",
  actionRecord: "Nueva receta",

  columnName: "Nombre",
  columnOutputItem: "Ítem de salida",
  columnYield: "Rendimiento",
  columnDefault: "Predeterminada",
  columnStatus: "Estado",
  columnCostReplacement: "Costo teórico (reposición)",

  badgeDefault: "Predeterminada",
  badgeActive: "Activa",
  badgeInactive: "Inactiva",

  noRecipes: "No hay recetas registradas.",
  loading: "Cargando…",

  recordTitle: "Nueva receta",
  editTitle: "Editar receta",
  fieldName: "Nombre",
  namePlaceholder: "Ej. Empanada de queso",
  fieldOutputItem: "Ítem de salida",
  outputItemPlaceholder: "Buscar ítem…",
  fieldYield: "Rendimiento esperado",
  fieldLaborMin: "Tiempo estimado (min)",
  laborMinPlaceholder: "Opcional",
  fieldDefault: "Receta predeterminada para este ítem",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",

  linesTitle: "Ingredientes",
  lineItem: "Ingrediente",
  lineQty: "Cantidad",
  addLine: "Agregar ingrediente",
  removeLine: "Quitar ingrediente",
  lineContribution: "Aporte al costo",

  save: "Guardar",
  cancel: "Cancelar",
  submit: "Crear receta",

  costPanelTitle: "Costo teórico",
  costWacLabel: "Costo teórico (promedio)",
  costReplacementLabel: "Costo teórico (reposición)",
  costFormula: "Σ(cantidad de línea × costo del ingrediente) / rendimiento esperado",
  marginLabel: "Margen (reposición)",
  marginWacLabel: "Margen (promedio)",
  noSalePrice: "El ítem de salida no tiene precio de venta configurado todavía.",

  detailTitle: "Receta",
  detailLines: "Ingredientes",
  noNotes: "Sin notas.",

  edit: "Editar",
  deactivate: "Desactivar",
  reactivate: "Reactivar",

  /** Abbreviation for the "/ kg" style suffix — mirrors purchasesLabels.unitAbbrev. */
  unitAbbrev: {
    G: "g",
    KG: "kg",
    ML: "ml",
    L: "l",
    UNIT: "u",
  } satisfies Record<Unit, string>,

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidLine: "Cada ingrediente necesita un ítem y una cantidad válida.",
    outputItemRequired: "Selecciona el ítem de salida.",
    yieldRequired: "Ingresa un rendimiento esperado válido (mayor a cero).",
  },

  // --- Producción hub pointer (SC-06 — the promise StepRecipes.tsx's onboarding step makes) ----
  productionLinkBody: "Configura tus recetas: ingredientes, rendimiento esperado y costo teórico.",
} as const;

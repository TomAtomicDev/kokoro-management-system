// Spanish (es-BO) copy for the Onboarding wizard (KOK-020, Doc 07 steps 1-5, first-run only).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-inventory.ts / i18n-catalog.ts.

import type { ItemCategory, ItemKind, Unit } from "@kokoro/shared";

export const onboardingLabels = {
  title: "Bienvenida a Kokoro",
  subtitle: "Unos pasos rápidos para dejar todo listo antes de empezar a registrar tu día a día.",

  stepLabels: ["Contraseña", "Saldos iniciales", "Catálogo inicial", "Recetas", "Conteo inicial"],

  continueButton: "Continuar",
  skipButton: "Omitir",
  cancel: "Cancelar",
  loading: "Cargando…",

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidAmount: "Ingresa un monto válido (0 o mayor).",
  },

  // --- Step 1: Contraseña (acknowledgment only, no form — the hash is a Worker secret) --------
  passwordTitle: "Tu contraseña",
  passwordBody: "Tu contraseña ya está configurada ✓",
  passwordHelp: "Si necesitas cambiarla más adelante, contacta al equipo técnico.",

  // --- Step 2: Saldos iniciales -----------------------------------------------------------------
  balancesTitle: "Saldos iniciales",
  balancesBody:
    "Registra con cuánto dinero arrancas en cada cuenta. Esto marca el punto de partida de tus finanzas.",
  fieldBank: "Banco",
  fieldCash: "Caja",
  submitBalances: "Guardar saldos",

  // --- Step 3: Catálogo inicial -----------------------------------------------------------------
  catalogTitle: "Catálogo inicial",
  catalogBody:
    "Revisa esta lista de ítems sugerida para empezar. Puedes editar, quitar o dejarla tal cual antes de crearla.",
  columnName: "Nombre",
  columnKind: "Tipo",
  columnCategory: "Categoría",
  columnUnit: "Unidad",
  columnSalePrice: "Precio de venta (Bs)",
  columnMinStock: "Stock mínimo",
  removeRow: "Quitar",
  catalogEmpty: "Quitaste todos los ítems. Agrega al menos uno para continuar, u omite este paso.",
  submitCatalog: "Crear catálogo",

  kindLabels: {
    RAW_MATERIAL: "Materia prima",
    SEMI_FINISHED: "Semielaborado",
    FINISHED: "Producto final",
  } satisfies Record<ItemKind, string>,
  categoryLabels: {
    INGREDIENT: "Ingrediente",
    PACKAGING: "Empaque",
    LABEL: "Etiqueta",
    BAKERY: "Panadería",
    DAIRY: "Lácteo",
    OTHER: "Otro",
  } satisfies Record<ItemCategory, string>,
  unitLabels: {
    G: "Gramos (g)",
    KG: "Kilogramos (kg)",
    ML: "Mililitros (ml)",
    L: "Litros (l)",
    UNIT: "Unidad (u)",
  } satisfies Record<Unit, string>,

  // --- Step 4: Recetas (static pointer card, Recipes/KOK-025 doesn't exist yet) -----------------
  recipesTitle: "Recetas",
  recipesBody: "Configura tus recetas en Producción → Recetas cuando estés lista.",

  // --- Step 5: Conteo inicial -------------------------------------------------------------------
  countTitle: "Conteo inicial",
  countBody:
    "Cuenta el stock real de cada ítem para dejar tu inventario al día antes de empezar a operar.",
  countColumnItem: "Ítem",
  countColumnExpected: "Esperado",
  countColumnCounted: "Contado",
  countColumnDelta: "Variación",
  noCountLines: "No hay ítems para contar todavía.",
  submitCount: "Confirmar y finalizar",

  // --- Completion --------------------------------------------------------------------------------
  redirecting: "Listo, te llevamos al panel…",
} as const;

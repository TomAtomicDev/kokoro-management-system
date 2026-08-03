// Spanish (es-BO) copy for the Onboarding wizard (KOK-020, Doc 07 steps 1-5, first-run only).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-inventory.ts / i18n-catalog.ts.

import type { ItemCategory, ItemKind, Unit } from "@kokoro/shared";

export const onboardingLabels = {
  title: "Bienvenida a Kokoro",
  subtitle: "Unos pasos rápidos para dejar todo listo antes de empezar a registrar tu día a día.",

  stepLabels: ["Contraseña", "Saldos iniciales", "Catálogo inicial", "Recetas", "Conteo inicial"],

  continueButton: "Continuar",
  backButton: "Volver",
  skipButton: "Omitir",
  cancel: "Cancelar",
  loading: "Cargando…",

  errors: {
    salePriceRequired: "El precio de venta es obligatorio para productos finales.",
    salePriceForbidden: "El precio de venta no aplica a materias primas ni semielaborados.",
    minStockQtyRequired: "El stock mínimo es obligatorio para materias primas.",
    minStockQtyForbidden: "El stock mínimo no aplica a semielaborados ni productos finales.",
    tooManyDecimals: "Usa como máximo 2 decimales (centavos).",
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidAmount: "Ingresa un monto válido (0 o mayor).",
    nameRequired: "El nombre es obligatorio.",
    salePriceInvalid: "Ingresa un precio de venta válido (0 o mayor).",
    minStockQtyInvalid: "Ingresa un stock mínimo válido (0 o mayor).",
  },

  // --- Step 1: Contraseña (acknowledgment only, no form — the hash is a Worker secret) --------
  passwordTitle: "Tu contraseña",
  passwordBody: "Tu contraseña ya está configurada ✓",
  passwordHelp: "Si necesitas cambiarla más adelante, contacta al equipo técnico.",

  // --- Step 2: Saldos iniciales -----------------------------------------------------------------
  balancesTitle: "Saldos iniciales",
  balancesBody:
    "Registra con cuánto dinero arrancas en cada cuenta. Esto marca el punto de partida de tus finanzas.",
  decimalHelp: "Puedes usar coma o punto para los decimales (máx. 2).",
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
  addRow: "Agregar ítem",
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
    PASTRY: "Pastelería",
    OTHER: "Otro",
  } satisfies Record<ItemCategory, string>,
  unitLabels: {
    G: "Gramos (g)",
    KG: "Kilogramos (kg)",
    ML: "Mililitros (ml)",
    L: "Litros (L)",
    UNIT: "Unidad (u)",
    M: "Metros (m)",
  } satisfies Record<Unit, string>,

  // --- Step 4: Recetas (static pointer card, Recipes/KOK-025 doesn't exist yet) -----------------
  recipesTitle: "Recetas",
  recipesBody: "Configura tus recetas en Producción → Recetas cuando estés lista.",

  // --- Step 5: Conteo inicial -------------------------------------------------------------------
  countTitle: "Conteo inicial",
  countBody:
    "Cuenta el stock real de cada ítem para dejar tu inventario al día antes de empezar a operar.",
  countColumnItem: "Ítem",
  countColumnCounted: "Contado",
  countColumnUnitCost: "Costo unitario",
  countUnitCostRequired: "Indica un costo unitario mayor que cero para valorar este stock inicial.",
  unitAbbrev: {
    G: "g",
    KG: "kg",
    ML: "ml",
    L: "L",
    UNIT: "u",
    M: "m",
  } satisfies Record<Unit, string>,
  noCountLines: "No hay ítems para contar todavía.",
  submitCount: "Confirmar y finalizar",

  // --- Completion --------------------------------------------------------------------------------
  redirecting: "Listo, te llevamos al panel…",
  completedTitle: "Configuración inicial completada",
  completedBody: "Tu espacio ya está listo para trabajar.",
  goToPanel: "Ir al panel",
  alreadySaved: "Ya guardado",
  savedBalancesBody: "Estos saldos ya fueron guardados y no se pueden volver a enviar desde aquí.",
  savedCatalogBody: "Este catálogo ya fue guardado y no se puede volver a crear desde aquí.",
  goToSettings: "Ir a Configuración",
} as const;

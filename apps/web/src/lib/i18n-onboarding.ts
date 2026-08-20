// Spanish (es-BO) copy for the Onboarding wizard (KOK-020, Doc 07 steps 1-5, first-run only).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-inventory.ts / i18n-catalog.ts.

import type { ItemCategory, ItemKind, Unit } from "@kokoro/shared";

export const onboardingLabels = {
  title: "Bienvenida a Kokoro",
  subtitle: "Unos pasos rápidos para dejar todo listo antes de empezar a registrar tu día a día.",

  stepLabels: ["Contraseña", "Saldos iniciales", "Catálogo inicial", "Recetas", "Conteo inicial"],

  continueButton: "Continuar",
  guidanceWhatLabel: "Qué hacer",
  guidanceWhyLabel: "Por qué importa",
  guidanceWhereLabel: "Dónde ajustarlo después",
  backButton: "Volver",
  skipButton: "Avanzar",
  cancel: "Cancelar",
  loading: "Cargando…",

  errors: {
    salePriceRequired: "El precio de venta es obligatorio para productos finales.",
    salePriceForbidden:
      "El precio de venta no aplica a materias primas, semielaborados ni empaques.",
    minStockQtyRequired: "Define un stock mínimo para materias primas y empaques.",
    minStockQtyForbidden: "El stock mínimo no aplica a productos finales.",
    tooManyDecimals: "Usa como máximo 2 decimales (centavos).",
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidAmount: "Ingresa un monto válido (0 o mayor).",
    nameRequired: "El nombre es obligatorio.",
    replacementCostMcInvalid: "Ingresa un costo de reposición válido (0 o mayor).",
    replacementCostMcTooManyDecimals: "Usa como máximo 5 decimales.",
    salePriceInvalid: "Ingresa un precio de venta válido (0 o mayor).",
    minStockQtyInvalid: "Ingresa un stock mínimo válido (0 o mayor).",
  },

  // --- Step 1: Contraseña (acknowledgment only, no form — the hash is a Worker secret) --------
  passwordTitle: "Tu contraseña",
  passwordBody: "Tu contraseña ya está configurada ✓",
  passwordHelp: "Si necesitas cambiarla más adelante, contacta al equipo técnico.",

  passwordOverviewTitle: "Deja todo listo para empezar",
  passwordOverviewBody:
    "En estos cinco pasos vas a revisar lo básico de tu operación antes de empezar a registrar tu día a día.",
  passwordStepDescriptions: [
    "Confirmar que tu contraseña está configurada.",
    "Registrar los saldos con los que arrancas.",
    "Revisar los ítems, precios y categorías de tu catálogo.",
    "Confirmar las recetas que conectan tu catálogo con producción.",
    "Contar el stock físico que tienes ahora.",
  ],
  passwordOverviewNavigation:
    "Puedes moverte libremente entre los pasos para conocerlos antes de guardar. No tienes que dejar todo perfecto en la primera vuelta.",

  // --- Step 2: Saldos iniciales -----------------------------------------------------------------
  balancesTitle: "Saldos iniciales",
  balancesBody:
    "Registra con cuánto dinero arrancas en cada cuenta. Esto marca el punto de partida de tus finanzas.",
  balancesGuidanceWhat: "Mira cuánto tienes ahora en el banco y en caja.",
  balancesGuidanceWhy:
    "Es el punto de partida de tus reportes financieros; un error acá se arrastra.",
  balancesGuidanceWhere: "Después puedes ajustarlo desde Finanzas.",
  decimalHelp: "Puedes usar coma o punto para los decimales (máx. 2).",
  fieldBank: "Banco",
  fieldCash: "Caja",
  submitBalances: "Guardar saldos",

  // --- Step 3: Catálogo inicial -----------------------------------------------------------------
  catalogTitle: "Catálogo inicial",
  catalogBody:
    "Revisa esta lista de ítems sugerida para empezar. Puedes editar, quitar o dejarla tal cual antes de crearla.",
  catalogGuidanceWhat: "Revisa nombres, precios y categorías según tu negocio real.",
  catalogGuidanceWhy:
    "Define qué registrarás en compras, ventas y producción; un tipo incorrecto causa errores después.",
  catalogGuidanceWhere:
    "Puedes seguir editándolo aquí cuando quieras o desde Configuración → Catálogo.",
  columnName: "Nombre",
  columnKind: "Tipo",
  columnCategory: "Categoría",
  columnUnit: "Unidad",
  columnIsUnmetered: "No medido",
  columnReplacementCost: "Costo de reposición (Bs)",
  costRateHelp: "Puedes usar coma o punto (máx. 5 decimales).",
  columnSalePrice: "Precio de venta (Bs)",
  columnMinStock: "Stock mínimo",
  addRow: "Agregar ítem",
  removeRow: "Quitar",
  catalogEmpty: "Quitaste todos los ítems. Agrega al menos uno para continuar, u omite este paso.",
  submitCatalog: "Crear catálogo",

  catalogSavedTitle: "Ítems guardados",
  catalogSavedLoading: "Cargando ítems guardados…",
  catalogSavedEmpty: "Todavía no hay ítems guardados.",
  catalogSavedError: "No se pudo cargar el catálogo. Intenta de nuevo.",

  kindLabels: {
    RAW_MATERIAL: "Materia prima",
    SEMI_FINISHED: "Semielaborado",
    FINISHED: "Producto final",
    PACKAGING: "Empaque",
  } satisfies Record<ItemKind, string>,
  categoryLabels: {
    INGREDIENT: "Ingrediente",
    NOT_EATABLE: "No comestible",
    BAKERY: "Panadería",
    DAIRY: "Lácteo",
    PASTRY: "Pastelería",
    OTHER: "Otro",
  } satisfies Record<ItemCategory, string>,
  unitLabels: {
    KG: "Kilogramos (kg)",
    L: "Litros (L)",
    UNIT: "Unidad (u)",
    M: "Metros (m)",
  } satisfies Record<Unit, string>,

  // --- Step 4: Recetas --------------------------------------------------------------------------
  recipesTitle: "Recetas iniciales",
  recipesNeedsCatalog:
    "Guarda el catálogo en el paso 3 para ver la vista previa real de las recetas.",
  recipesBody:
    "Crea tres recetas base para empezar a producir. Si prefieres configurarlas después, puedes omitir este paso.",
  recipesGuidanceWhat:
    "Revisa las recetas sugeridas y confirma que sus ítems ya estén en tu catálogo.",
  recipesGuidanceWhy:
    "Conectan el catálogo con la producción; sin ellas no puedes registrar esas corridas.",
  recipesGuidanceWhere: "Después puedes ajustarlas desde Producción → Recetas.",
  recipesPreviewTitle: "Se crearán estas recetas:",
  recipesMissingItems: "Faltan estos ítems del catálogo; puedes omitir este paso:",
  submitRecipes: "Crear recetas iniciales",

  // --- Step 5: Conteo inicial -------------------------------------------------------------------
  countTitle: "Conteo inicial",
  countBody:
    "Cuenta el stock real de cada ítem para dejar tu inventario al día antes de empezar a operar.",
  countGuidanceWhat: "Cuenta el stock físico real de cada ítem ahora.",
  countGuidanceWhy:
    "Será tu inventario inicial; si no coincide, tus reportes de stock arrancarán mal.",
  countGuidanceWhere: "Después puedes ajustarlo con conteos regulares desde Inventario.",
  countColumnItem: "Ítem",
  countColumnCounted: "Stock inicial",
  countColumnUnitCost: "Costo unitario",
  countUnitCostRequired: "Indica un costo unitario mayor que cero para valorar este stock inicial.",
  countUnitCostInvalid: "Ingresa un costo unitario válido.",
  countUnitCostNotPositive: "El costo unitario debe ser mayor que cero.",
  countUnitCostTooManyDecimals: "Usa como máximo 5 decimales.",
  /** KOK-143: shown live under a count line's quantity field instead of silently reverting the
   * value the owner just typed (e.g. more than 3 decimals). */
  countQtyInvalid: "Ingresa una cantidad válida (0 o mayor, máx. 3 decimales).",
  unitAbbrev: {
    KG: "kg",
    L: "L",
    UNIT: "u",
    M: "m",
  } satisfies Record<Unit, string>,
  noCountLines: "No hay ítems para contar todavía.",
  countNeedsCatalog: "Guarda el catálogo en el paso 3 antes de hacer el conteo inicial.",
  submitCount: "Confirmar y finalizar",

  // --- Completion --------------------------------------------------------------------------------
  redirecting: "Listo, te llevamos al panel…",
  completedTitle: "Configuración inicial completada",
  completedBody: "Tu espacio ya está listo para trabajar.",
  goToPanel: "Ir al panel",
  alreadySaved: "Ya guardado",
  savedBalancesBody: "Estos saldos ya fueron guardados y no se pueden volver a enviar desde aquí.",
  savedCatalogBody: "Estos ítems ya están guardados. Puedes editarlos o agregar nuevos desde aquí.",
} as const;

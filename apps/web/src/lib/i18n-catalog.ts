// Spanish (es-BO) copy for the Catalog screen (SC-15), ItemForm, and ItemPicker.
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-nav.ts.

export const catalogLabels = {
  title: "Catálogo",
  subtitle: "Ítems y sus alias para compras, producción y ventas.",
  newItem: "Nuevo ítem",
  searchPlaceholder: "Buscar por nombre o alias…",
  filterKindAll: "Todos los tipos",
  filterCategoryAll: "Todas las categorías",
  filterActiveAll: "Todos",
  filterActiveOnly: "Activos",
  filterInactiveOnly: "Inactivos",

  columnName: "Nombre",
  columnUnit: "Unidad",
  columnKind: "Tipo",
  columnCategory: "Categoría",
  columnPrice: "Precio",
  columnMinStock: "Stock mínimo",
  columnAliases: "Alias",
  columnActive: "Activo",

  mergeDuplicates: "Fusionar duplicados",
  noItems: "No hay ítems que coincidan con el filtro.",
  loading: "Cargando…",
  calculated: "calculado",

  createTitle: "Nuevo ítem",
  editTitle: "Editar ítem",
  fieldName: "Nombre",
  fieldKind: "Tipo",
  fieldCategory: "Categoría",
  fieldUnit: "Unidad",
  fieldSalePrice: "Precio de venta (Bs)",
  fieldMinStock: "Stock mínimo",
  fieldIsUnmetered: "No medido",
  fieldReplacementCost: "Costo de reposición (Bs)",
  tooltipFieldMinStock:
    "Es el umbral por debajo del cual este ítem se marca como stock bajo en la pantalla Inventario.",
  tooltipFieldIsUnmetered:
    "Los ítems no medidos, como el agua, se excluyen del seguimiento preciso del consumo en producción porque su uso no se mide por lote.",
  tooltipFieldReplacementCost:
    "Es el costo de hoy para reemplazar este ítem. Se usa para calcular el margen a costo de reposición, distinto del margen basado en el costo promedio ponderado histórico (WAC).",
  costRateHelp: "Puedes usar coma o punto (máx. 5 decimales).",
  fieldNotes: "Notas",
  fieldAliases: "Alias",
  tooltipFieldAliases:
    "Ejemplo: Pan integral de 300 gr = Pint3. Los alias ya impulsan la búsqueda del catálogo y del selector de ítems hoy, y son la base de la identificación de ítems del asistente de la Fase 4; no son datos de relleno.",
  addAlias: "Agregar",
  aliasPlaceholder: "Nuevo alias…",
  save: "Guardar",
  cancel: "Cancelar",
  create: "Crear",
  activate: "Activar",
  deactivate: "Desactivar",
  removeAlias: "Quitar alias",
  close: "Cerrar",

  mergeTitle: "Fusionar ítems duplicados",
  mergeSourceLabel: "Ítem duplicado (se desactivará)",
  mergeTargetLabel: "Ítem que se mantiene",
  mergeConfirm: "Fusionar",
  mergeHelp:
    "Los alias del ítem duplicado pasan al ítem que se mantiene. El duplicado queda desactivado, no se elimina.",
  mergeSameItemError: "Elige dos ítems distintos para fusionar.",

  itemPickerPlaceholder: "Buscar ítem…",
  itemPickerEmpty: "Sin resultados.",
  itemPickerCreateNew: "Crear",

  wac: "Costo promedio",
  replacementCostMc: "Costo de reposición",

  kindLabels: {
    RAW_MATERIAL: "Materia prima",
    SEMI_FINISHED: "Semielaborado",
    FINISHED: "Producto final",
    PACKAGING: "Empaque",
  },
  categoryLabels: {
    INGREDIENT: "Ingrediente",
    NOT_EATABLE: "No comestible",
    BAKERY: "Panadería",
    DAIRY: "Lácteo",
    PASTRY: "Pastelería",
    OTHER: "Otro",
  },
  unitLabels: {
    KG: "Kilogramos (kg)",
    L: "Litros (L)",
    UNIT: "Unidad (u)",
    M: "Metros (m)",
  },

  errors: {
    salePriceRequired: "El precio de venta es obligatorio para productos finales.",
    salePriceForbidden:
      "El precio de venta no aplica a materias primas, semielaborados ni empaques.",
    minStockQtyRequired: "Define un stock mínimo para materias primas y empaques.",
    minStockQtyForbidden: "El stock mínimo no aplica a productos finales.",
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    nameRequired: "El nombre es obligatorio.",
    replacementCostMcInvalid: "Ingresa un costo de reposición válido (0 o mayor).",
    replacementCostMcTooManyDecimals: "Usa como máximo 5 decimales.",
    salePriceInvalid: "Ingresa un precio de venta válido (0 o mayor).",
    minStockQtyInvalid: "Ingresa un stock mínimo válido (0 o mayor).",
  },
} as const;

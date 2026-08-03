// Spanish (es-BO) copy for the Catalog screen (SC-15), ItemForm, and ItemPicker.
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-nav.ts.

export const catalogLabels = {
  title: "CatÃ¡logo",
  subtitle: "Ãtems y sus alias para compras, producciÃ³n y ventas.",
  newItem: "Nuevo Ã­tem",
  searchPlaceholder: "Buscar por nombre o aliasâ€¦",
  filterKindAll: "Todos los tipos",
  filterCategoryAll: "Todas las categorÃ­as",
  filterActiveAll: "Todos",
  filterActiveOnly: "Activos",
  filterInactiveOnly: "Inactivos",

  columnName: "Nombre",
  columnUnit: "Unidad",
  columnKind: "Tipo",
  columnCategory: "CategorÃ­a",
  columnPrice: "Precio",
  columnMinStock: "Stock mÃ­nimo",
  columnAliases: "Alias",
  columnActive: "Activo",

  mergeDuplicates: "Fusionar duplicados",
  noItems: "No hay Ã­tems que coincidan con el filtro.",
  loading: "Cargandoâ€¦",
  calculated: "calculado",

  createTitle: "Nuevo Ã­tem",
  editTitle: "Editar Ã­tem",
  fieldName: "Nombre",
  fieldKind: "Tipo",
  fieldCategory: "CategorÃ­a",
  fieldUnit: "Unidad",
  fieldSalePrice: "Precio de venta (Bs)",
  fieldMinStock: "Stock mÃ­nimo",
  fieldNotes: "Notas",
  fieldAliases: "Alias",
  addAlias: "Agregar",
  aliasPlaceholder: "Nuevo aliasâ€¦",
  save: "Guardar",
  cancel: "Cancelar",
  create: "Crear",
  activate: "Activar",
  deactivate: "Desactivar",
  removeAlias: "Quitar alias",
  close: "Cerrar",

  mergeTitle: "Fusionar Ã­tems duplicados",
  mergeSourceLabel: "Ãtem duplicado (se desactivarÃ¡)",
  mergeTargetLabel: "Ãtem que se mantiene",
  mergeConfirm: "Fusionar",
  mergeHelp:
    "Los alias del Ã­tem duplicado pasan al Ã­tem que se mantiene. El duplicado queda desactivado, no se elimina.",
  mergeSameItemError: "Elige dos Ã­tems distintos para fusionar.",

  itemPickerPlaceholder: "Buscar Ã­temâ€¦",
  itemPickerEmpty: "Sin resultados.",
  itemPickerCreateNew: "Crear",

  wac: "Costo promedio",
  replacementCostMc: "Costo de reposiciÃ³n",

  kindLabels: {
    RAW_MATERIAL: "Materia prima",
    SEMI_FINISHED: "Semielaborado",
    FINISHED: "Producto final",
  },
  categoryLabels: {
    INGREDIENT: "Ingrediente",
    PACKAGING: "Empaque",
    LABEL: "Etiqueta",
    BAKERY: "PanaderÃ­a",
    DAIRY: "LÃ¡cteo",
    PASTRY: "Pastelería",
    OTHER: "Otro",
  },
  unitLabels: {
    G: "Gramos (g)",
    KG: "Kilogramos (kg)",
    ML: "Mililitros (ml)",
    L: "Litros (L)",
    UNIT: "Unidad (u)",
    M: "Metros (m)",
  },

  errors: {
    generic: "OcurriÃ³ un error inesperado. Intenta de nuevo.",
    nameRequired: "El nombre es obligatorio.",
  },
} as const;

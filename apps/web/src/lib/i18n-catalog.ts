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
  fieldNotes: "Notas",
  fieldAliases: "Alias",
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
  replacementCost: "Costo de reposición",

  kindLabels: {
    RAW_MATERIAL: "Materia prima",
    SEMI_FINISHED: "Semielaborado",
    FINISHED: "Producto final",
  },
  categoryLabels: {
    INGREDIENT: "Ingrediente",
    PACKAGING: "Empaque",
    LABEL: "Etiqueta",
    BAKERY: "Panadería",
    DAIRY: "Lácteo",
    OTHER: "Otro",
  },
  unitLabels: {
    G: "Gramos (g)",
    KG: "Kilogramos (kg)",
    ML: "Mililitros (ml)",
    L: "Litros (l)",
    UNIT: "Unidad (u)",
  },

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    nameRequired: "El nombre es obligatorio.",
  },
} as const;

// Spanish (es-BO) copy for CustomerForm and CustomerPicker (KOK-032).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-catalog.ts.

export const customersLabels = {
  fieldName: "Nombre",
  fieldPhone: "Teléfono",
  fieldNotes: "Notas",
  save: "Guardar",
  cancel: "Cancelar",
  create: "Crear",

  createTitle: "Nuevo cliente",
  editTitle: "Editar cliente",

  customerPickerPlaceholder: "Buscar cliente…",
  customerPickerEmpty: "Sin resultados.",
  customerPickerCreateNew: "Crear",
  customerPickerEdit: "Editar cliente",
  customerPickerNone: "Sin cliente",

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    nameRequired: "El nombre es obligatorio.",
  },
} as const;

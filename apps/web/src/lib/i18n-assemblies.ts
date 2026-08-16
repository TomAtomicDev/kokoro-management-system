export const assembliesLabels = {
  recordTitle: "Nuevo armado",
  backToProduction: "Producción",

  fieldDefinition: "Definición",
  definitionPlaceholder: "Sin definición (entrada manual)",
  fieldOutputItem: "Producto de salida",
  outputItemPlaceholder: "Selecciona un producto terminado",
  fieldDate: "Fecha",
  fieldPlannedOutputQty: "Salida planificada",
  fieldActualOutputQty: "Salida real",
  fieldNotes: "Notas",
  notesPlaceholder: "Opcional",

  linesTitle: "Componentes consumidos",
  lineItem: "Componente",
  lineQty: "Cantidad",
  unit: "Unidad",
  addLine: "Agregar componente",
  removeLine: "Quitar componente",
  lineContribution: "Aporte al costo",
  lineStockSufficient: "Stock suficiente",
  lineStockInsufficient: "Stock insuficiente",

  sessionAttachOpen: (typeLabel: string, duration: string) =>
    `Se vinculará a: ${typeLabel} · ${duration} (sesión abierta)`,
  sessionAttachNew: "Se abrirá una nueva sesión de Producción.",

  costDirectLabel: "Costo directo",
  costDirectFormula: "Σ(cantidad consumida × costo promedio ponderado del componente)",
  costUnitLabel: "Costo unitario",
  costUnitFormula: "costo directo ÷ salida real",

  cancel: "Cancelar",
  submit: "Registrar armado",

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidLine: "Cada componente necesita un ítem y una cantidad válida.",
    outputItemRequired: "Selecciona un producto de salida.",
    outputQtyInvalid: "Ingresa una salida real válida (mayor a cero).",
  },

  impactCreateTitle: "¿Registrar el armado?",
  impactCreateDescription:
    "Este armado tiene fecha anterior a movimientos ya registrados y cambia costos ya calculados. Revisa el impacto y confirma para guardarlo.",
} as const;

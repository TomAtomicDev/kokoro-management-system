// Spanish (es-BO) copy for the persistent app shell (sidebar, topbar, mobile tabs).
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+).

export const navLabels = {
  panel: "Panel",
  registrar: "Registrar",
  sectionOperacion: "Operación",
  ventas: "Ventas",
  pedidos: "Pedidos",
  produccion: "Producción",
  envasar: "Envasar",
  compras: "Compras",
  inventario: "Inventario",
  sesiones: "Sesiones",
  sectionDinero: "Dinero",
  finanzas: "Finanzas",
  sectionAnalisis: "Análisis",
  preciosYMargenes: "Precios y márgenes",
  reportes: "Reportes",
  asistente: "Asistente",
  configuracion: "Configuración",
  iaOps: "IA Ops",
} as const;

export const topbarLabels = {
  searchPlaceholder: "Buscar…",
  searchShortcutHint: "⌘K",
  quickAdd: "+ Sesión",
  alerts: "Alertas",
  recipeTimer: {
    title: "Temporizador",
    close: "Cerrar menú del temporizador",
    running: "En curso",
    finished: "Terminó",
    stop: "Detener temporizador",
    dismiss: "Cerrar aviso",
  },
  calculator: {
    title: "Calculadora",
    open: "Abrir calculadora",
    close: "Cerrar calculadora",
    expression: "Operación",
    result: "Resultado",
    keypad: "Teclado de calculadora",
    copy: "Copiar resultado",
    copied: "Resultado copiado",
    copyError: "No se pudo copiar",
    backspace: "Borrar último dígito",
    decimal: "Separador decimal",
    equals: "Calcular resultado",
    add: "Sumar",
    subtract: "Restar",
    multiply: "Multiplicar",
    divide: "Dividir",
    errors: {
      invalidExpression: "Ingresa una operación válida",
      divisionByZero: "No se puede dividir por cero",
    },
  },
} as const;

export const mobileTabLabels = {
  panel: "Panel",
  ventas: "Ventas",
  inventario: "Inventario",
  finanzas: "Finanzas",
  mas: "Más",
} as const;

export const placeholderLabels = {
  comingSoon: "próximamente",
} as const;

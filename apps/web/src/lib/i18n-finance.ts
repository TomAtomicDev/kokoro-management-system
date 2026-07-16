// Spanish (es-BO) copy for the Finance screen (SC-10), account cards, and the
// gasto/ingreso/transferencia/retiro forms.
// TODO: migrate into packages/shared/i18n/es.ts once that module exists (KOK-006+), same as
// i18n-catalog.ts.

import type {
  FinancialAccountType,
  FinancialTransactionCategory,
  FinancialTransactionType,
} from "@kokoro/shared";

export const financeLabels = {
  title: "Finanzas",
  subtitle: "Cuentas, movimientos y transferencias.",

  // `satisfies Record<Enum, string>` below each of these three label maps guarantees every enum
  // member has a translation — a missing case fails `tsc`, not a blank cell at runtime.
  accountTypeLabels: {
    BANK: "Banco",
    CASH: "Caja chica",
  } satisfies Record<FinancialAccountType, string>,
  balance: "Saldo",

  actionTransfer: "Transferir",
  actionWithdraw: "Retiro personal",
  actionRecordExpense: "Registrar gasto",
  actionRecordIncome: "Registrar otro ingreso",

  liabilityLabel: "Anticipos de clientes",
  receivableLabel: "Por cobrar",
  comingSoon: "Próximamente",

  columnDate: "Fecha",
  columnAccount: "Cuenta",
  columnType: "Tipo",
  columnCategory: "Categoría",
  columnAmount: "Monto",
  columnDescription: "Descripción",
  columnSource: "Origen",

  typeLabels: {
    INCOME: "Ingreso",
    EXPENSE: "Gasto",
    TRANSFER_IN: "Transferencia (entrada)",
    TRANSFER_OUT: "Transferencia (salida)",
  } satisfies Record<FinancialTransactionType, string>,
  categoryLabels: {
    SALE: "Venta",
    ORDER_DEPOSIT: "Anticipo de pedido",
    ORDER_BALANCE: "Saldo de pedido",
    DEBT_COLLECTION: "Cobro de deuda",
    OTHER_INCOME: "Otro ingreso",
    SUPPLY_PURCHASE: "Compra de insumos",
    OPERATING_EXPENSE: "Gasto operativo",
    EQUIPMENT: "Equipamiento",
    DEPOSIT_REFUND: "Devolución de anticipo",
    OWNER_WITHDRAWAL: "Retiro personal",
    TRANSFER: "Transferencia",
    OTHER_EXPENSE: "Otro gasto",
  } satisfies Record<FinancialTransactionCategory, string>,

  systemOwnedBadge: "Sistema",
  systemOwnedHint: "Editar el evento origen (aún no disponible)",

  noTransactions: "No hay movimientos registrados.",
  loading: "Cargando…",

  fieldAccount: "Cuenta",
  fieldFromAccount: "Cuenta de origen",
  fieldToAccount: "Cuenta destino",
  fieldCategory: "Categoría",
  fieldAmount: "Monto (Bs)",
  fieldDate: "Fecha",
  fieldDescription: "Descripción",
  descriptionPlaceholder: "Opcional",

  save: "Guardar",
  cancel: "Cancelar",
  submitExpense: "Registrar gasto",
  submitIncome: "Registrar ingreso",
  submitTransfer: "Transferir",
  submitWithdraw: "Retirar",

  recordExpenseTitle: "Registrar gasto",
  recordIncomeTitle: "Registrar otro ingreso",
  transferTitle: "Transferir entre cuentas",
  withdrawTitle: "Retiro personal",

  errors: {
    generic: "Ocurrió un error inesperado. Intenta de nuevo.",
    invalidAmount: "El monto debe ser mayor a cero.",
    sameAccount: "La cuenta de origen y destino no pueden ser la misma.",
  },
} as const;

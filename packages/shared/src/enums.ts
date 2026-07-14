// Single source of truth for every CHECK (... IN (...)) value set in Doc 04's
// DDL. String literals MUST match the DDL verbatim — the Drizzle schema
// (KOK-005) mirrors the same DDL, and command DTOs (ADR-008 single-contract
// rule) import these arrays / Zod schemas directly. Do not reorder or rename
// without updating Doc 04 in the same PR (rule D-6).

import { z } from "zod";

// --- items ---------------------------------------------------------------
export const ITEM_KINDS = ["RAW_MATERIAL", "SEMI_FINISHED", "FINISHED"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const itemKindSchema = z.enum(ITEM_KINDS);

export const ITEM_CATEGORIES = [
  "INGREDIENT",
  "PACKAGING",
  "LABEL",
  "BAKERY",
  "DAIRY",
  "OTHER",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const itemCategorySchema = z.enum(ITEM_CATEGORIES);

export const UNITS = ["G", "KG", "ML", "L", "UNIT"] as const;
export type Unit = (typeof UNITS)[number];
export const unitSchema = z.enum(UNITS);

// --- sessions ------------------------------------------------------------
export const SESSION_TYPES = [
  "PRODUCTION",
  "PURCHASE_TRIP",
  "DELIVERY_RUN",
  "ADMIN",
  "OTHER",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
export const sessionTypeSchema = z.enum(SESSION_TYPES);

export const SESSION_STATUSES = ["OPEN", "CLOSED"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const sessionStatusSchema = z.enum(SESSION_STATUSES);

// --- sales ---------------------------------------------------------------
export const SALE_CHANNELS = ["CATALOG", "CUSTOM_ORDER"] as const;
export type SaleChannel = (typeof SALE_CHANNELS)[number];
export const saleChannelSchema = z.enum(SALE_CHANNELS);

export const PAYMENT_STATUSES = ["PAID", "ON_CREDIT"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const PAYMENT_METHODS = ["CASH", "BANK_QR"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);

// --- custom_orders -------------------------------------------------------
export const CUSTOM_ORDER_STATUSES = [
  "QUOTING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
  "DELIVERED",
  "CANCELLED",
] as const;
export type CustomOrderStatus = (typeof CUSTOM_ORDER_STATUSES)[number];
export const customOrderStatusSchema = z.enum(CUSTOM_ORDER_STATUSES);

export const CANCEL_RESOLUTIONS = ["REFUND", "FORFEIT"] as const;
export type CancelResolution = (typeof CANCEL_RESOLUTIONS)[number];
export const cancelResolutionSchema = z.enum(CANCEL_RESOLUTIONS);

// --- stock_exits ---------------------------------------------------------
export const STOCK_EXIT_REASONS = [
  "WASTE",
  "SELF_CONSUMPTION",
  "GIFT_SAMPLE",
  "SPOILAGE",
  "OTHER",
] as const;
export type StockExitReason = (typeof STOCK_EXIT_REASONS)[number];
export const stockExitReasonSchema = z.enum(STOCK_EXIT_REASONS);

// --- stock_movements -----------------------------------------------------
export const STOCK_MOVEMENT_TYPES = [
  "PURCHASE_IN",
  "PRODUCTION_IN",
  "PRODUCTION_OUT",
  "SALE_OUT",
  "EXIT_OUT",
  "ADJUST",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const stockMovementTypeSchema = z.enum(STOCK_MOVEMENT_TYPES);

// --- financial_accounts --------------------------------------------------
export const FINANCIAL_ACCOUNT_TYPES = ["BANK", "CASH"] as const;
export type FinancialAccountType = (typeof FINANCIAL_ACCOUNT_TYPES)[number];
export const financialAccountTypeSchema = z.enum(FINANCIAL_ACCOUNT_TYPES);

// --- financial_transactions ---------------------------------------------
export const FINANCIAL_TRANSACTION_TYPES = [
  "INCOME",
  "EXPENSE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;
export type FinancialTransactionType = (typeof FINANCIAL_TRANSACTION_TYPES)[number];
export const financialTransactionTypeSchema = z.enum(FINANCIAL_TRANSACTION_TYPES);

export const FINANCIAL_TRANSACTION_CATEGORIES = [
  "SALE",
  "ORDER_DEPOSIT",
  "ORDER_BALANCE",
  "DEBT_COLLECTION",
  "OTHER_INCOME",
  "SUPPLY_PURCHASE",
  "OPERATING_EXPENSE",
  "EQUIPMENT",
  "DEPOSIT_REFUND",
  "OWNER_WITHDRAWAL",
  "TRANSFER",
  "OTHER_EXPENSE",
] as const;
export type FinancialTransactionCategory = (typeof FINANCIAL_TRANSACTION_CATEGORIES)[number];
export const financialTransactionCategorySchema = z.enum(FINANCIAL_TRANSACTION_CATEGORIES);

// --- inventory_counts ----------------------------------------------------
export const INVENTORY_COUNT_STATUSES = ["DRAFT", "COMMITTED"] as const;
export type InventoryCountStatus = (typeof INVENTORY_COUNT_STATUSES)[number];
export const inventoryCountStatusSchema = z.enum(INVENTORY_COUNT_STATUSES);

// --- audit_log -----------------------------------------------------------
export const AUDIT_ACTORS = ["OWNER_WEB", "OWNER_TELEGRAM", "ASSISTANT", "SYSTEM"] as const;
export type AuditActor = (typeof AUDIT_ACTORS)[number];
export const auditActorSchema = z.enum(AUDIT_ACTORS);

// --- assistant_interactions ---------------------------------------------
export const ASSISTANT_CHANNELS = ["TELEGRAM", "WEB"] as const;
export type AssistantChannel = (typeof ASSISTANT_CHANNELS)[number];
export const assistantChannelSchema = z.enum(ASSISTANT_CHANNELS);

export const ASSISTANT_PIPELINES = ["CAPTURE", "QUERY"] as const;
export type AssistantPipeline = (typeof ASSISTANT_PIPELINES)[number];
export const assistantPipelineSchema = z.enum(ASSISTANT_PIPELINES);

export const ASSISTANT_OUTCOMES = ["ACCEPTED", "EDITED", "REJECTED", "ANSWERED", "FAILED"] as const;
export type AssistantOutcome = (typeof ASSISTANT_OUTCOMES)[number];
export const assistantOutcomeSchema = z.enum(ASSISTANT_OUTCOMES);

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const bindings = [
  {
    schema: "packages/shared/src/catalog.ts",
    schemaExpression: "safeText(ITEM_NAME_MAX_LENGTH)",
    ui: "components/catalog/ItemForm.tsx",
    uiExpression: "maxLength={ITEM_NAME_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/catalog.ts",
    schemaExpression: "safeText(ITEM_ALIAS_MAX_LENGTH)",
    ui: "components/catalog/ItemDetailDrawer.tsx",
    uiExpression: "maxLength={ITEM_ALIAS_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/customers.ts",
    schemaExpression: "safeText(CUSTOMER_NAME_MAX_LENGTH)",
    ui: "components/customers/CustomerForm.tsx",
    uiExpression: "maxLength={CUSTOMER_NAME_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/customers.ts",
    schemaExpression: "safeText(CUSTOMER_PHONE_MAX_LENGTH)",
    ui: "components/customers/CustomerForm.tsx",
    uiExpression: "maxLength={CUSTOMER_PHONE_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/customers.ts",
    schemaExpression: "safeText(CUSTOMER_NOTES_MAX_LENGTH)",
    ui: "components/customers/CustomerForm.tsx",
    uiExpression: "maxLength={CUSTOMER_NOTES_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/purchasing.ts",
    schemaExpression: "safeText(PURCHASE_NOTES_MAX_LENGTH)",
    ui: "components/purchases/PurchaseForm.tsx",
    uiExpression: "maxLength={PURCHASE_NOTES_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/sales.ts",
    schemaExpression: "safeText(SALE_NOTES_MAX_LENGTH)",
    ui: "components/sales/SaleForm.tsx",
    uiExpression: "maxLength={SALE_NOTES_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/production-runs.ts",
    schemaExpression: "safeText(PRODUCTION_RUN_NOTES_MAX_LENGTH)",
    ui: "components/production/ProductionRunForm.tsx",
    uiExpression: "maxLength={PRODUCTION_RUN_NOTES_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/sessions.ts",
    schemaExpression: "safeText(SESSION_NOTES_MAX_LENGTH)",
    ui: "components/sessions/SessionForm.tsx",
    uiExpression: "maxLength={SESSION_NOTES_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/sessions.ts",
    schemaExpression: "safeText(SESSION_COST_LABEL_MAX_LENGTH)",
    ui: "components/sessions/SessionForm.tsx",
    uiExpression: "maxLength={SESSION_COST_LABEL_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/exits.ts",
    schemaExpression: "safeText(STOCK_EXIT_NOTES_MAX_LENGTH)",
    ui: "components/inventory/ExitForm.tsx",
    uiExpression: "maxLength={STOCK_EXIT_NOTES_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/orders.ts",
    schemaExpression: "safeText(ORDER_DESCRIPTION_MAX_LENGTH)",
    ui: "components/orders/QuoteOrderForm.tsx",
    uiExpression: "maxLength={ORDER_DESCRIPTION_MAX_LENGTH}",
  },
  {
    schema: "packages/shared/src/orders.ts",
    schemaExpression: "safeText(ORDER_NOTES_MAX_LENGTH)",
    ui: "components/orders/QuoteOrderForm.tsx",
    uiExpression: "maxLength={ORDER_NOTES_MAX_LENGTH}",
  },
] as const;

function readSource(relativePath: string): string {
  const path = relativePath.startsWith("packages/")
    ? resolve(sourceRoot, "..", "..", "..", relativePath)
    : resolve(sourceRoot, relativePath);
  return readFileSync(path, "utf8");
}

describe("client-side text length caps", () => {
  it("binds every capped UI field to its shared safeText bound", () => {
    for (const binding of bindings) {
      expect(readSource(binding.schema), binding.schema).toContain(binding.schemaExpression);
      expect(readSource(binding.ui), binding.ui).toContain(binding.uiExpression);
    }
  });

  it("does not leave numeric maxLength literals in the web source", () => {
    const uiSource = bindings
      .map((binding) => readSource(binding.ui))
      .filter((source, index, sources) => sources.indexOf(source) === index)
      .join("\n");

    expect(uiSource).not.toMatch(/maxLength=\{\d+\}/);
  });
});

// Row -> DTO mapping for core/customers/customers.ts. Kept separate for the same reason
// core/catalog/dto.ts is: none of the service functions need to duplicate CustomerDto's shape.

import type { CustomerDto } from "@kokoro/shared";

import type { customers } from "../../db/schema.js";

type CustomerRow = typeof customers.$inferSelect;

export function toCustomerDto(row: CustomerRow): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

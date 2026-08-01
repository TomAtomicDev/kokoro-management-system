// Customer CRUD (KOK-032, Doc 04 §3.3). Minimal by design (Doc 01 non-goals: "no CRM ambitions")
// — name/phone/notes only, no delete (see customers.ts's header in packages/shared). Every
// mutation is its own db.batch() (D-3): the row write + its audit_log entry, together.

import type {
  AuditActor,
  CreateCustomerCommand,
  CustomerDto,
  ListCustomersFilters,
  ListCustomersResult,
  UpdateCustomerCommand,
} from "@kokoro/shared";
import { generateUuidV7, nowIso } from "@kokoro/shared";
import { eq } from "drizzle-orm";

import type { Db } from "../../db/index.js";
import { customers } from "../../db/schema.js";
import { buildAuditLogInsert } from "../audit.js";
import { notFound } from "../errors.js";
import { toCustomerDto } from "./dto.js";

export async function createCustomer(
  db: Db,
  command: CreateCustomerCommand,
  actor: AuditActor,
): Promise<CustomerDto> {
  const now = nowIso();
  const row = {
    id: generateUuidV7(),
    name: command.name,
    phone: command.phone ?? null,
    notes: command.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db.batch([
    db.insert(customers).values(row),
    buildAuditLogInsert(db, {
      actor,
      action: "create",
      entityType: "customer",
      entityId: row.id,
      before: null,
      after: row,
    }),
  ]);

  return toCustomerDto(row);
}

export async function updateCustomer(
  db: Db,
  command: UpdateCustomerCommand,
  actor: AuditActor,
): Promise<CustomerDto> {
  const existingRow = await db.query.customers.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, command.id),
  });
  if (!existingRow) {
    throw notFound("No se encontró el cliente.", { id: command.id });
  }

  const now = nowIso();
  const patch = {
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.phone !== undefined ? { phone: command.phone } : {}),
    ...(command.notes !== undefined ? { notes: command.notes } : {}),
    updatedAt: now,
  };
  const updatedRow = { ...existingRow, ...patch };

  await db.batch([
    db.update(customers).set(patch).where(eq(customers.id, command.id)),
    buildAuditLogInsert(db, {
      actor,
      action: "update",
      entityType: "customer",
      entityId: command.id,
      before: existingRow,
      after: updatedRow,
    }),
  ]);

  return toCustomerDto(updatedRow);
}

export async function getCustomer(db: Db, id: string): Promise<CustomerDto> {
  const row = await db.query.customers.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.id, id),
  });
  if (!row) {
    throw notFound("No se encontró el cliente.", { id });
  }
  return toCustomerDto(row);
}

export async function listCustomers(
  db: Db,
  filters: ListCustomersFilters,
): Promise<ListCustomersResult> {
  const rows = await db.query.customers.findMany({
    where: (t, { like, or }) => {
      if (!filters.search) return undefined;
      const pattern = `%${filters.search}%`;
      return or(like(t.name, pattern), like(t.phone, pattern));
    },
    orderBy: (t, { asc }) => asc(t.name),
  });
  return { customers: rows.map(toCustomerDto) };
}

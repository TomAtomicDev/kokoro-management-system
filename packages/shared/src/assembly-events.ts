import { z } from "zod";
import { confirmFlagSchema } from "./costing.js";
import { businessDateSchema, occurredAtSchema } from "./production-runs.js";
import { safeText } from "./text.js";

export const assemblyLineCommandSchema = z.object({
  itemId: z.string().min(1),
  qty: z
    .number()
    .int()
    .positive("La cantidad de la línea debe ser un entero positivo (mili-unidades)."),
});
export type AssemblyLineCommand = z.infer<typeof assemblyLineCommandSchema>;

export const recordAssemblyCommandSchema = z.object({
  occurredAt: occurredAtSchema,
  businessDate: businessDateSchema,
  definitionId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  customOrderId: z.string().min(1).optional(),
  outputItemId: z.string().min(1),
  plannedOutputQty: z.number().int().positive().optional(),
  actualOutputQty: z
    .number()
    .int()
    .positive("La cantidad de salida real debe ser un entero positivo (mili-unidades)."),
  notes: z.string().trim().pipe(safeText(2000)).optional(),
  lines: z.array(assemblyLineCommandSchema).min(1, "Se requiere al menos un componente consumido."),
  confirm: confirmFlagSchema,
});
/** `z.input`, not `z.infer`: `confirm` defaults to false, so callers may omit it. */
export type RecordAssemblyCommand = z.input<typeof recordAssemblyCommandSchema>;

export const updateAssemblyCommandSchema = recordAssemblyCommandSchema;
export type UpdateAssemblyCommand = z.input<typeof updateAssemblyCommandSchema>;

export const deleteAssemblyCommandSchema = z.object({ confirm: confirmFlagSchema });
export type DeleteAssemblyCommand = z.input<typeof deleteAssemblyCommandSchema>;

export const assemblyImpactRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), command: recordAssemblyCommandSchema }),
  z.object({
    op: z.literal("update"),
    id: z.string().min(1),
    command: updateAssemblyCommandSchema,
  }),
  z.object({ op: z.literal("delete"), id: z.string().min(1) }),
]);
export type AssemblyImpactRequest = z.input<typeof assemblyImpactRequestSchema>;

export const listAssembliesFiltersSchema = z.object({
  outputItemId: z.string().min(1).optional(),
  customOrderId: z.string().min(1).optional(),
  fromDate: businessDateSchema.optional(),
  toDate: businessDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type ListAssembliesFilters = z.infer<typeof listAssembliesFiltersSchema>;

export interface AssemblyLineDto {
  id: string;
  itemId: string;
  qty: number;
  unitCostSnapshotMc: number;
}

export interface AssemblyDto {
  id: string;
  occurredAt: string;
  businessDate: string;
  definitionId: string | null;
  sessionId: string;
  customOrderId: string | null;
  outputItemId: string;
  plannedOutputQty: number | null;
  actualOutputQty: number;
  directCost: number;
  outputUnitCostMc: number;
  notes: string | null;
  lines: AssemblyLineDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RecordAssemblyResult {
  assembly: AssemblyDto;
}

export interface UpdateAssemblyResult {
  assembly: AssemblyDto;
}

export interface DeleteAssemblyResult {
  assembly: AssemblyDto;
  deletedAt: string;
}

export interface GetAssemblyResult {
  assembly: AssemblyDto;
}

export interface ListAssembliesResult {
  assemblies: AssemblyDto[];
}

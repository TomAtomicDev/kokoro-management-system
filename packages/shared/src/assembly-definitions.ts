// Assembly-definition command schemas and DTOs (KOK-123, Doc 03 §3/§4 C-3d). Definitions are
// reusable presentation/combo templates, not inventory events; their live cost previews are
// derived by core/ and never accepted from callers.

import { z } from "zod";
import type { RecipeSettingsDto } from "./recipes.js";
import { safeText } from "./text.js";

const assemblyDefinitionNameSchema = z
  .string()
  .trim()
  .min(1, "El nombre de la definición es obligatorio.")
  .pipe(safeText(200));
const notesSchema = z.string().trim().pipe(safeText(2000)).nullable().optional();

export const assemblyDefinitionLineCommandSchema = z.object({
  itemId: z.string().min(1),
  qty: z
    .number()
    .int()
    .positive("La cantidad de la línea debe ser un entero positivo (mili-unidades)."),
});
export type AssemblyDefinitionLineCommand = z.infer<typeof assemblyDefinitionLineCommandSchema>;

export const recordAssemblyDefinitionCommandSchema = z.object({
  name: assemblyDefinitionNameSchema,
  outputItemId: z.string().min(1),
  outputQty: z
    .number()
    .int()
    .positive("La cantidad de salida debe ser un entero positivo (mili-unidades)."),
  isDefault: z.boolean().default(false),
  notes: notesSchema,
  lines: z.array(assemblyDefinitionLineCommandSchema).min(1, "Se requiere al menos un componente."),
});
export type RecordAssemblyDefinitionCommand = z.input<typeof recordAssemblyDefinitionCommandSchema>;

export const updateAssemblyDefinitionCommandSchema = recordAssemblyDefinitionCommandSchema;
export type UpdateAssemblyDefinitionCommand = z.input<typeof updateAssemblyDefinitionCommandSchema>;

export const setAssemblyDefinitionActiveCommandSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});
export type SetAssemblyDefinitionActiveCommand = z.infer<
  typeof setAssemblyDefinitionActiveCommandSchema
>;

export const listAssemblyDefinitionsFiltersSchema = z.object({
  outputItemId: z.string().min(1).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});
export type ListAssemblyDefinitionsFilters = z.infer<typeof listAssemblyDefinitionsFiltersSchema>;

export interface AssemblyDefinitionLineDto {
  id: string;
  itemId: string;
  /** Milli-units (Doc 04 §2). */
  qty: number;
}

export interface AssemblyDefinitionCostDto {
  /** Centavos per whole output unit, rounded half-up once. */
  costPerOutputUnit: number;
  margin: { amount: number; pctBasisPoints: number } | null;
}

export interface AssemblyDefinitionDto {
  id: string;
  name: string;
  outputItemId: string;
  /** Milli-units produced by one execution. */
  outputQty: number;
  isDefault: boolean;
  isActive: boolean;
  notes: string | null;
  lines: AssemblyDefinitionLineDto[];
  /** C-3d live preview on the components' current WAC basis. */
  costWac: AssemblyDefinitionCostDto;
  /** C-3d live preview on the components' effective replacement-cost basis. */
  costReplacement: AssemblyDefinitionCostDto;
  createdAt: string;
  updatedAt: string;
}

export interface RecordAssemblyDefinitionResult {
  assemblyDefinition: AssemblyDefinitionDto;
  settings: RecipeSettingsDto;
}

export interface UpdateAssemblyDefinitionResult {
  assemblyDefinition: AssemblyDefinitionDto;
  settings: RecipeSettingsDto;
}

export interface SetAssemblyDefinitionActiveResult {
  assemblyDefinition: AssemblyDefinitionDto;
  settings: RecipeSettingsDto;
}

export interface GetAssemblyDefinitionResult {
  assemblyDefinition: AssemblyDefinitionDto;
  settings: RecipeSettingsDto;
}

export interface ListAssemblyDefinitionsResult {
  assemblyDefinitions: AssemblyDefinitionDto[];
  settings: RecipeSettingsDto;
}

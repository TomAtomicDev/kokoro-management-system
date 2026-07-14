// Login command DTO (KOK-007, ADR-008 single-contract rule): the same schema the future web
// login form and the /api/auth/login route both import, so they can never drift.

import { z } from "zod";

export const loginCommandSchema = z.object({
  password: z.string().min(1, "Ingresa tu contraseña."),
});

export type LoginCommand = z.infer<typeof loginCommandSchema>;

// Hono onError handler mapping DomainError -> HTTP response (Doc 08 §2). Mounted once on the
// root app in index.ts via `app.onError(errorHandler)`. Every Phase 1+ route relies on this
// instead of handling DomainError itself.

import type { ErrorHandler } from "hono";
import { ZodError } from "zod";

import { DomainError } from "../core/errors.js";
import type { Env, Variables } from "../env.js";

export const errorHandler: ErrorHandler<{ Bindings: Env; Variables: Variables }> = (err, c) => {
  if (err instanceof DomainError) {
    return c.json(
      { code: err.code, message_es: err.message_es, details: err.details ?? null },
      err.httpStatus,
    );
  }

  // Zod validation errors from route input parsing (D-4: shared schemas) map the same way a
  // DomainError("VALIDATION", ...) would, without every route needing to catch ZodError itself.
  if (err instanceof ZodError) {
    return c.json(
      {
        code: "VALIDATION",
        message_es: "Los datos enviados no son válidos.",
        details: err.flatten(),
      },
      400,
    );
  }

  console.error(JSON.stringify({ level: "error", message: err.message, stack: err.stack }));
  return c.json(
    {
      code: "INTERNAL",
      message_es: "Ocurrió un error inesperado. Intenta de nuevo.",
      details: null,
    },
    500,
  );
};

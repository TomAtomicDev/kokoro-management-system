// DomainError — the typed error every `core/` service throws for expected failure cases
// (Doc 08 §2). Routes (`api/`) catch it and map `code` to an HTTP status; `message_es` is the
// user-facing string (Spanish, Doc 08 D-9); `details` carries optional structured context
// (e.g. which field failed validation, which entity id was not found).
//
// `code` is intentionally one of exactly the 4 categories Doc 08 §2 maps to HTTP status — it is
// not a specific business error identifier (put that in `message_es`/`details` instead). This
// keeps the route-mapping table trivial and total.

export const DOMAIN_ERROR_CODES = ["VALIDATION", "NOT_FOUND", "CONFLICT", "INTERNAL"] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/** HTTP status each DomainErrorCode maps to (Doc 08 §2: "400 validation, 404, 409 conflict/state-machine, 500"). */
export const DOMAIN_ERROR_HTTP_STATUS: Record<DomainErrorCode, 400 | 404 | 409 | 500> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly message_es: string;
  readonly details: unknown;

  constructor(code: DomainErrorCode, message_es: string, details?: unknown) {
    super(message_es);
    this.name = "DomainError";
    this.code = code;
    this.message_es = message_es;
    this.details = details;
  }

  get httpStatus(): 400 | 404 | 409 | 500 {
    return DOMAIN_ERROR_HTTP_STATUS[this.code];
  }
}

export function notFound(message_es: string, details?: unknown): DomainError {
  return new DomainError("NOT_FOUND", message_es, details);
}

export function validationError(message_es: string, details?: unknown): DomainError {
  return new DomainError("VALIDATION", message_es, details);
}

export function conflict(message_es: string, details?: unknown): DomainError {
  return new DomainError("CONFLICT", message_es, details);
}

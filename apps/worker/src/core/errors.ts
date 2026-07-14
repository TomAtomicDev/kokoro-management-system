// DomainError — the typed error every `core/` service throws for expected failure cases
// (Doc 08 §2). Routes (`api/`) catch it and map `code` to an HTTP status; `message_es` is the
// user-facing string (Spanish, Doc 08 D-9); `details` carries optional structured context
// (e.g. which field failed validation, which entity id was not found).
//
// `code` is one of the categories Doc 08 §2 maps to HTTP status — it is not a specific business
// error identifier (put that in `message_es`/`details` instead). This keeps the route-mapping
// table trivial and total.
//
// UNAUTHORIZED (401) and RATE_LIMITED (429) were added during KOK-007 (owner auth): Doc 08 §2's
// original list (400/404/409/500) predates any auth surface and had no code for "no/invalid
// session" or "too many login attempts" — both required by the KOK-007 backlog entry. Doc 08 §2
// is amended accordingly in the same PR (D-6).

export const DOMAIN_ERROR_CODES = [
  "VALIDATION",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

type DomainHttpStatus = 400 | 401 | 404 | 409 | 429 | 500;

/** HTTP status each DomainErrorCode maps to (Doc 08 §2). */
export const DOMAIN_ERROR_HTTP_STATUS: Record<DomainErrorCode, DomainHttpStatus> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
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

  get httpStatus(): DomainHttpStatus {
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

export function unauthorized(message_es: string, details?: unknown): DomainError {
  return new DomainError("UNAUTHORIZED", message_es, details);
}

export function rateLimited(message_es: string, details?: unknown): DomainError {
  return new DomainError("RATE_LIMITED", message_es, details);
}

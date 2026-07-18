// Thin fetch wrapper for /api/* (KOK-011). Reads the CSRF cookie the auth middleware expects
// (apps/worker/src/auth/csrf.ts: cookie "kokoro_csrf", header "X-CSRF-Token") and surfaces
// DomainError responses (apps/worker/src/api/error-handler.ts) as a typed ApiError so callers can
// show `message_es` directly instead of a generic failure string.

const CSRF_COOKIE_NAME = "kokoro_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";

interface ErrorBody {
  code?: string;
  message_es?: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message_es: string, details: unknown) {
    super(message_es);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

function readCookie(name: string): string | undefined {
  const match = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(document.cookie);
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (method !== "GET") {
    const csrf = readCookie(CSRF_COOKIE_NAME);
    if (csrf) headers.set(CSRF_HEADER_NAME, csrf);
  }

  const response = await fetch(`/api${path}`, { ...init, method, headers, credentials: "include" });
  const body = (await response.json().catch(() => null)) as ErrorBody | T | null;

  if (!response.ok) {
    const errorBody = (body ?? {}) as ErrorBody;
    throw new ApiError(
      errorBody.code ?? "INTERNAL",
      errorBody.message_es ?? "Ocurrió un error inesperado. Intenta de nuevo.",
      errorBody.details,
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: "DELETE" }),
};

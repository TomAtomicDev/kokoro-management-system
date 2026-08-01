// TanStack Query hooks over /api/purchases (KOK-016 frontend). Mirrors features/finance/api.ts's
// shape: a root key + list/detail key helpers, a query hook per resource, and a mutation whose
// onSuccess invalidates the root key.
//
// recordPurchase also moves stock (item_stock) and an account balance (financial_accounts) on the
// server, but there's no shared "inventory"/"finance" query-key invalidation surface yet for this
// mutation to plug into — KOK-017 (inventory screen) and Finance's account balances don't expose
// one today. useRecordPurchase only invalidates the purchases keys below; once those screens exist
// and share a cross-feature invalidation helper, this hook should call into it too.

import type {
  DeletePurchaseCommand,
  DeletePurchaseResult,
  ListPurchasesFilters,
  ListPurchasesResult,
  PurchaseDto,
  PurchaseImpactRequest,
  RecordPurchaseCommand,
  RecordPurchaseResult,
  ReplayImpactDto,
  UpdatePurchaseCommand,
  UpdatePurchaseResult,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, api } from "@/lib/api";

const PURCHASES_ROOT_KEY = ["purchases"] as const;

function purchasesListKey(filters: ListPurchasesFilters) {
  return [...PURCHASES_ROOT_KEY, "list", filters] as const;
}

function purchaseDetailKey(id: string) {
  return [...PURCHASES_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListPurchasesFilters): string {
  const params = new URLSearchParams();
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function usePurchases(filters: ListPurchasesFilters = {}) {
  return useQuery({
    queryKey: purchasesListKey(filters),
    queryFn: () => api.get<ListPurchasesResult>(`/purchases${filtersToQueryString(filters)}`),
  });
}

export function usePurchase(id: string | undefined) {
  return useQuery({
    queryKey: purchaseDetailKey(id ?? ""),
    queryFn: () => api.get<PurchaseDto>(`/purchases/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidatePurchases() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: PURCHASES_ROOT_KEY });
}

export function useRecordPurchase() {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: (command: RecordPurchaseCommand) =>
      api.post<RecordPurchaseResult>("/purchases", command),
    onSuccess: invalidate,
  });
}

// --- Edit / delete / restore / impact preview (KOK-024 Phase G) -----------------------------
//
// These four expose plain, correctly-typed mutations only — the retry-with-confirm dance for the
// R-5 replay-confirmation contract (a 409 CONFLICT carrying a ReplayImpactDto, see
// packages/shared/src/costing.ts) is deliberately NOT wired in here. That orchestration belongs to
// whatever UI composes these with `useReplayConfirmableMutation`
// (apps/web/src/hooks/useReplayConfirmableMutation.ts), same precedent as usePreviewPurchaseImpact
// below staying a plain dry-run mutation with no invalidation of its own.

export function useUpdatePurchase(id: string) {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: (command: UpdatePurchaseCommand) =>
      api.patch<UpdatePurchaseResult>(`/purchases/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useDeletePurchase(id: string) {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: (command: DeletePurchaseCommand) =>
      api.delete<DeletePurchaseResult>(`/purchases/${id}`, command),
    onSuccess: invalidate,
  });
}

export function useRestorePurchase(id: string) {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: (command: DeletePurchaseCommand) =>
      api.post<UpdatePurchaseResult>(`/purchases/${id}/restore`, command),
    onSuccess: invalidate,
  });
}

/** Dry-run preview (no write, so no cache to invalidate) — used to render an ImpactConfirmDialog
 * BEFORE the caller ever attempts the real edit/delete, or composed with
 * `useReplayConfirmableMutation`'s own captured impact from a refused mutation. */
export function usePreviewPurchaseImpact() {
  return useMutation({
    mutationFn: (request: PurchaseImpactRequest) =>
      api.post<ReplayImpactDto>("/purchases/impact", request),
  });
}

// --- Receipt photo upload -------------------------------------------------------------------
//
// POST /purchases/photos takes a raw binary body (Content-Type set to the file's own mime type),
// not a JSON command, so it can't go through lib/api.ts's api.post() (which always JSON-encodes
// the body and sets Content-Type: application/json). This duplicates lib/api.ts's two-line
// CSRF-cookie-header logic rather than exporting it from there: lib/api.ts is a small, stable,
// already-shipped module and this is currently the only binary-upload consumer in the app. If a
// second binary-upload caller shows up, promote readCookie/CSRF_COOKIE_NAME/CSRF_HEADER_NAME to
// exports of lib/api.ts instead of duplicating a third time.
const CSRF_COOKIE_NAME = "kokoro_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";

function readCsrfCookie(): string | undefined {
  const match = new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`).exec(document.cookie);
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

export interface UploadPurchasePhotoResult {
  key: string;
}

export async function uploadPurchasePhoto(file: File): Promise<UploadPurchasePhotoResult> {
  const headers = new Headers({ "Content-Type": file.type || "application/octet-stream" });
  const csrf = readCsrfCookie();
  if (csrf) headers.set(CSRF_HEADER_NAME, csrf);

  const dotIndex = file.name.lastIndexOf(".");
  const ext = dotIndex >= 0 ? file.name.slice(dotIndex + 1) : undefined;
  const query = ext ? `?ext=${encodeURIComponent(ext)}` : "";

  const response = await fetch(`/api/purchases/photos${query}`, {
    method: "POST",
    headers,
    body: file,
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as
    | UploadPurchasePhotoResult
    | { code?: string; message_es?: string; details?: unknown }
    | null;

  if (!response.ok) {
    const errorBody = (body ?? {}) as { code?: string; message_es?: string; details?: unknown };
    throw new ApiError(
      errorBody.code ?? "INTERNAL",
      errorBody.message_es ?? "Ocurrió un error inesperado. Intenta de nuevo.",
      errorBody.details,
    );
  }
  return body as UploadPurchasePhotoResult;
}

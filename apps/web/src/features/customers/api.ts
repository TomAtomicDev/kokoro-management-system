// TanStack Query hooks over /api/customers (KOK-032). Mirrors features/catalog/api.ts's shape —
// every mutation invalidates the "customers" query key so CustomerPicker instances reconcile.

import type {
  CreateCustomerCommand,
  CustomerDto,
  ListCustomersFilters,
  ListCustomersResult,
  UpdateCustomerCommand,
} from "@kokoro/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const CUSTOMERS_ROOT_KEY = ["customers"] as const;

function customersListKey(filters: ListCustomersFilters) {
  return [...CUSTOMERS_ROOT_KEY, "list", filters] as const;
}

function customerDetailKey(id: string) {
  return [...CUSTOMERS_ROOT_KEY, "detail", id] as const;
}

function filtersToQueryString(filters: ListCustomersFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useCustomersQuery(filters: ListCustomersFilters = {}) {
  return useQuery({
    queryKey: customersListKey(filters),
    queryFn: () => api.get<ListCustomersResult>(`/customers${filtersToQueryString(filters)}`),
  });
}

export function useCustomerQuery(id: string | undefined) {
  return useQuery({
    queryKey: customerDetailKey(id ?? ""),
    queryFn: () => api.get<CustomerDto>(`/customers/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateCustomers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CUSTOMERS_ROOT_KEY });
}

export function useCreateCustomerMutation() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: (command: CreateCustomerCommand) => api.post<CustomerDto>("/customers", command),
    onSuccess: invalidate,
  });
}

export function useUpdateCustomerMutation() {
  const invalidate = useInvalidateCustomers();
  return useMutation({
    mutationFn: (command: UpdateCustomerCommand) =>
      api.patch<CustomerDto>(`/customers/${command.id}`, command),
    onSuccess: invalidate,
  });
}

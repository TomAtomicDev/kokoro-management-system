// Combobox over customers, inline "crear cliente" (Doc 06 §4 `CustomerPicker`) — mirrors
// catalog/ItemPicker.tsx's shape. Used by SaleForm (and later KOK-033/034's order forms) for the
// always-optional `customerId` field, so unlike ItemPicker this also offers a way to clear the
// selection back to "no customer".

import type { CustomerDto } from "@kokoro/shared";
import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { useCustomerQuery, useCustomersQuery } from "@/features/customers/api";
import { customersLabels } from "@/lib/i18n-customers";

import { CreateCustomerDialog } from "./CreateCustomerDialog";
import { EditCustomerDialog } from "./EditCustomerDialog";

export interface CustomerPickerProps {
  value: string | null;
  onChange: (customerId: string | null, customer: CustomerDto | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /** On by default — the inline "crear cliente" flow this component exists to provide. */
  allowCreate?: boolean;
}

export function CustomerPicker({
  value,
  onChange,
  placeholder,
  disabled,
  allowCreate = true,
}: CustomerPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedCustomerQuery = useCustomerQuery(value ?? undefined);
  const searchQuery = useCustomersQuery({ search: query.trim() || undefined });
  const selectedCustomer = selectedCustomerQuery.data ?? null;

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const displayValue = open ? query : (selectedCustomerQuery.data?.name ?? "");
  const results = searchQuery.data?.customers ?? [];
  const trimmedQuery = query.trim();
  const exactNameMatch = results.some(
    (customer) => customer.name.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  function selectCustomer(customer: CustomerDto) {
    onChange(customer.id, customer);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1.5">
      <div className="relative flex-1">
        <Input
          value={displayValue}
          placeholder={placeholder ?? customersLabels.customerPickerPlaceholder}
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => setQuery(event.target.value)}
        />

        {open ? (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-muted-foreground text-sm">
                {customersLabels.customerPickerEmpty}
              </p>
            ) : (
              <ul>
                {results.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => selectCustomer(customer)}
                    >
                      <span className="text-foreground">{customer.name}</span>
                      {customer.phone ? (
                        <span className="text-muted-foreground text-xs">{customer.phone}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {allowCreate && trimmedQuery !== "" && !exactNameMatch ? (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 border-border border-t px-3 py-2 text-left text-primary text-sm hover:bg-accent"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-3.5" />
                {customersLabels.customerPickerCreateNew} "{trimmedQuery}"
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {value !== null && !disabled ? (
        <>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={customersLabels.customerPickerEdit}
            title={customersLabels.customerPickerEdit}
            disabled={!selectedCustomer}
            onClick={() => {
              setOpen(false);
              setEditOpen(true);
            }}
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={customersLabels.customerPickerNone}
            title={customersLabels.customerPickerNone}
            onClick={() => onChange(null, null)}
          >
            <X className="size-4" />
          </button>
        </>
      ) : null}

      {allowCreate ? (
        <CreateCustomerDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={trimmedQuery}
          onCreated={selectCustomer}
        />
      ) : null}

      <EditCustomerDialog open={editOpen} onOpenChange={setEditOpen} customer={selectedCustomer} />
    </div>
  );
}

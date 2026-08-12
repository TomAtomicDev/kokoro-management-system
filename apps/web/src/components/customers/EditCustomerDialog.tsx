// Standalone "edit customer" dialog (KOK-119) — reuses CustomerForm so create and edit keep
// the same fields and validation shape.

import type { CustomerDto } from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useUpdateCustomerMutation } from "@/features/customers/api";
import { ApiError } from "@/lib/api";
import { customersLabels } from "@/lib/i18n-customers";

import { CustomerForm, type CustomerFormValues, parseCustomerFormValues } from "./CustomerForm";

export interface EditCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerDto | null;
}

export function EditCustomerDialog({ open, onOpenChange, customer }: EditCustomerDialogProps) {
  const [values, setValues] = useState<CustomerFormValues>(() => ({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    notes: customer?.notes ?? "",
  }));
  const [error, setError] = useState<string | null>(null);
  const updateMutation = useUpdateCustomerMutation();

  useEffect(() => {
    if (!open || !customer) return;
    setValues({
      name: customer.name,
      phone: customer.phone ?? "",
      notes: customer.notes ?? "",
    });
    setError(null);
  }, [open, customer]);

  async function handleSave() {
    if (!customer) return;

    const parsed = parseCustomerFormValues(values);
    if (!parsed) {
      setError(customersLabels.errors.nameRequired);
      return;
    }

    try {
      await updateMutation.mutateAsync({ id: customer.id, ...parsed });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : customersLabels.errors.generic);
    }
  }

  if (!customer) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={customersLabels.editTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{customersLabels.editTitle}</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <CustomerForm values={values} onChange={setValues} disabled={updateMutation.isPending} />
        {error ? <p className="mt-2 text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={updateMutation.isPending}
        >
          {customersLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSave} disabled={updateMutation.isPending}>
          {customersLabels.save}
        </Button>
      </div>
    </Dialog>
  );
}

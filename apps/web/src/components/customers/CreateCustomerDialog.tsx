// Standalone "create customer" dialog (KOK-032) — mirrors catalog/CreateItemDialog.tsx, used by
// CustomerPicker's inline-create flow.

import type { CustomerDto } from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCreateCustomerMutation } from "@/features/customers/api";
import { ApiError } from "@/lib/api";
import { customersLabels } from "@/lib/i18n-customers";

import {
  CustomerForm,
  type CustomerFormValues,
  emptyCustomerFormValues,
  parseCustomerFormValues,
} from "./CustomerForm";

export interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  onCreated?: (customer: CustomerDto) => void;
}

export function CreateCustomerDialog({
  open,
  onOpenChange,
  initialName = "",
  onCreated,
}: CreateCustomerDialogProps) {
  const [values, setValues] = useState<CustomerFormValues>(() => emptyCustomerFormValues());
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateCustomerMutation();

  // Re-seeds only on the open transition (not on every initialName keystroke while it's open) —
  // same precedent as CreateItemDialog.tsx.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional, see comment above.
  useEffect(() => {
    if (open) {
      setValues({ ...emptyCustomerFormValues(), name: initialName });
      setError(null);
    }
  }, [open]);

  async function handleCreate() {
    const parsed = parseCustomerFormValues(values);
    if (!parsed) {
      setError(customersLabels.errors.nameRequired);
      return;
    }
    try {
      const created = await createMutation.mutateAsync(parsed);
      onCreated?.(created);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : customersLabels.errors.generic);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={customersLabels.createTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{customersLabels.createTitle}</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <CustomerForm values={values} onChange={setValues} disabled={createMutation.isPending} />
        {error ? <p className="mt-2 text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={createMutation.isPending}
        >
          {customersLabels.cancel}
        </Button>
        <Button type="button" onClick={handleCreate} disabled={createMutation.isPending}>
          {customersLabels.create}
        </Button>
      </div>
    </Dialog>
  );
}

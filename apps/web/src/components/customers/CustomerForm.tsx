// Shared field set for creating/editing a Customer (KOK-032) — mirrors catalog/ItemForm.tsx's
// shape (plain controlled React state, no react-hook-form, D-10) so CustomerPicker's inline-create
// dialog and any future customer-editing UI never drift apart. Deliberately minimal (Doc 01
// non-goals: "no CRM ambitions") — just name/phone/notes, per Doc 04 §3.3.

import {
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_NOTES_MAX_LENGTH,
  CUSTOMER_PHONE_MAX_LENGTH,
} from "@kokoro/shared";
import { useId } from "react";

import { Input } from "@/components/ui/input";
import { customersLabels } from "@/lib/i18n-customers";

export interface CustomerFormValues {
  name: string;
  phone: string;
  notes: string;
}

export function emptyCustomerFormValues(
  defaults?: Partial<CustomerFormValues>,
): CustomerFormValues {
  return {
    name: defaults?.name ?? "",
    phone: "",
    notes: "",
  };
}

export interface CustomerFormParsed {
  name: string;
  phone: string | null;
  notes: string | null;
}

/** Returns null when the required name field is blank. */
export function parseCustomerFormValues(values: CustomerFormValues): CustomerFormParsed | null {
  const name = values.name.trim();
  if (name === "") return null;

  return {
    name,
    phone: values.phone.trim() === "" ? null : values.phone.trim(),
    notes: values.notes.trim() === "" ? null : values.notes.trim(),
  };
}

export interface CustomerFormProps {
  values: CustomerFormValues;
  onChange: (values: CustomerFormValues) => void;
  disabled?: boolean;
}

export function CustomerForm({ values, onChange, disabled }: CustomerFormProps) {
  const formId = useId();
  function set<K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 text-sm">
        <label className="font-medium text-foreground" htmlFor={`${formId}-name`}>
          {customersLabels.fieldName}
        </label>
        <Input
          id={`${formId}-name`}
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          disabled={disabled}
          autoFocus
          required
          maxLength={CUSTOMER_NAME_MAX_LENGTH}
        />
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <label className="font-medium text-foreground" htmlFor={`${formId}-phone`}>
          {customersLabels.fieldPhone}
        </label>
        <Input
          id={`${formId}-phone`}
          value={values.phone}
          onChange={(e) => set("phone", e.target.value)}
          disabled={disabled}
          maxLength={CUSTOMER_PHONE_MAX_LENGTH}
        />
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <label className="font-medium text-foreground" htmlFor={`${formId}-notes`}>
          {customersLabels.fieldNotes}
        </label>
        <textarea
          id={`${formId}-notes`}
          className="min-h-20 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          disabled={disabled}
          maxLength={CUSTOMER_NOTES_MAX_LENGTH}
        />
      </div>
    </div>
  );
}

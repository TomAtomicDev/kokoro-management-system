import type { FinancialAccountDto, PaymentMethod } from "@kokoro/shared";
import { paymentMethodForAccountType } from "@kokoro/shared";
import { type ChangeEvent, forwardRef } from "react";

import { Select } from "@/components/ui/select";

export interface PaymentAccountSelection {
  accountId: string;
  paymentMethod: PaymentMethod;
}

export interface PaymentAccountSelectProps {
  accounts: FinancialAccountDto[];
  accountId: string;
  label: string;
  paymentMethodLabels: Readonly<Record<PaymentMethod, string>>;
  onChange: (selection: PaymentAccountSelection) => void;
  disabled?: boolean;
  id: string;
  /** Red border/ring — set when this field's live error is visible (KOK-143). */
  invalid?: boolean;
  onBlur?: () => void;
}

/**
 * A single destination selector for money-moving commands. The account type determines the
 * payment method, so callers cannot submit a method/account mismatch from the web UI.
 */
export const PaymentAccountSelect = forwardRef<HTMLSelectElement, PaymentAccountSelectProps>(
  function PaymentAccountSelect(
    {
      accounts,
      accountId,
      label,
      paymentMethodLabels,
      onChange,
      disabled = false,
      id,
      invalid,
      onBlur,
    },
    ref,
  ) {
    function handleChange(event: ChangeEvent<HTMLSelectElement>): void {
      const account = accounts.find((candidate) => candidate.id === event.target.value);
      if (!account) return;
      onChange({
        accountId: account.id,
        paymentMethod: paymentMethodForAccountType(account.type),
      });
    }

    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <label className="font-medium text-foreground" htmlFor={id}>
          {label}
        </label>
        <Select
          ref={ref}
          id={id}
          value={accountId}
          onChange={handleChange}
          onBlur={onBlur}
          invalid={invalid}
          disabled={disabled}
        >
          {accounts.map((account) => {
            const paymentMethod = paymentMethodForAccountType(account.type);
            return (
              <option key={account.id} value={account.id}>
                {paymentMethodLabels[paymentMethod]} ({account.name})
              </option>
            );
          })}
        </Select>
      </div>
    );
  },
);

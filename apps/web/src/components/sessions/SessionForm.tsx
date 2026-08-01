// Dialog for UC-14 "recordSession" / "updateSession" (Doc 07 SC-09). Mirrors PurchaseForm.tsx's
// structure (Dialog wrapper, local form state, reset-on-open) but drops the replay-confirmation
// dance entirely: sessions never trigger a costing replay (packages/shared/src/sessions.ts's
// header), so create/edit are plain mutations, no `useReplayConfirmableMutation`.
//
// Unlike every other event form in this app, a session's "when" is a genuine user choice, not an
// implicit `nowIso()`: the owner offers BOTH a start/end datetime pair and a direct
// duration-minutes field (Doc 07 SC-09's form spec), and fills whichever is convenient — there's no
// cross-field requirement on CREATE (a session may be opened with all three blank and filled in
// later). Closing (`status: "CLOSED"`) is the one state that requires a resolvable duration, and
// that's enforced server-side against whatever this form last saved — see
// SessionDetailDrawer.tsx's dedicated close mini-form for that flow, which this component doesn't
// own.
//
// Validated with the exact same `recordSessionCommandSchema`/`updateSessionCommandSchema` the API
// route parses with (D-4) — including each cost line's account-required-unless-estimate rule,
// which this form does NOT pre-check client-side: it lets Zod's `.superRefine` surface that error,
// exactly as the task brief asks.

import type {
  FinancialAccountDto,
  SessionCostLineCommand,
  SessionDto,
  SessionType,
} from "@kokoro/shared";
import {
  nowIso,
  recordSessionCommandSchema,
  SESSION_TYPES,
  toBusinessDate,
  updateSessionCommandSchema,
} from "@kokoro/shared";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useRecordSession, useUpdateSession } from "@/features/sessions/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { sessionsLabels } from "@/lib/i18n-sessions";

export interface SessionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
  /** Present -> edit mode: prefill from this session and submit via `useUpdateSession` (a full
   * replace, `status` carried through unchanged). Absent -> create mode, submits via
   * `useRecordSession`, always OPEN. */
  session?: SessionDto;
}

interface SessionCostLineValue {
  label: string;
  /** Centavos decimal string (scale 2) — same convention as PurchaseForm's line `amount`. */
  amount: string;
  isEstimate: boolean;
  accountId: string | null;
}

function emptyCostLine(): SessionCostLineValue {
  return { label: "", amount: "", isEstimate: false, accountId: null };
}

interface SessionFormState {
  type: SessionType;
  businessDate: string;
  notes: string;
  startedAt: string;
  endedAt: string;
  durationMin: string;
  costLines: SessionCostLineValue[];
}

/** `<input type="datetime-local">` has no timezone of its own — the browser treats the value as
 * wall-clock local time. Converting through `Date` (which DOES know the local timezone) and back
 * out via `toISOString()` is the whole trick: no manual offset arithmetic, and the result always
 * ends in "Z", which `instantSchema`'s `.datetime({ offset: true })` accepts. */
export function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function datetimeLocalToIso(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/** `undefined` = field left blank (not provided); `null` = non-blank but not a valid positive
 * integer (caller surfaces an error); otherwise the parsed minute count. */
export function parseDurationMinutes(input: string): number | null | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Maps a fetched `SessionDto` (edit mode) to the form's editable local state. Pure and
 * framework-free on purpose — same rationale as `purchaseToFormState`: this workspace has neither
 * jsdom nor @testing-library/react, so a plain exported function is what stays unit-testable
 * without rendering the component. */
export function sessionToFormState(session: SessionDto): SessionFormState {
  return {
    type: session.type,
    businessDate: session.businessDate,
    notes: session.notes ?? "",
    startedAt: isoToDatetimeLocal(session.startedAt),
    endedAt: isoToDatetimeLocal(session.endedAt),
    durationMin: session.durationMin !== null ? String(session.durationMin) : "",
    costLines:
      session.costLines.length > 0
        ? session.costLines.map((line) => ({
            label: line.label,
            amount: formatIntAsDecimalInput(line.amount, 2),
            isEstimate: line.isEstimate,
            accountId: line.accountId,
          }))
        : [emptyCostLine()],
  };
}

export function SessionForm({ open, onOpenChange, accounts, session }: SessionFormProps) {
  const isEditMode = Boolean(session);

  const [type, setType] = useState<SessionType>("PRODUCTION");
  const [businessDate, setBusinessDate] = useState("");
  const [notes, setNotes] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [costLines, setCostLines] = useState<SessionCostLineValue[]>([emptyCostLine()]);
  const [error, setError] = useState<string | null>(null);

  const { show: showToast } = useToast();
  const createMutation = useRecordSession();
  // Called unconditionally (rules of hooks) even in create mode — `session?.id` is only "" then,
  // and the mutation is never actually invoked unless `isEditMode` is true (see handleSubmit).
  const updateMutation = useUpdateSession(session?.id ?? "");

  // Reset only on the open transition (or a switch to a different session while open) — mirrors
  // PurchaseForm's `purchase?.id` precedent so a background refetch of the SAME session never
  // clobbers in-progress edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    if (open) {
      if (session) {
        const initial = sessionToFormState(session);
        setType(initial.type);
        setBusinessDate(initial.businessDate);
        setNotes(initial.notes);
        setStartedAt(initial.startedAt);
        setEndedAt(initial.endedAt);
        setDurationMin(initial.durationMin);
        setCostLines(initial.costLines);
      } else {
        setType("PRODUCTION");
        setBusinessDate(toBusinessDate(nowIso()));
        setNotes("");
        setStartedAt("");
        setEndedAt("");
        setDurationMin("");
        setCostLines([emptyCostLine()]);
      }
      setError(null);
    }
  }, [open, session?.id]);

  const disabled = isEditMode ? updateMutation.isPending : createMutation.isPending;

  function updateCostLine(index: number, patch: Partial<SessionCostLineValue>) {
    setCostLines((lines) => lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeCostLine(index: number) {
    setCostLines((lines) => lines.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    setError(null);
    if (!businessDate) {
      setError(sessionsLabels.errors.dateRequired);
      return;
    }

    const durationMinValue = parseDurationMinutes(durationMin);
    if (durationMinValue === null) {
      setError(sessionsLabels.errors.generic);
      return;
    }

    const parsedCostLines: SessionCostLineCommand[] = [];
    for (const line of costLines) {
      const label = line.label.trim();
      const amountBlank = line.amount.trim() === "";
      if (label === "" && amountBlank) continue; // untouched blank row — silently dropped
      const amount = parseDecimalToInt(line.amount, 2);
      if (label === "" || amount === null) {
        setError(sessionsLabels.errors.invalidCostLine);
        return;
      }
      parsedCostLines.push({
        label,
        amount,
        isEstimate: line.isEstimate,
        accountId: line.isEstimate ? undefined : (line.accountId ?? undefined),
      });
    }

    const basePayload = {
      type,
      businessDate,
      startedAt: datetimeLocalToIso(startedAt),
      endedAt: datetimeLocalToIso(endedAt),
      durationMin: durationMinValue,
      notes: notes.trim() === "" ? undefined : notes.trim(),
      costLines: parsedCostLines,
    };

    if (isEditMode && session) {
      const parsed = updateSessionCommandSchema.safeParse({
        ...basePayload,
        status: session.status,
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? sessionsLabels.errors.generic);
        return;
      }
      try {
        await updateMutation.mutateAsync(parsed.data);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : sessionsLabels.errors.generic);
      }
      return;
    }

    const parsed = recordSessionCommandSchema.safeParse(basePayload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? sessionsLabels.errors.generic);
      return;
    }
    try {
      const result = await createMutation.mutateAsync(parsed.data);
      // Doc 04 §5: "one OPEN session per type" is a soft, overridable rule — the create already
      // succeeded, so this is a dismissible toast, never a blocking dialog.
      if (result.openSessionWarning) {
        showToast({ message: result.openSessionWarning });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : sessionsLabels.errors.generic);
    }
  }

  const dialogTitle = isEditMode ? sessionsLabels.editTitle : sessionsLabels.recordTitle;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} aria-label={dialogTitle}>
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-foreground text-md">{dialogTitle}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="sf-type">
              {sessionsLabels.fieldType}
            </label>
            <Select
              id="sf-type"
              value={type}
              onChange={(e) => setType(e.target.value as SessionType)}
              disabled={disabled}
            >
              {SESSION_TYPES.map((sessionType) => (
                <option key={sessionType} value={sessionType}>
                  {sessionsLabels.typeLabels[sessionType]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="sf-date">
              {sessionsLabels.fieldDate}
            </label>
            <Input
              id="sf-date"
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              disabled={disabled}
              autoFocus
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="sf-start">
              {sessionsLabels.fieldStart}
            </label>
            <Input
              id="sf-start"
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground" htmlFor="sf-end">
              {sessionsLabels.fieldEnd}
            </label>
            <Input
              id="sf-end"
              type="datetime-local"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="sf-duration">
            {sessionsLabels.fieldDuration}
          </label>
          <Input
            id="sf-duration"
            inputMode="numeric"
            placeholder="0"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
            disabled={disabled}
          />
          <span className="text-muted-foreground text-xs">{sessionsLabels.durationHint}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-medium text-foreground" htmlFor="sf-notes">
            {sessionsLabels.fieldNotes}
          </label>
          <Input
            id="sf-notes"
            placeholder={sessionsLabels.notesPlaceholder}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-medium text-foreground">{sessionsLabels.costLinesTitle}</span>
          <div className="flex flex-col gap-2">
            {costLines.map((line, index) => (
              <div
                // Rows are ephemeral form state, index-addressed, only ever appended/removed —
                // same precedent as LineEditor.tsx's identical key choice.
                // biome-ignore lint/suspicious/noArrayIndexKey: see comment above.
                key={index}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <div className="flex-1">
                    <Input
                      aria-label={sessionsLabels.costLineLabel}
                      placeholder={sessionsLabels.costLineLabelPlaceholder}
                      value={line.label}
                      onChange={(e) => updateCostLine(index, { label: e.target.value })}
                      disabled={disabled}
                    />
                  </div>
                  <div className="w-full sm:w-32">
                    <Input
                      inputMode="decimal"
                      aria-label={sessionsLabels.costLineAmount}
                      placeholder="0.00"
                      value={line.amount}
                      onChange={(e) => updateCostLine(index, { amount: e.target.value })}
                      disabled={disabled}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeCostLine(index)}
                    disabled={disabled}
                  >
                    {sessionsLabels.removeLine}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Switch
                      checked={line.isEstimate}
                      onCheckedChange={(checked) =>
                        updateCostLine(index, {
                          isEstimate: checked,
                          accountId: checked ? null : line.accountId,
                        })
                      }
                      disabled={disabled}
                      aria-label={sessionsLabels.costLineEstimate}
                    />
                    <span>{sessionsLabels.costLineEstimate}</span>
                  </div>
                  {!line.isEstimate ? (
                    <div className="flex-1">
                      <Select
                        aria-label={sessionsLabels.costLineAccount}
                        value={line.accountId ?? ""}
                        onChange={(e) => updateCostLine(index, { accountId: e.target.value })}
                        disabled={disabled}
                      >
                        <option value="" disabled>
                          {sessionsLabels.costLineAccount}
                        </option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCostLines((lines) => [...lines, emptyCostLine()])}
            disabled={disabled}
          >
            {sessionsLabels.addLine}
          </Button>
        </div>

        {error ? <p className="text-negative text-sm">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-border border-t px-5 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={disabled}
        >
          {sessionsLabels.cancel}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={disabled}>
          {isEditMode ? sessionsLabels.save : sessionsLabels.submit}
        </Button>
      </div>
    </Dialog>
  );
}

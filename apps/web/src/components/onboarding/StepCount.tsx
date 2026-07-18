// Onboarding step 5 (KOK-020, Doc 07 step 5) — sets opening stock via the KOK-019 inventory-count
// flow. Reuses the EXISTING count hooks from features/inventory/api.ts directly (no duplicated
// domain logic). On mount, auto-starts a DRAFT count with no kind/category filter (scopes to
// every active item, including whatever step 3 just created — `expectedQty` freezes at 0 for
// items with no stock movements yet, per core/inventory/counts.ts's `onHandByItem.get(itemId) ?? 0`
// fallback). Renders an INLINE checklist rather than the `DetailDrawer`-based `CountDetailView`
// (that's a slide-over triggered from the Inventory screen — awkward embedded inside a linear
// wizard page), but follows the exact same data pattern: local `lineInputs` state seeded from the
// count's lines, `parseDecimalToInt`/`formatIntAsDecimalInput` scale 3, blur-triggered
// `useUpdateCountLine` calls, live-computed delta display.
//
// "Confirmar y finalizar" flushes any unsaved line edits (same reasoning as
// CountDetailView.handleOpenConfirm: the owner may click confirm without blurring the last field
// they typed into), commits the count, marks onboarding complete, then navigates to "/". "Omitir"
// completes onboarding without committing the count (Doc 07: step 5 can't be meaningfully skipped
// without also completing onboarding some other way, since that's the only signal gating the "/"
// redirect) — the DRAFT count is simply left uncommitted, which has no effect on stock.

import type { InventoryCountLineDto, Unit } from "@kokoro/shared";
import { formatQty, nowIso, toBusinessDate } from "@kokoro/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useCommitCount,
  useCount,
  useStartCount,
  useUpdateCountLine,
} from "@/features/inventory/api";
import { useCompleteOnboarding } from "@/features/onboarding/api";
import { ApiError } from "@/lib/api";
import { formatIntAsDecimalInput, parseDecimalToInt } from "@/lib/decimal";
import { onboardingLabels } from "@/lib/i18n-onboarding";
import { cn } from "@/lib/utils";

export interface StepCountProps {
  /** itemId -> { name, unit }, built by the caller from useItemsQuery — same lookup
   * routes/inventory.tsx builds for CountDetailView. */
  items: Map<string, { name: string; unit: Unit }>;
}

export function StepCount({ items }: StepCountProps) {
  const navigate = useNavigate();

  const [countId, setCountId] = useState<string | null>(null);
  const [lineInputs, setLineInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const startMutation = useStartCount();
  const countQuery = useCount(countId);
  const count = countQuery.data;
  const updateLineMutation = useUpdateCountLine();
  const commitMutation = useCommitCount();
  const completeMutation = useCompleteOnboarding();

  // Run exactly once on mount to auto-start the count — intentionally excluded from deps
  // (mutateAsync is stable, and the ref guard below prevents a double-start regardless).
  //
  // Deliberately `mutateAsync` in an async IIFE, NOT `mutate(vars, { onSuccess, onError })`:
  // verified live (KOK-020 smoke test) that under React 19 StrictMode's synthetic double-effect
  // mount, the per-call `mutate()` callbacks are silently dropped — the MutationObserver
  // unsubscribes/resubscribes between the call and the response, and the in-flight callbacks
  // never fire even though the request itself succeeds server-side. `mutateAsync`'s returned
  // Promise is tied to the request itself, not the observer's currently-attached callbacks, so it
  // is immune to that race.
  const startedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: run-once-on-mount, see comment above.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const result = await startMutation.mutateAsync({
          occurredAt: nowIso(),
          businessDate: toBusinessDate(nowIso()),
        });
        setCountId(result.count.id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : onboardingLabels.errors.generic);
      }
    })();
  }, []);

  // Seed local edit state from the server once per count — same guard CountDetailView.tsx uses so
  // a background refetch following our own line edits never stomps an in-progress keystroke.
  const seededCountId = useRef<string | null>(null);
  useEffect(() => {
    if (count && seededCountId.current !== count.id) {
      setLineInputs(
        Object.fromEntries(
          count.lines.map((line) => [line.itemId, formatIntAsDecimalInput(line.countedQty, 3)]),
        ),
      );
      seededCountId.current = count.id;
    }
  }, [count]);

  function effectiveCountedQty(line: InventoryCountLineDto): number {
    const raw = lineInputs[line.itemId];
    if (raw === undefined) return line.countedQty;
    const parsed = parseDecimalToInt(raw, 3);
    return parsed ?? line.countedQty;
  }

  function handleBlur(line: InventoryCountLineDto) {
    if (!count) return;
    const raw = lineInputs[line.itemId];
    if (raw === undefined) return;
    const parsed = parseDecimalToInt(raw, 3);
    if (parsed === null) {
      setLineInputs((prev) => ({
        ...prev,
        [line.itemId]: formatIntAsDecimalInput(line.countedQty, 3),
      }));
      return;
    }
    if (parsed === line.countedQty) return;
    updateLineMutation.mutate(
      { countId: count.id, itemId: line.itemId, countedQty: parsed },
      {
        onError: (err) => {
          setError(err instanceof ApiError ? err.message : onboardingLabels.errors.generic);
          setLineInputs((prev) => ({
            ...prev,
            [line.itemId]: formatIntAsDecimalInput(line.countedQty, 3),
          }));
        },
      },
    );
  }

  async function handleConfirm() {
    if (!count) return;
    setError(null);
    setFinishing(true);
    try {
      const dirty = count.lines.filter((line) => {
        const raw = lineInputs[line.itemId];
        if (raw === undefined) return false;
        const parsed = parseDecimalToInt(raw, 3);
        return parsed !== null && parsed !== line.countedQty;
      });
      await Promise.all(
        dirty.map((line) => {
          const parsed = parseDecimalToInt(lineInputs[line.itemId] as string, 3) as number;
          return updateLineMutation.mutateAsync({
            countId: count.id,
            itemId: line.itemId,
            countedQty: parsed,
          });
        }),
      );
      await commitMutation.mutateAsync(count.id);
      await completeMutation.mutateAsync();
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : onboardingLabels.errors.generic);
      setFinishing(false);
    }
  }

  async function handleSkip() {
    setError(null);
    setFinishing(true);
    try {
      await completeMutation.mutateAsync();
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : onboardingLabels.errors.generic);
      setFinishing(false);
    }
  }

  const disabled = finishing || commitMutation.isPending || completeMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-medium text-foreground text-lg">{onboardingLabels.countTitle}</h2>
        <p className="text-muted-foreground text-sm">{onboardingLabels.countBody}</p>
      </div>

      {countQuery.isLoading || !count ? (
        <p className="text-muted-foreground text-sm">{onboardingLabels.loading}</p>
      ) : count.lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">{onboardingLabels.noCountLines}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>{onboardingLabels.countColumnItem}</span>
            <span className="text-right">{onboardingLabels.countColumnExpected}</span>
            <span className="text-right">{onboardingLabels.countColumnCounted}</span>
            <span className="text-right">{onboardingLabels.countColumnDelta}</span>
          </div>
          {count.lines.map((line) => {
            const info = items.get(line.itemId);
            const unit = info?.unit ?? "UNIT";
            const delta = effectiveCountedQty(line) - line.expectedQty;
            return (
              <div
                key={line.id}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0"
              >
                <span className="text-foreground">{info?.name ?? "—"}</span>
                <span className="numeric-cell text-right text-muted-foreground">
                  {formatQty(line.expectedQty, unit)}
                </span>
                <Input
                  className="w-24"
                  inputMode="decimal"
                  value={lineInputs[line.itemId] ?? ""}
                  onChange={(e) =>
                    setLineInputs((prev) => ({ ...prev, [line.itemId]: e.target.value }))
                  }
                  onBlur={() => handleBlur(line)}
                  disabled={disabled}
                />
                <span className={cn("numeric-cell text-right", delta < 0 && "text-negative")}>
                  {formatQty(delta, unit)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {error ? <p className="text-negative text-sm">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleSkip} disabled={disabled}>
          {onboardingLabels.skipButton}
        </Button>
        <Button type="button" onClick={handleConfirm} disabled={disabled || !count}>
          {onboardingLabels.submitCount}
        </Button>
      </div>
    </div>
  );
}

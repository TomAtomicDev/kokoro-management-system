// Detail drawer for a single session (Doc 06 §4 DetailDrawer contract, SC-09). Mirrors
// PurchaseDetailDrawer.tsx's edit/delete/undo/restore composition, minus the
// `useReplayConfirmableMutation`/ImpactConfirmDialog machinery — sessions never trigger a costing
// replay (packages/shared/src/sessions.ts's header), so every mutation here is a plain call.
//
// Adds two things purchases doesn't need: the linked-events viewer (four small lists — purchases,
// production runs, sales, stock exits — each section heading links to that screen's list; no
// existing drawer in this app links to one SPECIFIC other record, e.g.
// ProductionRunDetailDrawer.tsx renders its recipe as a plain label, not a link, so a bare
// list-screen link per section is the reasonable stopping point rather than inventing new
// per-record deep-linking for four other screens at once), and the "Cerrar sesión" quick action —
// a small inline close form (end time OR duration) that submits the full session unchanged plus
// `status: "CLOSED"`, since UpdateSessionCommand is a full replace, not a patch.

import type { FinancialAccountDto } from "@kokoro/shared";
import { addMoney, formatMoney, toCentavos, updateSessionCommandSchema } from "@kokoro/shared";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { DetailDrawer } from "@/components/data-table/DetailDrawer";
import { ProductionRunForm } from "@/components/production/ProductionRunForm";
import { PurchaseForm } from "@/components/purchases/PurchaseForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  useDeleteSession,
  useRestoreSession,
  useSession,
  useUpdateSession,
} from "@/features/sessions/api";
import { ApiError } from "@/lib/api";
import { sessionsLabels } from "@/lib/i18n-sessions";

import { datetimeLocalToIso, parseDurationMinutes, SessionForm } from "./SessionForm";

export interface SessionDetailDrawerProps {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinancialAccountDto[];
}

export function SessionDetailDrawer({
  sessionId,
  open,
  onOpenChange,
  accounts,
}: SessionDetailDrawerProps) {
  const sessionQuery = useSession(sessionId ?? undefined);
  const { show, showUndo } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [closeFormOpen, setCloseFormOpen] = useState(false);
  const [productionFormOpen, setProductionFormOpen] = useState(false);
  const [purchaseFormOpen, setPurchaseFormOpen] = useState(false);
  const [closeEndedAt, setCloseEndedAt] = useState("");
  const [closeDurationMin, setCloseDurationMin] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);

  // Frozen at the moment delete succeeds, same precedent as PurchaseDetailDrawer's
  // `pendingRestoreId` (see that file's comment for the empty-id 404 bug this avoids).
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

  const deleteMutation = useDeleteSession(sessionId ?? "");
  const restoreMutation = useRestoreSession(pendingRestoreId ?? "");
  const closeMutation = useUpdateSession(sessionId ?? "");

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of accounts) map.set(account.id, account.name);
    return map;
  }, [accounts]);

  if (!sessionId) return null;
  const session = sessionQuery.data?.session;
  const linkedEvents = sessionQuery.data?.linkedEvents;

  async function handleDelete() {
    if (!sessionId) return;
    try {
      await deleteMutation.mutateAsync({});
      setPendingRestoreId(sessionId);
      onOpenChange(false);
      showUndo({
        message: sessionsLabels.deletedUndo,
        actionLabel: sessionsLabels.undo,
        onAction: () => {
          restoreMutation.mutateAsync({}).catch(() => {
            show({ message: sessionsLabels.restoreFailed });
          });
        },
      });
    } catch {
      // Surfacing a delete failure inline would need its own error slot; Doc 06 principle 6 keeps
      // ordinary deletes toast-only, so a failed delete simply leaves the drawer open to retry.
    }
  }

  async function handleClose() {
    if (!session) return;
    setCloseError(null);
    const durationValue = parseDurationMinutes(closeDurationMin);
    if (durationValue === null) {
      setCloseError(sessionsLabels.errors.generic);
      return;
    }
    const endedAtIso = datetimeLocalToIso(closeEndedAt);
    if (durationValue === undefined && endedAtIso === undefined) {
      setCloseError(sessionsLabels.errors.closeRequiresDuration);
      return;
    }
    // Full replace (UpdateSessionCommand is not a patch): re-send the session's own current
    // fields unchanged, plus this mini-form's end time/duration and `status: "CLOSED"`. Validated
    // through the same shared schema the API route parses with (D-4), same as SessionForm.
    const parsed = updateSessionCommandSchema.safeParse({
      type: session.type,
      businessDate: session.businessDate,
      startedAt: session.startedAt ?? undefined,
      endedAt: endedAtIso ?? session.endedAt ?? undefined,
      durationMin: durationValue ?? session.durationMin ?? undefined,
      notes: session.notes ?? undefined,
      costLines: session.costLines.map((line) => ({
        label: line.label,
        amount: line.amount,
        isEstimate: line.isEstimate,
        accountId: line.accountId ?? undefined,
      })),
      status: "CLOSED",
    });
    if (!parsed.success) {
      setCloseError(parsed.error.issues[0]?.message ?? sessionsLabels.errors.generic);
      return;
    }
    try {
      await closeMutation.mutateAsync(parsed.data);
      setCloseFormOpen(false);
      setCloseEndedAt("");
      setCloseDurationMin("");
    } catch (err) {
      setCloseError(err instanceof ApiError ? err.message : sessionsLabels.errors.generic);
    }
  }

  return (
    <>
      <DetailDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={session ? sessionsLabels.typeLabels[session.type] : sessionsLabels.detailTitle}
        subtitle={session?.businessDate}
        entityType="sessions"
        entityId={session?.id}
        footer={
          session ? (
            <span>
              Creado {new Date(session.createdAt).toLocaleDateString("es-BO")} · Actualizado{" "}
              {new Date(session.updatedAt).toLocaleDateString("es-BO")}
            </span>
          ) : undefined
        }
      >
        {!session ? (
          <p className="text-muted-foreground text-sm">{sessionsLabels.loading}</p>
        ) : (
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <Badge variant={session.status === "OPEN" ? "default" : "muted"}>
                {sessionsLabels.statusLabels[session.status]}
              </Badge>
              <div className="flex items-center gap-2">
                {session.type === "PRODUCTION" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setProductionFormOpen(true)}
                  >
                    {sessionsLabels.linkedEvents.registerProductionRun}
                  </Button>
                ) : null}
                {session.type === "PURCHASE_TRIP" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPurchaseFormOpen(true)}
                  >
                    {sessionsLabels.linkedEvents.registerPurchase}
                  </Button>
                ) : null}
                {session.status === "OPEN" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCloseFormOpen((v) => !v)}
                  >
                    {sessionsLabels.closeAction}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  {sessionsLabels.edit}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {sessionsLabels.delete}
                </Button>
              </div>
            </div>

            {closeFormOpen ? (
              <div className="flex flex-col gap-3 rounded-md border border-border bg-muted px-3 py-2.5">
                <span className="font-medium text-foreground">{sessionsLabels.closeTitle}</span>
                <p className="text-muted-foreground text-xs">{sessionsLabels.closeDescription}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-muted-foreground text-xs" htmlFor="sdd-close-end">
                      {sessionsLabels.fieldEnd}
                    </label>
                    <Input
                      id="sdd-close-end"
                      type="datetime-local"
                      value={closeEndedAt}
                      onChange={(e) => setCloseEndedAt(e.target.value)}
                      disabled={closeMutation.isPending}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-muted-foreground text-xs" htmlFor="sdd-close-duration">
                      {sessionsLabels.fieldDuration}
                    </label>
                    <Input
                      id="sdd-close-duration"
                      inputMode="numeric"
                      placeholder="0"
                      value={closeDurationMin}
                      onChange={(e) => setCloseDurationMin(e.target.value)}
                      disabled={closeMutation.isPending}
                    />
                  </div>
                </div>
                {closeError ? <p className="text-negative text-xs">{closeError}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCloseFormOpen(false)}
                    disabled={closeMutation.isPending}
                  >
                    {sessionsLabels.closeCancel}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleClose}
                    disabled={closeMutation.isPending}
                  >
                    {sessionsLabels.closeConfirm}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{sessionsLabels.fieldNotes}</span>
              <p className="text-muted-foreground">{session.notes ?? sessionsLabels.noNotes}</p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{sessionsLabels.detailCosts}</span>
                <span className="numeric-cell font-medium text-foreground">
                  {formatMoney(
                    addMoney(...session.costLines.map((line) => toCentavos(line.amount))),
                  )}
                </span>
              </div>
              {session.costLines.length === 0 ? (
                <p className="text-muted-foreground text-xs">{sessionsLabels.noCostLines}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {session.costLines.map((line) => (
                    <li
                      key={line.id}
                      className="flex flex-col gap-1 rounded-md border border-border px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          {line.label}
                          {line.isEstimate ? (
                            <Badge variant="muted">{sessionsLabels.estimateBadge}</Badge>
                          ) : null}
                        </span>
                        <span className="numeric-cell font-medium">
                          {formatMoney(toCentavos(line.amount))}
                        </span>
                      </div>
                      {line.accountId ? (
                        <span className="text-muted-foreground text-xs">
                          {accountNameById.get(line.accountId) ?? line.accountId}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <span className="font-medium text-foreground">
                {sessionsLabels.linkedEventsTitle}
              </span>
              {linkedEvents ? (
                linkedEvents.purchases.length +
                  linkedEvents.productionRuns.length +
                  linkedEvents.sales.length +
                  linkedEvents.stockExits.length ===
                0 ? (
                  <p className="text-muted-foreground text-xs">{sessionsLabels.noLinkedEvents}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <LinkedEventsGroup
                      title={sessionsLabels.linkedPurchases}
                      to="/purchases"
                      items={linkedEvents.purchases}
                    />
                    <LinkedEventsGroup
                      title={sessionsLabels.linkedProductionRuns}
                      to="/production"
                      items={linkedEvents.productionRuns}
                    />
                    <LinkedEventsGroup
                      title={sessionsLabels.linkedSales}
                      to="/sales"
                      items={linkedEvents.sales}
                    />
                    <LinkedEventsGroup
                      title={sessionsLabels.linkedStockExits}
                      to="/inventory"
                      items={linkedEvents.stockExits}
                    />
                  </div>
                )
              ) : (
                <p className="text-muted-foreground text-xs">{sessionsLabels.loading}</p>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>

      {session ? (
        <>
          <SessionForm
            open={editOpen}
            onOpenChange={setEditOpen}
            accounts={accounts}
            session={session}
          />
          <ProductionRunForm
            open={productionFormOpen}
            onOpenChange={setProductionFormOpen}
            preselectedSessionId={session.id}
          />
          <PurchaseForm
            open={purchaseFormOpen}
            onOpenChange={setPurchaseFormOpen}
            accounts={accounts}
            preselectedSessionId={session.id}
          />
        </>
      ) : null}
    </>
  );
}

function LinkedEventsGroup({
  title,
  to,
  items,
}: {
  title: string;
  to: "/purchases" | "/production" | "/sales" | "/inventory";
  items: { id: string; occurredAt: string; businessDate: string; label: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Link to={to} className="font-medium text-primary text-xs underline-offset-2 hover:underline">
        {title} ({items.length})
      </Link>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs"
          >
            <span className="text-foreground">{item.label}</span>
            <span className="text-muted-foreground">{item.businessDate}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

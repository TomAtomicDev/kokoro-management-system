// SC-09 · Sessions — /sessions (UC-14). Header: "Nueva sesión" action; table of all sessions;
// detail drawer on row click. Mirrors routes/purchases.tsx's composition, plus one addition: an
// `?open=<id>` search param (router.tsx's `sessionsRoute.validateSearch`) that opens a specific
// session's drawer directly — the topbar SessionChip navigates here with that param set.

import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { SessionDetailDrawer } from "@/components/sessions/SessionDetailDrawer";
import { SessionForm } from "@/components/sessions/SessionForm";
import { SessionsTable } from "@/components/sessions/SessionsTable";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/features/finance/api";
import { useSessions } from "@/features/sessions/api";
import { sessionsLabels } from "@/lib/i18n-sessions";

// Nested under the pathless `_authenticated` layout route (router.tsx) — the route's registered
// id is "/_authenticated/sessions", not the URL path "/sessions" (that's what loginRoute's
// identical `getRouteApi("/login")` gets away with: it's a top-level sibling, not nested).
const routeApi = getRouteApi("/_authenticated/sessions");

export function SessionsRoute() {
  const { open } = routeApi.useSearch();
  const accountsQuery = useAccounts();
  const sessionsQuery = useSessions();

  const [formOpen, setFormOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // One-time pickup of the `?open=<id>` deep link (SessionChip's own navigation target) — only on
  // the value actually changing, so closing the drawer afterward doesn't immediately reopen it on
  // a re-render.
  useEffect(() => {
    if (open) setSelectedSessionId(open);
  }, [open]);

  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl text-foreground">{sessionsLabels.title}</h1>
          <p className="text-muted-foreground text-sm">{sessionsLabels.subtitle}</p>
        </div>
        <Button type="button" onClick={() => setFormOpen(true)}>
          {sessionsLabels.actionRecord}
        </Button>
      </div>

      <SessionsTable
        sessions={sessionsQuery.data?.sessions ?? []}
        loading={sessionsQuery.isLoading}
        onRowClick={(session) => setSelectedSessionId(session.id)}
      />

      <SessionForm open={formOpen} onOpenChange={setFormOpen} accounts={accounts} />
      <SessionDetailDrawer
        sessionId={selectedSessionId}
        open={selectedSessionId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedSessionId(null);
        }}
        accounts={accounts}
      />
    </div>
  );
}

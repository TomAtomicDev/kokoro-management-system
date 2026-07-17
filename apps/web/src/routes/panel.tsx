import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { RouteStub } from "@/components/common/RouteStub";
import { useOnboardingStatus } from "@/features/onboarding/api";
import { navLabels } from "@/lib/i18n-nav";

// Placeholder — real screen built in a later SC-xx task (see Doc 07 screen catalog). The one piece
// of real logic here (KOK-020): redirect to the first-run wizard while onboarding is incomplete.
// Guarded by `!isLoading` so this never fires on the query's initial undefined-data render, and by
// `data.completed === false` so it only fires once the status is known — never on a fetch error.
export function PanelRoute() {
  const navigate = useNavigate();
  const statusQuery = useOnboardingStatus();

  useEffect(() => {
    if (!statusQuery.isLoading && statusQuery.data?.completed === false) {
      navigate({ to: "/onboarding" });
    }
  }, [statusQuery.isLoading, statusQuery.data, navigate]);

  return <RouteStub title={navLabels.panel} />;
}

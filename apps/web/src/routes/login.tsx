// SC-18 · Login — /login. "Password → session. Rate-limited. Nothing else." (Doc 07). Renders
// standalone, outside AppShell: router.tsx nests every other route under the pathless
// `_authenticated` layout route, but this one deliberately sits beside it, not under it.

import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLogin } from "@/features/auth/api";
import { ApiError } from "@/lib/api";
import { authLabels } from "@/lib/i18n-auth";

const routeApi = getRouteApi("/login");

// Only honor same-origin, absolute-path redirect targets (`/finance`, not `https://evil.com` or
// `//evil.com`) — `redirect` comes from a query string an attacker can craft, so this guards
// against an open-redirect via a link to `/login?redirect=...`.
function safeRedirectTarget(target: string | undefined): string {
  if (!target?.startsWith("/") || target.startsWith("//")) return "/";
  return target;
}

export function LoginRoute() {
  const { redirect } = routeApi.useSearch();
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await loginMutation.mutateAsync({ password });
      // Never keep the password in memory longer than the request needs it.
      setPassword("");
      await navigate({ to: safeRedirectTarget(redirect) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : authLabels.genericError);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div>
          <h1 className="font-semibold text-foreground text-xl">{authLabels.loginTitle}</h1>
          <p className="text-muted-foreground text-sm">{authLabels.loginSubtitle}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="font-medium text-foreground text-sm">
            {authLabels.passwordLabel}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error ? <p className="text-negative text-sm">{error}</p> : null}

        <Button type="submit" disabled={loginMutation.isPending || password.length === 0}>
          {loginMutation.isPending ? authLabels.submittingButton : authLabels.submitButton}
        </Button>
      </form>
    </div>
  );
}

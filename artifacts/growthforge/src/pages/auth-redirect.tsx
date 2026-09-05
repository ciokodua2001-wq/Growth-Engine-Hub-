import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";

/**
 * Post-sign-in landing route — the `redirectTo`/fallback target for both
 * email/password and Google OAuth sign-in (see sign-in.tsx, sign-up.tsx).
 * We look up the user's role and route them to the right home: /admin for
 * admin/super_admin, /dashboard for everyone else — unless the sign-in flow
 * was initiated with a specific `redirect_url` (e.g. a team invite link),
 * in which case that takes priority.
 */
export default function AuthRedirectPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const redirectUrl = new URLSearchParams(search).get("redirect_url");
  const { isLoaded, user } = useAuth();
  const { data: currentUser, isSuccess, isError } = useCurrentUser();
  const [oauthTimedOut, setOauthTimedOut] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code") && !window.location.hash.includes("access_token")) return;
    const t = window.setTimeout(() => setOauthTimedOut(true), 12000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;

    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    const oauthPending =
      params.has("code") ||
      hash.includes("access_token") ||
      hash.includes("refresh_token");
    const oauthError = params.get("error_description") || params.get("error");

    if (!user) {
      if (oauthError || oauthTimedOut) {
        const next = new URLSearchParams(params);
        if (oauthTimedOut && !next.get("error_description")) {
          next.set("error_description", "Google sign-in timed out. Try email and password, or Continue with Google again.");
        }
        const qs = next.toString();
        setLocation(qs ? `/sign-in?${qs}` : "/sign-in", { replace: true });
        return;
      }
      // PKCE exchange is still in flight — stay on the spinner instead of
      // bouncing to /sign-in and dropping the `code` query param.
      if (oauthPending) return;
      setLocation("/sign-in", { replace: true });
      return;
    }
    if (redirectUrl) {
      setLocation(redirectUrl, { replace: true });
      return;
    }
    if (isSuccess && currentUser) {
      const target =
        currentUser.isOwner || currentUser.role === "admin" || currentUser.role === "super_admin"
          ? "/admin"
          : "/dashboard";
      setLocation(target, { replace: true });
    }
    if (isError) {
      setLocation("/dashboard", { replace: true });
    }
  }, [isLoaded, user, redirectUrl, isSuccess, currentUser, isError, oauthTimedOut, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#040B14" }}>
      <Loader2 className="h-6 w-6 animate-spin text-[#00E676]" />
    </div>
  );
}

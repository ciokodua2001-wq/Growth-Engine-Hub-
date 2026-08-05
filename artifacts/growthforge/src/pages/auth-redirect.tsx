import { useEffect } from "react";
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

  useEffect(() => {
    if (isLoaded && !user) {
      setLocation("/sign-in", { replace: true });
      return;
    }
    if (redirectUrl) {
      setLocation(redirectUrl, { replace: true });
      return;
    }
    if (isSuccess && currentUser) {
      const target = currentUser.role === "admin" || currentUser.role === "super_admin" ? "/admin" : "/dashboard";
      setLocation(target, { replace: true });
    }
    if (isError) {
      // Fall back to the standard dashboard if the role lookup fails.
      setLocation("/dashboard", { replace: true });
    }
  }, [isLoaded, user, redirectUrl, isSuccess, currentUser, isError, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#040B14" }}>
      <Loader2 className="h-6 w-6 animate-spin text-[#00E676]" />
    </div>
  );
}

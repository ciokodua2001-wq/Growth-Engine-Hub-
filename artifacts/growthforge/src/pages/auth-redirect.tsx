import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";

/**
 * Post-sign-in landing route - the `callbackURL` target for both email/password
 * and Google OAuth sign-in. With Better Auth the OAuth callback completes
 * server-side (the session cookie is already set before this page loads), so
 * there is no client-side `code`/`access_token` exchange to handle here.
 *
 * We look up the user's role and route to the right home: /admin for
 * admin/super_admin/owner, /dashboard for everyone else - unless the flow was
 * initiated with a specific `redirect_url` (e.g. a team invite link), which
 * takes priority.
 */
export default function AuthRedirectPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const redirectUrl = new URLSearchParams(search).get("redirect_url");
  const { isLoaded, user } = useAuth();
  const { data: currentUser, isLoading: isUserLoading, isSuccess, isError } = useCurrentUser();

  useEffect(() => {
    if (!isLoaded || isUserLoading) return;

    if (!user) {
      const params = new URLSearchParams(window.location.search);
      const desc = params.get("error_description") || params.get("error");
      setLocation(desc ? `/sign-in?error_description=${encodeURIComponent(desc)}` : "/sign-in", { replace: true });
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
    } else if (isError || !currentUser) {
      setLocation("/dashboard", { replace: true });
    }
  }, [isLoaded, isUserLoading, user, redirectUrl, isSuccess, currentUser, isError, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#040B14" }}>
      <Loader2 className="h-6 w-6 animate-spin text-[#00E676]" />
    </div>
  );
}

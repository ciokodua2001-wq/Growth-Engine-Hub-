import { useEffect } from "react";
import { useSearch } from "wouter";
import { Loader2 } from "lucide-react";
import { basePath } from "@/lib/basePath";

/**
 * Post-sign-in landing route - the `callbackURL` target for both email/password
 * and Google OAuth sign-in.
 *
 * Checks user credentials and role directly via `/api/auth/provision` to ensure
 * instantaneous, reliable routing to /admin (for super_admin / owner) or
 * /dashboard (for standard users).
 */
export default function AuthRedirectPage() {
  const search = useSearch();
  const redirectUrl = new URLSearchParams(search).get("redirect_url");

  useEffect(() => {
    let unmounted = false;

    async function checkAndRedirect() {
      try {
        const res = await fetch("/api/auth/provision", {
          method: "POST",
          credentials: "include",
        });
        if (unmounted) return;

        if (res.ok) {
          const user = await res.json();
          if (redirectUrl) {
            const dest = redirectUrl.startsWith("http") ? redirectUrl : `${basePath}${redirectUrl}`;
            window.location.href = dest;
            return;
          }
          const target =
            user.isOwner || user.role === "admin" || user.role === "super_admin"
              ? "/admin"
              : "/dashboard";
          window.location.href = `${basePath}${target}`;
        } else {
          window.location.href = `${basePath}/sign-in`;
        }
      } catch {
        if (!unmounted) {
          window.location.href = `${basePath}/dashboard`;
        }
      }
    }

    checkAndRedirect();
    return () => {
      unmounted = true;
    };
  }, [redirectUrl]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#040B14" }}>
      <Loader2 className="h-6 w-6 animate-spin text-[#00E676]" />
    </div>
  );
}

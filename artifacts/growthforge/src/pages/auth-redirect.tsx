import { useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { Loader2 } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";

/**
 * Post-sign-in landing route. Clerk redirects here after a successful sign-in
 * (see App.tsx `signInFallbackRedirectUrl`). We look up the user's role and
 * route them to the right home: /admin for admin/super_admin, /dashboard for everyone else.
 */
export default function AuthRedirectPage() {
  const [, setLocation] = useLocation();
  const { isLoaded, user } = useUser();
  const { data: currentUser, isSuccess, isError } = useCurrentUser();

  useEffect(() => {
    if (isLoaded && !user) {
      setLocation("/sign-in", { replace: true });
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
  }, [isLoaded, user, isSuccess, currentUser, isError, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#040B14" }}>
      <Loader2 className="h-6 w-6 animate-spin text-[#00E676]" />
    </div>
  );
}

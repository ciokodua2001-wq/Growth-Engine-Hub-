import { useEffect } from "react";
import { useSearch } from "wouter";
import { Loader2 } from "lucide-react";
import { basePath } from "@/lib/basePath";

export default function AuthRedirectPage() {
  const search = useSearch();
  const redirectUrl = new URLSearchParams(search).get("redirect_url");

  useEffect(() => {
    let unmounted = false;

    async function checkAndRedirect() {
      try {
        const provisionRes = await fetch("/api/auth/provision", {
          method: "POST",
          credentials: "include",
        });
        if (unmounted) return;

        if (!provisionRes.ok) {
          window.location.href = `${basePath}/sign-in`;
          return;
        }

        const user = await provisionRes.json();
        if (redirectUrl) {
          const dest = redirectUrl.startsWith("http") ? redirectUrl : `${basePath}${redirectUrl}`;
          window.location.href = dest;
          return;
        }

        if (user.isOwner || user.role === "admin" || user.role === "super_admin") {
          window.location.href = `${basePath}/admin`;
          return;
        }

        if (!user.onboardingComplete) {
          window.location.href = `${basePath}/onboarding`;
          return;
        }

        window.location.href = `${basePath}/dashboard`;
      } catch {
        if (!unmounted) {
          window.location.href = `${basePath}/sign-in`;
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

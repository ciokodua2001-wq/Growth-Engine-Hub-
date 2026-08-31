import { useLocation } from "wouter";
import type { ReactNode } from "react";
import { isDevHost } from "@/lib/domain-map";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentUser } from "@/hooks/use-current-user";

/**
 * After Caddy HTTP Basic Auth, these routes behave like production: a first
 * visit to / shows the real landing page (with the development banner).
 * Dashboard / project / admin still require a signed-in, canAccessDev account.
 */
const PUBLIC_DURING_GATE = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/auth/redirect",
  "/privacy",
  "/terms",
  "/contact",
  "/about",
  "/refund-policy",
  "/plans",
  "/pricing",
  "/login",
  "/signup",
  "/features",
  "/how-it-works",
  "/team/accept",
]);

function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#040B14] flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">{children}</div>
    </div>
  );
}

/**
 * After the Caddy Basic Auth gate, marketing pages stay reachable without a
 * GrowthForge account so you can test the site as a first-time visitor.
 * App surfaces (dashboard, projects, admin, onboarding) still need a signed-in
 * account with `canAccessDev`. No-op on production.
 */
export function DevAccessGate({ children }: { children: ReactNode }) {
  const isDev = isDevHost();
  const [pathname] = useLocation();
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { data: currentUser, isLoading: userLoading, isError } = useCurrentUser();

  if (!isDev) return <>{children}</>;

  // Let unauthenticated visitors reach sign-in/sign-up so they can actually log in.
  if (PUBLIC_DURING_GATE.has(pathname)) return <>{children}</>;

  if (!isLoaded) {
    return (
      <CenteredScreen>
        <div className="w-6 h-6 mx-auto border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </CenteredScreen>
    );
  }

  if (!isSignedIn) {
    return (
      <CenteredScreen>
        <h1 className="text-xl font-semibold text-white">Development Environment</h1>
        <p className="text-white/60 text-sm">
          This is a private development environment. Sign in with an approved account to continue.
        </p>
        <a
          href="/sign-in"
          className="inline-block rounded-lg bg-[#00E676] text-black font-semibold text-sm px-5 py-2.5 hover:opacity-90 transition"
        >
          Sign in
        </a>
      </CenteredScreen>
    );
  }

  if (userLoading) {
    return (
      <CenteredScreen>
        <div className="w-6 h-6 mx-auto border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </CenteredScreen>
    );
  }

  if (isError || !currentUser?.canAccessDev) {
    return (
      <CenteredScreen>
        <h1 className="text-xl font-semibold text-white">Access Restricted</h1>
        <p className="text-white/60 text-sm">
          Your account has not been approved for the development environment. Contact a GrowthForge admin if you
          believe this is a mistake.
        </p>
        <button
          type="button"
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          className="inline-block rounded-lg border border-white/15 text-white/80 font-medium text-sm px-5 py-2.5 hover:bg-white/5 transition"
        >
          Sign out
        </button>
      </CenteredScreen>
    );
  }

  return <>{children}</>;
}

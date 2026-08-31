import { useLocation } from "wouter";
import type { ReactNode } from "react";
import { isDevHost } from "@/lib/domain-map";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentUser } from "@/hooks/use-current-user";

/**
 * Routes that stay reachable on dev.usegrowthforge.com without signing in —
 * this must mirror exactly what's genuinely public (no auth) on production,
 * so dev gives the same pre-launch experience as the real launch site:
 * the marketing/legal pages are open to everyone, while the actual app
 * (dashboard, projects, admin, onboarding) still requires a signed-in,
 * admin-approved (`canAccessDev`) account, same as it always has.
 */
const PUBLIC_DURING_GATE = new Set([
  "/", // landing page — public on production, must be public on dev too
  "/sign-in", "/sign-up", "/auth/redirect",
  "/privacy", "/terms", "/contact", "/about", "/refund-policy",
  // SEO-friendly redirect aliases (see App.tsx) — these just bounce to an
  // already-public destination, so they must be reachable pre-auth too.
  "/pricing", "/login", "/signup", "/features", "/how-it-works",
]);

function CenteredScreen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#040B14] flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">{children}</div>
    </div>
  );
}

/**
 * Gates every route on dev.usegrowthforge.com behind Supabase auth + an
 * admin-approved `canAccessDev` flag — "the development application must
 * require authentication before any content, features, dashboards,
 * rendering tools, or platform functionality can be accessed." This is the
 * app-level layer; Caddy's Basic Auth in front of the whole host is the
 * network-level layer on top of it.
 *
 * A no-op on production, where the public landing page etc. remain public.
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

import { useLocation } from "wouter";
import type { ReactNode } from "react";
import { isDevHost } from "@/lib/domain-map";
import { useAuth } from "@/contexts/auth-context";
import { useCurrentUser } from "@/hooks/use-current-user";

/**
 * Routes that must stay reachable on dev.usegrowthforge.com even before an
 * account is signed in / approved, so a real developer can actually get in.
 * Everything else — including the public marketing landing page, which IS
 * public on production — requires a signed-in, admin-approved account here.
 */
const PUBLIC_DURING_GATE = new Set(["/sign-in", "/sign-up", "/auth/redirect"]);

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

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/authClient";

/**
 * Clerk-shaped user object. Kept intentionally close to Clerk's `User` shape
 * (`firstName`, `emailAddresses`, `primaryEmailAddress`) so the many existing
 * call sites that read `user.firstName` / `user.primaryEmailAddress?.emailAddress`
 * keep working unchanged after swapping Supabase Auth for Better Auth.
 */
export interface AuthUser {
  id: string;
  firstName: string | null;
  emailAddresses: Array<{ emailAddress: string }>;
  primaryEmailAddress: { emailAddress: string } | null;
}

interface BetterAuthUserLike {
  id?: string;
  name?: string | null;
  email?: string | null;
}

function toAuthUser(baUser: BetterAuthUserLike | null | undefined): AuthUser | null {
  if (!baUser) return null;
  const email = baUser.email ?? null;
  const name = baUser.name ?? null;
  const firstName = name?.trim()?.split(/\s+/)[0] || (email ? email.split("@")[0] : null);
  return {
    id: baUser.id ?? "",
    firstName: firstName || null,
    emailAddresses: email ? [{ emailAddress: email }] : [],
    primaryEmailAddress: email ? { emailAddress: email } : null,
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  session: unknown;
  isLoaded: boolean;
  isSignedIn: boolean;
  signOut: (opts?: { redirectUrl?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const user = toAuthUser(session?.user);
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const newUserId = user?.id ?? null;
    // Clear cached queries when the signed-in user actually changes (sign in,
    // sign out, or switching accounts) - mirrors the old Supabase behavior so
    // stale data from a previous user never leaks into the next session.
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== newUserId) {
      queryClient.clear();
    }
    prevUserIdRef.current = newUserId;
  }, [user?.id, queryClient]);

  const signOut = async (opts?: { redirectUrl?: string }): Promise<void> => {
    try {
      await authClient.signOut();
    } finally {
      queryClient.clear();
      if (opts?.redirectUrl) {
        window.location.href = opts.redirectUrl;
      }
    }
  };

  const value: AuthContextValue = {
    user,
    session,
    isLoaded: !isPending,
    isSignedIn: !!user,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Clerk-compatible replacement for `useUser()` + `useClerk()` combined. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

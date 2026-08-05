import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";

/**
 * Clerk-shaped user object. Kept intentionally close to Clerk's `User` shape
 * (`firstName`, `emailAddresses`, `primaryEmailAddress`) so the many existing
 * call sites that read `user.firstName` / `user.primaryEmailAddress?.emailAddress`
 * keep working unchanged after swapping `useUser()` for `useAuth()`.
 */
export interface AuthUser {
  id: string;
  firstName: string | null;
  emailAddresses: Array<{ emailAddress: string }>;
  primaryEmailAddress: { emailAddress: string } | null;
}

function toAuthUser(supabaseUser: SupabaseUser | null | undefined): AuthUser | null {
  if (!supabaseUser) return null;
  const email = supabaseUser.email ?? null;
  const metadata = supabaseUser.user_metadata ?? {};
  const firstName =
    (metadata["first_name"] as string | undefined) ??
    (metadata["full_name"] as string | undefined)?.split(" ")[0] ??
    (metadata["name"] as string | undefined)?.split(" ")[0] ??
    null;

  return {
    id: supabaseUser.id,
    firstName,
    emailAddresses: email ? [{ emailAddress: email }] : [],
    primaryEmailAddress: email ? { emailAddress: email } : null,
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  signOut: (opts?: { redirectUrl?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      prevUserIdRef.current = data.session?.user.id ?? null;
      setSession(data.session);
      setIsLoaded(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      const newUserId = newSession?.user.id ?? null;
      // Clear cached queries when the signed-in user actually changes (sign
      // in, sign out, or switching accounts) — mirrors the old Clerk
      // cache-invalidation behavior so stale data from a previous user
      // never leaks into the next session.
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== newUserId) {
        queryClient.clear();
      }
      prevUserIdRef.current = newUserId;
      setSession(newSession);
      setIsLoaded(true);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [queryClient]);

  const signOut = async (opts?: { redirectUrl?: string }): Promise<void> => {
    await supabase.auth.signOut();
    if (opts?.redirectUrl) {
      window.location.href = opts.redirectUrl;
    }
  };

  const value: AuthContextValue = {
    user: toAuthUser(session?.user),
    session,
    isLoaded,
    isSignedIn: !!session,
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

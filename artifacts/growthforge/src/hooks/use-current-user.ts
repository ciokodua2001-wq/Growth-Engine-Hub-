import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";

export interface CurrentUser {
  id: string;
  email: string | null;
  role: string;
  isOwner: boolean;
  plan: string;
  subscriptionStatus: string;
  suspended: boolean;
  onboardingComplete: boolean;
  canAccessDev: boolean;
}

export function isAdminRole(role: string | undefined | null): boolean {
  return role === "admin" || role === "super_admin";
}

/**
 * Fetches the app-level user record (role, plan, etc.) for the signed-in user.
 * Only fires the request once auth has finished loading and confirms a user is present.
 */
export function useCurrentUser() {
  const { user, isLoaded } = useAuth();

  const query = useQuery<CurrentUser>({
    queryKey: ["/api/auth/me", user?.id],
    queryFn: async () => {
      // Use provision (not /me) so the DB row is created automatically on
      // first load — avoids FK failures when the user skips the plans page.
      const r = await fetch("/api/auth/provision", {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Failed to provision user: ${r.status}`);
      return r.json();
    },
    enabled: isLoaded && !!user,
    staleTime: 60_000,
    retry: false,
  });

  return {
    ...query,
    isAdmin: isAdminRole(query.data?.role),
  };
}

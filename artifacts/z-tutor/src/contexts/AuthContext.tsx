import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useUser, useAuth } from "@clerk/clerk-react";

interface AuthContextValue {
  userId: string | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue>({
  userId: null,
  isLoaded: false,
  isSignedIn: false,
  getToken: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();

  const value: AuthContextValue = {
    userId: user?.id ?? null,
    isLoaded,
    isSignedIn: !!user,
    getToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  return useContext(AuthContext);
}

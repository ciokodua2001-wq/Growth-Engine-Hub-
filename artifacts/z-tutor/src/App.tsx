import { ClerkProvider, useUser } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { useEffect, useState } from "react";

import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import Chat from "@/pages/chat";
import Settings from "@/pages/settings";
import Pricing from "@/pages/pricing";
import SsoCallback from "@/pages/sso-callback";
import AdminDashboard from "@/pages/admin";
import { apiFetch } from "@/lib/api";

const queryClient = new QueryClient();
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function AppRoutes() {
  const { isSignedIn, isLoaded } = useUser();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Once signed in, check admin status once
  useEffect(() => {
    if (!isSignedIn) { setIsAdmin(null); return; }
    apiFetch<{ isAdmin: boolean }>("/z/admin/check")
      .then((r) => setIsAdmin(r.isAdmin))
      .catch(() => setIsAdmin(false));
  }, [isSignedIn]);

  // Show spinner until Clerk and admin check are both resolved
  if (!isLoaded || (isSignedIn && isAdmin === null)) {
    return (
      <div className="min-h-screen bg-[#080B14] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-900/40">
            Z
          </div>
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/sso-callback" component={SsoCallback} />
      <Route path="/pricing" component={Pricing} />

      {/* Admin routes */}
      {isSignedIn && isAdmin && <Route path="/" component={AdminDashboard} />}
      {isSignedIn && isAdmin && <Route path="/admin" component={AdminDashboard} />}
      {/* Redirect admins away from student pages */}
      {isSignedIn && isAdmin && <Route path="/:rest*">{() => <Redirect to="/" />}</Route>}

      {/* Student routes */}
      {!isSignedIn && <Route path="/" component={Landing} />}
      {isSignedIn && !isAdmin && <Route path="/" component={Dashboard} />}
      {isSignedIn && !isAdmin && <Route path="/onboarding" component={Onboarding} />}
      {isSignedIn && !isAdmin && <Route path="/chat/:sessionId" component={Chat} />}
      {isSignedIn && !isAdmin && <Route path="/settings" component={Settings} />}

      {/* Redirect unauthenticated users to landing */}
      {!isSignedIn && <Route path="/:rest*">{() => <Redirect to="/" />}</Route>}

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  if (!PUBLISHABLE_KEY) {
    return (
      <div className="min-h-screen bg-[#080B14] flex items-center justify-center text-white text-sm">
        Missing VITE_CLERK_PUBLISHABLE_KEY
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={{ baseTheme: dark }}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={BASE}>
            <AppRoutes />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;

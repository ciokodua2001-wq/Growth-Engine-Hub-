import { ClerkProvider, useUser } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";

import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Onboarding from "@/pages/onboarding";
import Dashboard from "@/pages/dashboard";
import Chat from "@/pages/chat";
import Settings from "@/pages/settings";
import Pricing from "@/pages/pricing";
import SsoCallback from "@/pages/sso-callback";

const queryClient = new QueryClient();

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function AppRoutes() {
  const { isSignedIn, isLoaded } = useUser();

  if (!isLoaded) {
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
      {!isSignedIn && <Route path="/" component={Landing} />}
      {isSignedIn && <Route path="/" component={Dashboard} />}
      {isSignedIn && <Route path="/onboarding" component={Onboarding} />}
      {isSignedIn && <Route path="/chat/:sessionId" component={Chat} />}
      {isSignedIn && <Route path="/settings" component={Settings} />}
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
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={{ baseTheme: dark }}
    >
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

import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { dark } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import AdminDashboard from "@/pages/admin/index";
import AdminUsers from "@/pages/admin/users";
import AdminProjects from "@/pages/admin/projects";
import AdminSubscriptions from "@/pages/admin/subscriptions";
import AdminAI from "@/pages/admin/ai";
import AdminContent from "@/pages/admin/content";
import AdminSupport from "@/pages/admin/support";
import AdminAnalytics from "@/pages/admin/analytics";
import AdminFeatures from "@/pages/admin/features";
import AdminAnnouncements from "@/pages/admin/announcements";
import AdminActivity from "@/pages/admin/activity";
import AdminAudit from "@/pages/admin/audit";
import AdminSettings from "@/pages/admin/settings";

import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";
import PlansPage from "@/pages/plans";
import OnboardingPage from "@/pages/onboarding";
import AnalysisProgressPage from "@/pages/analysis-progress";
import ProjectLayout from "@/components/layout/project-layout";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import ContactPage from "@/pages/contact";
import AboutPage from "@/pages/about";
import RefundPolicyPage from "@/pages/refund-policy";

import ProjectOverview from "@/pages/project/overview";
import ProjectAnalysis from "@/pages/project/analysis";
import ProjectCompetitors from "@/pages/project/competitors";
import ProjectStrategy from "@/pages/project/strategy";
import ProjectContent from "@/pages/project/content";
import ProjectSocial from "@/pages/project/social";
import ProjectEmail from "@/pages/project/email";
import ProjectAds from "@/pages/project/ads";
import ProjectVideos from "@/pages/project/videos";
import ProjectCampaigns from "@/pages/project/campaigns";
import ProjectAssets from "@/pages/project/assets";
import ProjectAnalytics from "@/pages/project/analytics";
import ProjectAgent from "@/pages/project/agent";
import ProjectSettings from "@/pages/project/settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// Required verbatim — resolves publishable key per hostname for custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// Empty in dev (intentional), auto-set in prod. Do NOT gate on PROD/NODE_ENV.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  baseTheme: dark,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#00E676",
    colorForeground: "#ffffff",
    colorMutedForeground: "#7a8fa6",
    colorDanger: "#ff4757",
    colorBackground: "#081526",
    colorInput: "#0d1b2e",
    colorInputForeground: "#ffffff",
    colorNeutral: "#1e3a5f",
    fontFamily: "Inter, -apple-system, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[#081526] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl shadow-black/60 border border-[#1e3a5f]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-bold",
    headerSubtitle: "text-[#7a8fa6]",
    socialButtonsBlockButtonText: "text-white",
    formFieldLabel: "text-[#a8b8cc] text-sm",
    footerActionLink: "text-[#00E676] hover:text-[#14F195]",
    footerActionText: "text-[#7a8fa6]",
    dividerText: "text-[#7a8fa6]",
    identityPreviewEditButton: "text-[#00E676]",
    formFieldSuccessText: "text-[#00E676]",
    alertText: "text-white",
    logoBox: "flex justify-center py-2",
    logoImage: "h-8 w-auto",
    socialButtonsBlockButton:
      "bg-[#0f2035] border-[#1e3a5f] hover:bg-[#1e3a5f] text-white",
    formButtonPrimary:
      "bg-[#00E676] hover:bg-[#14F195] text-black font-semibold",
    formFieldInput: "bg-[#0f2035] border-[#1e3a5f] text-white",
    footerAction: "bg-transparent border-t border-[#1e3a5f]",
    dividerLine: "bg-[#1e3a5f]",
    alert: "bg-[#0f2035] border-[#1e3a5f]",
    otpCodeFieldInput: "bg-[#0f2035] border-[#1e3a5f] text-white",
    formFieldRow: "",
    main: "gap-4",
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />

      {/* Auth — /*? optional wildcard required for Clerk OAuth sub-paths */}
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />

      {/* Onboarding funnel */}
      <Route path="/plans" component={PlansPage} />
      <Route path="/onboarding" component={OnboardingPage} />
      <Route path="/analysis-progress/:projectId" component={AnalysisProgressPage} />

      {/* SEO-friendly route aliases */}
      <Route path="/pricing"><Redirect to="/plans" /></Route>
      <Route path="/login"><Redirect to="/sign-in" /></Route>
      <Route path="/signup"><Redirect to="/sign-up" /></Route>
      <Route path="/features"><Redirect to="/" /></Route>
      <Route path="/how-it-works"><Redirect to="/" /></Route>

      {/* Legal & informational pages */}
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/refund-policy" component={RefundPolicyPage} />

      <Route path="/dashboard" component={DashboardPage} />

      {/* Admin routes */}
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/projects" component={AdminProjects} />
      <Route path="/admin/subscriptions" component={AdminSubscriptions} />
      <Route path="/admin/ai" component={AdminAI} />
      <Route path="/admin/content" component={AdminContent} />
      <Route path="/admin/support" component={AdminSupport} />
      <Route path="/admin/analytics" component={AdminAnalytics} />
      <Route path="/admin/features" component={AdminFeatures} />
      <Route path="/admin/announcements" component={AdminAnnouncements} />
      <Route path="/admin/activity" component={AdminActivity} />
      <Route path="/admin/audit" component={AdminAudit} />
      <Route path="/admin/settings" component={AdminSettings} />

      <Route path="/projects/:projectId/:path*">
        {(params) => (
          <ProjectLayout projectId={params.projectId}>
            <Switch>
              <Route
                path="/projects/:projectId/overview"
                component={ProjectOverview}
              />
              <Route
                path="/projects/:projectId/analysis"
                component={ProjectAnalysis}
              />
              <Route
                path="/projects/:projectId/competitors"
                component={ProjectCompetitors}
              />
              <Route
                path="/projects/:projectId/strategy"
                component={ProjectStrategy}
              />
              <Route
                path="/projects/:projectId/content"
                component={ProjectContent}
              />
              <Route
                path="/projects/:projectId/social"
                component={ProjectSocial}
              />
              <Route
                path="/projects/:projectId/email"
                component={ProjectEmail}
              />
              <Route path="/projects/:projectId/ads" component={ProjectAds} />
              <Route
                path="/projects/:projectId/videos"
                component={ProjectVideos}
              />
              <Route
                path="/projects/:projectId/campaigns"
                component={ProjectCampaigns}
              />
              <Route
                path="/projects/:projectId/assets"
                component={ProjectAssets}
              />
              <Route
                path="/projects/:projectId/analytics"
                component={ProjectAnalytics}
              />
              <Route
                path="/projects/:projectId/agent"
                component={ProjectAgent}
              />
              <Route
                path="/projects/:projectId/settings"
                component={ProjectSettings}
              />
              <Route component={NotFound} />
            </Switch>
          </ProjectLayout>
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={`${basePath}/dashboard`}
      signUpFallbackRedirectUrl={`${basePath}/plans`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <AppRoutes />
        </TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  if (typeof document !== "undefined") {
    document.documentElement.classList.add("dark");
  }
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;

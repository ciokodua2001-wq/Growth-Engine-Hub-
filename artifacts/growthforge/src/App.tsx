import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/auth-context";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { basePath } from "@/lib/basePath";
import { DevEnvironmentBanner } from "@/components/dev-environment-banner";
import { DevAccessGate } from "@/components/dev-access-gate";
import NotFound from "@/pages/not-found";

import AdminDashboard from "@/pages/admin/index";
import AdminUsers from "@/pages/admin/users";
import AdminProjects from "@/pages/admin/projects";
import AdminSubscriptions from "@/pages/admin/subscriptions";
import AdminIntegrity from "@/pages/admin/integrity";
import AdminAI from "@/pages/admin/ai";
import AdminContent from "@/pages/admin/content";
import AdminSupport from "@/pages/admin/support";
import AdminAnalytics from "@/pages/admin/analytics";
import AdminFeatures from "@/pages/admin/features";
import AdminAnnouncements from "@/pages/admin/announcements";
import AdminActivity from "@/pages/admin/activity";
import AdminAudit from "@/pages/admin/audit";
import AdminSettings from "@/pages/admin/settings";
import AdminCredits from "@/pages/admin/credits";
import OwnerDashboard from "@/pages/admin/owner-dashboard";
import OwnerSetup from "@/pages/admin/owner-setup";
import OwnerContacts from "@/pages/admin/owner-contacts";
import OwnerCampaigns from "@/pages/admin/owner-campaigns";
import OwnerCampaignComposer from "@/pages/admin/owner-campaign-composer";
import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import AuthRedirectPage from "@/pages/auth-redirect";
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
import ProjectCalendar from "@/pages/project/calendar";
import ProjectAgent from "@/pages/project/agent";
import ProjectSettings from "@/pages/project/settings";
import ProjectTeam from "@/pages/project/team";
import TeamAccept from "@/pages/team-accept";
import ProjectSeo from "@/pages/project/seo";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />

      {/* Auth */}
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/sign-up" component={SignUpPage} />
      <Route path="/auth/redirect" component={AuthRedirectPage} />

      {/* Onboarding funnel */}
      <Route path="/plans" component={PlansPage} />
      <Route path="/team/accept" component={TeamAccept} />
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
      <Route path="/admin/integrity" component={AdminIntegrity} />
      <Route path="/admin/ai" component={AdminAI} />
      <Route path="/admin/content" component={AdminContent} />
      <Route path="/admin/support" component={AdminSupport} />
      <Route path="/admin/analytics" component={AdminAnalytics} />
      <Route path="/admin/features" component={AdminFeatures} />
      <Route path="/admin/announcements" component={AdminAnnouncements} />
      <Route path="/admin/activity" component={AdminActivity} />
      <Route path="/admin/audit" component={AdminAudit} />
      <Route path="/admin/settings" component={AdminSettings} />
      <Route path="/admin/credits" component={AdminCredits} />
      <Route path="/admin/owner/dashboard" component={OwnerDashboard} />
      <Route path="/admin/owner/setup" component={OwnerSetup} />
      <Route path="/admin/owner/contacts" component={OwnerContacts} />
      <Route path="/admin/owner/campaigns/new" component={OwnerCampaignComposer} />
      <Route path="/admin/owner/campaigns" component={OwnerCampaigns} />

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
                path="/projects/:projectId/calendar"
                component={ProjectCalendar}
              />
              <Route
                path="/projects/:projectId/agent"
                component={ProjectAgent}
              />
              <Route
                path="/projects/:projectId/seo"
                component={ProjectSeo}
              />
              <Route
                path="/projects/:projectId/settings"
                component={ProjectSettings}
              />
              <Route
                path="/projects/:projectId/team"
                component={ProjectTeam}
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

function App() {
  if (typeof document !== "undefined") {
    document.documentElement.classList.add("dark");
  }
  return (
    <WouterRouter base={basePath}>
      <DevEnvironmentBanner />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <DevAccessGate>
              <AppRoutes />
            </DevAccessGate>
          </TooltipProvider>
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;

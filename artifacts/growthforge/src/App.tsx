import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import ProjectLayout from "@/components/layout/project-layout";

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
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/dashboard" component={DashboardPage} />
      
      <Route path="/projects/:projectId/:path*">
        {(params) => (
          <ProjectLayout projectId={params.projectId}>
            <Switch>
              <Route path="/projects/:projectId/overview" component={ProjectOverview} />
              <Route path="/projects/:projectId/analysis" component={ProjectAnalysis} />
              <Route path="/projects/:projectId/competitors" component={ProjectCompetitors} />
              <Route path="/projects/:projectId/strategy" component={ProjectStrategy} />
              <Route path="/projects/:projectId/content" component={ProjectContent} />
              <Route path="/projects/:projectId/social" component={ProjectSocial} />
              <Route path="/projects/:projectId/email" component={ProjectEmail} />
              <Route path="/projects/:projectId/ads" component={ProjectAds} />
              <Route path="/projects/:projectId/videos" component={ProjectVideos} />
              <Route path="/projects/:projectId/campaigns" component={ProjectCampaigns} />
              <Route path="/projects/:projectId/assets" component={ProjectAssets} />
              <Route path="/projects/:projectId/analytics" component={ProjectAnalytics} />
              <Route path="/projects/:projectId/agent" component={ProjectAgent} />
              <Route path="/projects/:projectId/settings" component={ProjectSettings} />
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
  // Force dark mode on html element
  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('dark');
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

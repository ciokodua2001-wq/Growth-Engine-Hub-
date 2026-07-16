import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useGetProject } from "@workspace/api-client-react";
import { TrialBanner } from "@/components/ui/trial-banner";
import { TrialStatusPanel } from "@/components/ui/trial-status-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  LayoutDashboard, Brain, Users2, Megaphone, FileText, Share2,
  Mail, Rss, Video, Target, FolderOpen, BarChart2, Bot, Settings,
  ChevronLeft, ChevronRight, Zap, ArrowLeft, Menu, X, CalendarDays,
  SearchCheck, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navGroups = [
  {
    group: "Intelligence",
    items: [
      { label: "Overview", path: "overview", icon: LayoutDashboard },
      { label: "Analysis", path: "analysis", icon: Brain },
      { label: "Competitors", path: "competitors", icon: Users2 },
      { label: "Strategy", path: "strategy", icon: Megaphone },
      { label: "SEO Strategy", path: "seo", icon: SearchCheck },
    ],
  },
  {
    group: "Content",
    items: [
      { label: "Content Engine", path: "content", icon: FileText },
      { label: "Social Media", path: "social", icon: Share2 },
      { label: "Email", path: "email", icon: Mail },
      { label: "Ad Creatives", path: "ads", icon: Rss },
      { label: "Video Studio", path: "videos", icon: Video },
    ],
  },
  {
    group: "Growth",
    items: [
      { label: "Campaigns", path: "campaigns", icon: Target },
      { label: "Calendar", path: "calendar", icon: CalendarDays },
      { label: "Assets", path: "assets", icon: FolderOpen },
      { label: "Analytics", path: "analytics", icon: BarChart2 },
    ],
  },
  {
    group: "AI",
    items: [
      { label: "AI Agent", path: "agent", icon: Bot },
    ],
  },
  {
    group: "Workspace",
    items: [
      { label: "Team", path: "team", icon: Users },
      { label: "Settings", path: "settings", icon: Settings },
    ],
  },
];

interface ProjectLayoutProps {
  projectId: string;
  children: React.ReactNode;
}

export default function ProjectLayout({ projectId, children }: ProjectLayoutProps) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const [trialInfo, setTrialInfo] = useState<{ subscriptionStatus?: string; trialEndsAt?: string } | null>(null);
  const id = parseInt(projectId, 10);
  const { data: project } = useGetProject(id, { query: { enabled: !!id } });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((u) => setTrialInfo({ subscriptionStatus: u.subscriptionStatus, trialEndsAt: u.trialEndsAt }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const isActive = (path: string) => location === `/projects/${projectId}/${path}`;
  const effectiveCollapsed = isMobile ? false : collapsed;

  return (
    <div className="flex h-screen bg-background overflow-hidden relative">
      {/* Mobile top bar */}
      {isMobile && (
        <div className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between h-14 px-3 border-b border-border bg-sidebar">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 rounded bg-primary/20 flex items-center justify-center shrink-0">
              <Zap className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-xs font-semibold text-foreground truncate max-w-[160px]">
              {project?.name ?? "Project"}
            </span>
          </div>
          <Link
            href="/dashboard"
            className="p-2 -mr-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </div>
      )}

      {/* Mobile backdrop */}
      {isMobile && mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border bg-sidebar transition-all duration-300 shrink-0",
          isMobile
            ? cn(
                "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform",
                mobileOpen ? "translate-x-0" : "-translate-x-full"
              )
            : cn(collapsed ? "w-16" : "w-60")
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
          {!effectiveCollapsed && (
            <Link href="/dashboard" className="flex items-center gap-2 group">
              <ArrowLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded bg-primary/20 flex items-center justify-center">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-xs font-semibold text-foreground truncate max-w-[110px]">
                  {project?.name ?? "Project"}
                </span>
              </div>
            </Link>
          )}
          {effectiveCollapsed && (
            <Link href="/dashboard" className="mx-auto">
              <div className="h-7 w-7 rounded bg-primary/20 flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary" />
              </div>
            </Link>
          )}
          {isMobile ? (
            <button
              onClick={() => setMobileOpen(false)}
              className="p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className={cn(
                "p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors",
                collapsed && "mx-auto"
              )}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          )}
        </div>

        {/* Status dot + plan badge when expanded */}
        {!effectiveCollapsed && project && (
          <div className="px-4 py-2 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              <span
                className={cn("h-2 w-2 rounded-full", {
                  "bg-green-400": project.status === "complete",
                  "bg-yellow-400": project.status === "processing",
                  "bg-slate-400": project.status === "pending",
                })}
              />
              <span className="text-xs text-muted-foreground capitalize">{project.status}</span>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                {project.plan}
              </span>
            </div>
          </div>
        )}

        {/* Scrollable body: nav + trial panel + footer share one scroll region so the
            trial panel can never squeeze the nav links out of view */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <nav className="py-3 px-2 space-y-4 shrink-0">
            {navGroups.map(({ group, items }) => (
              <div key={group}>
                {!effectiveCollapsed && (
                  <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    {group}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map(({ label, path, icon: Icon }) => {
                    const active = isActive(path);
                    return (
                      <Link
                        key={path}
                        href={`/projects/${projectId}/${path}`}
                        className={cn(
                          "flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-all duration-150",
                          active
                            ? "bg-primary/15 text-primary font-medium"
                            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                          effectiveCollapsed && "justify-center px-0"
                        )}
                        title={effectiveCollapsed ? label : undefined}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                        {!effectiveCollapsed && <span>{label}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Trial Status Panel */}
          <div className="shrink-0 mt-auto">
            <TrialStatusPanel
              projectId={id}
              trialEndsAt={trialInfo?.trialEndsAt}
              subscriptionStatus={trialInfo?.subscriptionStatus}
              collapsed={effectiveCollapsed}
            />

            {/* Footer */}
            {!effectiveCollapsed && (
              <div className="px-4 pb-3 border-t border-sidebar-border pt-2">
                <div className="text-[10px] text-muted-foreground/50 font-mono">GrowthForge v1.0</div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className={cn("flex-1 overflow-y-auto flex flex-col", isMobile && "pt-14")}>
        <TrialBanner
          subscriptionStatus={trialInfo?.subscriptionStatus}
          trialEndsAt={trialInfo?.trialEndsAt}
        />
        <div className="flex-1">{children}</div>
      </main>
    </div>
  );
}

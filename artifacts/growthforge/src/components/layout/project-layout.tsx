import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetProject } from "@workspace/api-client-react";
import {
  LayoutDashboard, Brain, Users2, Megaphone, FileText, Share2,
  Mail, Rss, Video, Target, FolderOpen, BarChart2, Bot, Settings,
  ChevronLeft, ChevronRight, Zap, ArrowLeft,
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
      { label: "Assets", path: "assets", icon: FolderOpen },
      { label: "Analytics", path: "analytics", icon: BarChart2 },
    ],
  },
  {
    group: "AI",
    items: [
      { label: "AI Agent", path: "agent", icon: Bot },
      { label: "Settings", path: "settings", icon: Settings },
    ],
  },
];

interface ProjectLayoutProps {
  projectId: string;
  children: React.ReactNode;
}

export default function ProjectLayout({ projectId, children }: ProjectLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [location] = useLocation();
  const id = parseInt(projectId, 10);
  const { data: project } = useGetProject(id, { query: { enabled: !!id } });

  const isActive = (path: string) => location === `/projects/${projectId}/${path}`;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border bg-sidebar transition-all duration-300 shrink-0",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
          {!collapsed && (
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
          {collapsed && (
            <Link href="/dashboard" className="mx-auto">
              <div className="h-7 w-7 rounded bg-primary/20 flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary" />
              </div>
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "p-1 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors",
              collapsed && "mx-auto"
            )}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* Status dot + plan badge when expanded */}
        {!collapsed && project && (
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

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {navGroups.map(({ group, items }) => (
            <div key={group}>
              {!collapsed && (
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
                        collapsed && "justify-center px-0"
                      )}
                      title={collapsed ? label : undefined}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                      {!collapsed && <span>{label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="p-4 border-t border-sidebar-border">
            <div className="text-[10px] text-muted-foreground/50 font-mono">GrowthForge v1.0</div>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

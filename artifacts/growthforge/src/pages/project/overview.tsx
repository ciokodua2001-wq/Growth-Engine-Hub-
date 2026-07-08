import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetProject,
  useGetProjectDashboard,
  useAnalyzeWebsite,
  getGetProjectDashboardQueryKey,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Brain,
  Video,
  Target,
  Users2,
  Share2,
  Zap,
  Activity,
  CheckCircle2,
  ArrowRight,
  Megaphone,
  Mail,
  FileText,
  TrendingUp,
  Rss,
} from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

const ANALYSIS_STEPS = [
  "Crawling website content...",
  "Extracting business intelligence...",
  "Identifying target customers...",
  "Mapping market opportunities...",
  "Generating strategic insights...",
];

interface WorkflowStep {
  id: string;
  label: string;
  completionLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
  bgClass: string;
  route: string;
  actionLabel: string;
}

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: "analysis",
    label: "Business Analysis",
    completionLabel: "Business Analysis Complete",
    description: "AI scans your site, extracts your ICP, positioning, and market opportunities.",
    icon: Brain,
    accentClass: "text-violet-400",
    bgClass: "bg-violet-400/10 border-violet-400/20",
    route: "analysis",
    actionLabel: "Run Analysis",
  },
  {
    id: "competitors",
    label: "Competitor Intelligence",
    completionLabel: "Competitor Analysis Complete",
    description: "Discover rivals, map their weaknesses, and find your positioning advantage.",
    icon: Users2,
    accentClass: "text-rose-400",
    bgClass: "bg-rose-400/10 border-rose-400/20",
    route: "competitors",
    actionLabel: "Generate Report",
  },
  {
    id: "strategy",
    label: "Content Strategy",
    completionLabel: "Content Strategy Complete",
    description: "Build your marketing playbook — messaging, channels, and conversion funnel.",
    icon: Target,
    accentClass: "text-orange-400",
    bgClass: "bg-orange-400/10 border-orange-400/20",
    route: "strategy",
    actionLabel: "Create Strategy",
  },
  {
    id: "social",
    label: "Social Calendar",
    completionLabel: "Social Calendar Ready",
    description: "Generate 30 days of platform-optimized posts for LinkedIn, Instagram, TikTok.",
    icon: Share2,
    accentClass: "text-pink-400",
    bgClass: "bg-pink-400/10 border-pink-400/20",
    route: "social",
    actionLabel: "Generate Calendar",
  },
  {
    id: "videos",
    label: "Video Blueprints",
    completionLabel: "Blueprints Generated",
    description: "Create video scripts, storyboards, and production notes for every platform.",
    icon: Video,
    accentClass: "text-cyan-400",
    bgClass: "bg-cyan-400/10 border-cyan-400/20",
    route: "videos",
    actionLabel: "Create Blueprints",
  },
  {
    id: "campaign",
    label: "Launch Campaign",
    completionLabel: "Campaign Ready",
    description: "Build ad creatives and launch your first paid marketing campaign.",
    icon: Megaphone,
    accentClass: "text-emerald-400",
    bgClass: "bg-emerald-400/10 border-emerald-400/20",
    route: "campaigns",
    actionLabel: "Launch Campaign",
  },
];

const QUICK_STATS = [
  { key: "totalContent", label: "Content", icon: FileText, color: "text-violet-400" },
  { key: "totalVideos", label: "Videos", icon: Video, color: "text-cyan-400" },
  { key: "totalCompetitors", label: "Competitors", icon: Users2, color: "text-rose-400" },
  { key: "totalSocialPosts", label: "Social Posts", icon: Share2, color: "text-pink-400" },
  { key: "totalEmails", label: "Emails", icon: Mail, color: "text-blue-400" },
  { key: "totalAds", label: "Ad Creatives", icon: Rss, color: "text-orange-400" },
  { key: "totalCampaigns", label: "Campaigns", icon: Target, color: "text-emerald-400" },
] as const;

function getStepComplete(
  stepId: string,
  dashboard: {
    analysisStatus?: string | null;
    totalCompetitors: number;
    hasStrategy?: boolean;
    totalSocialPosts?: number;
    totalVideos: number;
    totalCampaigns: number;
    totalAds?: number;
  }
): boolean {
  switch (stepId) {
    case "analysis": return dashboard.analysisStatus === "complete";
    case "competitors": return dashboard.totalCompetitors > 0;
    case "strategy": return !!dashboard.hasStrategy;
    case "social": return (dashboard.totalSocialPosts ?? 0) > 0;
    case "videos": return dashboard.totalVideos > 0;
    case "campaign": return dashboard.totalCampaigns > 0 || (dashboard.totalAds ?? 0) > 0;
    default: return false;
  }
}

export default function ProjectOverview() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [, setLocation] = useLocation();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: dashboard, isLoading } = useGetProjectDashboard(projectId, { query: { enabled: !!projectId } });
  const analyzeWebsite = useAnalyzeWebsite();
  const queryClient = useQueryClient();

  const handleAnalysisSubmit = (_websiteUrl: string, _instructions: string): Promise<void> => {
    const url = _websiteUrl || project?.websiteUrl || "";
    return new Promise((resolve, reject) => {
      analyzeWebsite.mutate(
        { id: projectId, data: { websiteUrl: url } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetProjectDashboardQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
  };

  const stepsWithStatus = WORKFLOW_STEPS.map((step) => ({
    ...step,
    complete: dashboard ? getStepComplete(step.id, dashboard) : false,
  }));

  const completedCount = stepsWithStatus.filter((s) => s.complete).length;
  const nextStep = stepsWithStatus.find((s) => !s.complete);
  const progressPct = Math.round((completedCount / WORKFLOW_STEPS.length) * 100);
  const allComplete = completedCount === WORKFLOW_STEPS.length;

  const handleStepAction = (step: WorkflowStep) => {
    if (step.id === "analysis") {
      setModalOpen(true);
    } else {
      setLocation(`/projects/${projectId}/${step.route}`);
    }
  };

  return (
    <div className="p-4 sm:p-6 w-full">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black tracking-tight">{project?.name ?? "Project Overview"}</h1>
        <p className="text-muted-foreground text-sm mt-0.5">{project?.websiteUrl}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-40">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* ── Workflow Command Center ─────────────────────────────── */}
          <div className="mb-8">
            {/* Progress header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  Marketing Workflow
                </h2>
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  {allComplete
                    ? "All steps complete — your AI marketing OS is fully active"
                    : `${completedCount} of ${WORKFLOW_STEPS.length} steps complete`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-primary">{progressPct}%</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 w-full bg-secondary rounded-full mb-6 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                className="h-full rounded-full bg-gradient-to-r from-primary to-[#00D4FF]"
              />
            </div>

            {/* Next recommended action — only show if not all complete */}
            <AnimatePresence>
              {nextStep && (
                <motion.div
                  key={nextStep.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mb-6 rounded-2xl border border-primary/30 bg-primary/5 p-5 relative overflow-hidden"
                >
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/5 blur-2xl" />
                  </div>
                  <div className="relative flex items-start gap-4">
                    <div className="h-12 w-12 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                      <nextStep.icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Next Step</span>
                        <span className="text-[10px] text-muted-foreground">
                          Step {stepsWithStatus.findIndex((s) => s.id === nextStep.id) + 1} of {WORKFLOW_STEPS.length}
                        </span>
                      </div>
                      <h3 className="font-black text-lg leading-tight mb-1">{nextStep.label}</h3>
                      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{nextStep.description}</p>
                      <button
                        onClick={() => handleStepAction(nextStep)}
                        className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl transition-all text-sm shadow-lg shadow-primary/20"
                      >
                        <Zap className="h-4 w-4" />
                        {nextStep.actionLabel}
                        <ArrowRight className="h-4 w-4 ml-0.5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Workflow steps timeline */}
            <div className="space-y-2">
              {stepsWithStatus.map((step, i) => {
                const isNext = nextStep?.id === step.id;
                return (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    onClick={() => handleStepAction(step)}
                    className={`group flex items-center gap-4 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                      step.complete
                        ? "bg-card border-border opacity-70 hover:opacity-100"
                        : isNext
                        ? "bg-primary/5 border-primary/20 hover:border-primary/40"
                        : "bg-card/50 border-border/50 hover:border-border hover:bg-card"
                    }`}
                  >
                    {/* Step icon / check */}
                    <div
                      className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border ${
                        step.complete
                          ? "bg-primary/10 border-primary/20"
                          : isNext
                          ? "bg-primary/10 border-primary/25"
                          : "bg-secondary border-border"
                      }`}
                    >
                      {step.complete ? (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      ) : (
                        <step.icon
                          className={`h-4.5 w-4.5 ${isNext ? "text-primary" : "text-muted-foreground"}`}
                        />
                      )}
                    </div>

                    {/* Step info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-semibold ${
                            step.complete
                              ? "text-muted-foreground line-through"
                              : isNext
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }`}
                        >
                          {step.complete ? step.completionLabel : step.label}
                        </span>
                        {step.complete && (
                          <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                            Done
                          </span>
                        )}
                        {isNext && !step.complete && (
                          <span className="text-[10px] font-bold text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded-full animate-pulse">
                            Up Next
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Step number */}
                    <span className="text-xs text-muted-foreground/40 shrink-0 mr-1">
                      {i + 1}/{WORKFLOW_STEPS.length}
                    </span>
                    <ArrowRight
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        isNext ? "text-primary" : "text-muted-foreground/30 group-hover:text-muted-foreground"
                      }`}
                    />
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* ── Quick Stats ─────────────────────────────────────────── */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-3 mb-8">
            {QUICK_STATS.map(({ key, label, icon: Icon, color }, i) => {
              const value = dashboard ? (dashboard[key] ?? 0) : 0;
              return (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.05 }}
                  className="p-4 rounded-xl bg-card border border-border text-center"
                >
                  <Icon className={`h-4 w-4 ${color} mx-auto mb-2`} />
                  <div className="text-2xl font-black">{value}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{label}</div>
                </motion.div>
              );
            })}
          </div>

          {/* ── Recent Activity ─────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="rounded-xl bg-card border border-border p-5"
          >
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-primary" />
              <h2 className="font-bold text-sm">Recent Activity</h2>
            </div>
            {dashboard?.recentActivity && dashboard.recentActivity.length > 0 ? (
              <div className="space-y-2.5">
                {dashboard.recentActivity.slice(0, 8).map(
                  (item: { id: number; type: string; description: string; createdAt: string }) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0"
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span className="text-sm text-foreground flex-1">{item.description}</span>
                      <span className="text-xs text-muted-foreground/60 shrink-0">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <TrendingUp className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">
                  No activity yet.{" "}
                  <button
                    onClick={() => setModalOpen(true)}
                    className="text-primary hover:underline"
                  >
                    Run your first analysis
                  </button>{" "}
                  to get started.
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}

      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Run Business Analysis"
        subtitle="AI will analyze your website and extract business intelligence"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Focus on SEO opportunities\n• Analyze competitor positioning\n• Deep dive into customer pain points`}
        processingSteps={ANALYSIS_STEPS}
        onSubmit={handleAnalysisSubmit}
        ctaLabel="Run Analysis"
      />
    </div>
  );
}

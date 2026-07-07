import { useState } from "react";
import { useParams } from "wouter";
import { useGetProject, useGetProjectDashboard, useAnalyzeWebsite } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Loader2, Brain, Video, Target, Users2, FileText, Mail, Rss, Share2, Zap, Activity } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetProjectDashboardQueryKey } from "@workspace/api-client-react";
import GenerateModal from "@/components/ui/generate-modal";

const ANALYSIS_STEPS = [
  "Crawling website content...",
  "Extracting business intelligence...",
  "Identifying target customers...",
  "Mapping market opportunities...",
  "Generating strategic insights...",
];

function ScoreBar({ value, color = "bg-primary" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className={`h-full rounded-full ${color}`}
      />
    </div>
  );
}

export default function ProjectOverview() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [modalOpen, setModalOpen] = useState(false);
  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: dashboard, isLoading } = useGetProjectDashboard(projectId, { query: { enabled: !!projectId } });
  const analyzeWebsite = useAnalyzeWebsite();
  const queryClient = useQueryClient();

  const handleSubmit = (_websiteUrl: string, _instructions: string): Promise<void> => {
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

  const stats = [
    { label: "Content Pieces", value: dashboard?.totalContent ?? 0, icon: FileText, color: "text-violet-400" },
    { label: "Videos", value: dashboard?.totalVideos ?? 0, icon: Video, color: "text-cyan-400" },
    { label: "Campaigns", value: dashboard?.totalCampaigns ?? 0, icon: Target, color: "text-emerald-400" },
    { label: "Competitors", value: dashboard?.totalCompetitors ?? 0, icon: Users2, color: "text-rose-400" },
    { label: "Ads", value: dashboard?.totalAds ?? 0, icon: Rss, color: "text-orange-400" },
    { label: "Emails", value: dashboard?.totalEmails ?? 0, icon: Mail, color: "text-blue-400" },
    { label: "Social Posts", value: dashboard?.totalSocialPosts ?? 0, icon: Share2, color: "text-pink-400" },
    { label: "AI Sessions", value: 0, icon: Brain, color: "text-primary" },
  ];

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{project?.name ?? "Project Overview"}</h1>
          <p className="text-muted-foreground mt-1">{project?.websiteUrl}</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl transition-colors text-sm"
        >
          <Zap className="h-4 w-4" /> Run Analysis
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {stats.map(({ label, value, icon: Icon, color }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className="p-5 rounded-xl bg-card border border-border"
              >
                <Icon className={`h-5 w-5 ${color} mb-3`} />
                <div className="text-3xl font-black mb-1">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </motion.div>
            ))}
          </div>

          {dashboard?.topMetrics && dashboard.topMetrics.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4 mb-8">
              {dashboard.topMetrics.map((metric: { label: string; value: string; change: number; trend: string }) => (
                <div key={metric.label} className="p-5 rounded-xl bg-card border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">{metric.label}</span>
                    <span className={`text-xs font-semibold ${metric.trend === "up" ? "text-green-400" : "text-red-400"}`}>
                      {metric.trend === "up" ? "+" : "-"}{metric.change}%
                    </span>
                  </div>
                  <div className="text-2xl font-black">{metric.value}</div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl bg-card border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="h-4 w-4 text-primary" />
              <h2 className="font-bold">Recent Activity</h2>
            </div>
            {dashboard?.recentActivity && dashboard.recentActivity.length > 0 ? (
              <div className="space-y-3">
                {dashboard.recentActivity.map((item: { id: number; type: string; description: string; createdAt: string }) => (
                  <div key={item.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                    <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                    <span className="text-sm text-foreground flex-1">{item.description}</span>
                    <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm">No activity yet. Click "Run Analysis" to get started.</p>
              </div>
            )}
          </div>
        </>
      )}

      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Run Business Analysis"
        subtitle="AI will analyze your website and extract business intelligence"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Focus on SEO opportunities\n• Analyze competitor positioning\n• Deep dive into customer pain points\n• Map growth opportunities`}
        processingSteps={ANALYSIS_STEPS}
        onSubmit={handleSubmit}
        ctaLabel="Run Analysis"
      />
    </div>
  );
}

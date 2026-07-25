import { useParams } from "wouter";
import {
  useGetProjectAnalytics,
  useListReports,
  useGenerateReport,
  getListReportsQueryKey,
  getGetProjectAnalyticsQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Loader2, Zap, FileText, ChevronDown, ChevronUp, Download,
  BarChart2, TrendingUp, Mail, Share2, Megaphone, Video,
  Database, CheckCircle2, AlertCircle,
} from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────── */

function fmt(n: number | undefined | null, prefix = "", suffix = "") {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M${suffix}`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}K${suffix}`;
  return `${prefix}${n.toFixed(n % 1 === 0 ? 0 : 2)}${suffix}`;
}

function fmtCurrency(n: number | undefined | null) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtRoas(n: number | undefined | null) {
  if (!n) return "—";
  return `${n.toFixed(2)}x`;
}

/* ── sub-components ─────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  empty,
  delay = 0,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  empty?: boolean;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`p-5 rounded-xl bg-card border ${empty ? "border-dashed border-white/10 opacity-60" : "border-border"}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className={`text-3xl font-black ${empty ? "text-white/30" : color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </motion.div>
  );
}

function SectionHeader({ icon: Icon, title, badge }: { icon: React.ElementType; title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="h-4 w-4 text-primary" />
      <h2 className="font-bold text-sm uppercase tracking-widest text-white/70">{title}</h2>
      {badge && (
        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
          {badge}
        </span>
      )}
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-4 px-1">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </div>
  );
}

/* ── main page ───────────────────────────────────────────────── */

export default function ProjectAnalytics() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);

  const { data: analytics, isLoading } = useGetProjectAnalytics(projectId, {
    query: { queryKey: getGetProjectAnalyticsQueryKey(projectId), enabled: !!projectId },
  });
  const { data: reports } = useListReports(projectId, {
    query: { queryKey: getListReportsQueryKey(projectId), enabled: !!projectId },
  });
  const generateReport = useGenerateReport();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleGenerateReport = () => {
    generateReport.mutate(
      { id: projectId, data: { type: "performance", period: "monthly" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
          toast({ title: "Report generated" });
        },
        onError: () => toast({ title: "Failed to generate report", variant: "destructive" }),
      }
    );
  };

  const hasAdData    = !!analytics && (analytics.adSpend! > 0 || analytics.impressions! > 0);
  const hasSocial    = !!analytics && (analytics.publishedPosts! > 0 || analytics.socialReach! > 0);
  const hasEmail     = !!analytics && analytics.sentCampaigns! > 0;
  const hasContent   = !!analytics && (analytics.contentPieces! > 0 || analytics.videosCreated! > 0 || analytics.adsGenerated! > 0);
  const hasAnyData   = hasAdData || hasSocial || hasEmail || hasContent;

  const connectedPlatforms: string[] = (analytics?.connectedPlatforms as string[] | undefined) ?? [];

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Analytics & Reporting</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Real data from your GrowthForge activity
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Live data badge */}
          <span className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Data
          </span>
          <button
            onClick={handleGenerateReport}
            disabled={generateReport.isPending}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            {generateReport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Generate Report
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !analytics ? (
        <div className="text-center py-16 text-muted-foreground">Failed to load analytics.</div>
      ) : (
        <>
          {/* Connected platforms */}
          {connectedPlatforms.length > 0 && (
            <div className="flex items-center gap-2 mb-6 flex-wrap">
              <span className="text-xs text-muted-foreground">Connected:</span>
              {connectedPlatforms.map(p => (
                <span key={p} className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-white/5 border border-white/10">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  {p === "google_ads" ? "Google Ads" : p === "meta" ? "Meta Ads" : p}
                </span>
              ))}
            </div>
          )}

          {/* No data onboarding hint */}
          {!hasAnyData && (
            <div className="mb-8 p-5 rounded-xl border border-dashed border-white/10 bg-white/2 flex items-start gap-4">
              <Database className="h-5 w-5 text-primary/50 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-sm mb-1">No activity yet</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Start generating content, publishing social posts, sending emails, or running campaigns — 
                  your real numbers will appear here automatically.
                </p>
              </div>
            </div>
          )}

          {/* ── Paid Ads ─────────────────────────────── */}
          <div className="mb-8">
            <SectionHeader icon={Megaphone} title="Paid Advertising" badge={hasAdData ? "Data from your campaigns" : undefined} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Ad Spend" value={fmtCurrency(analytics.adSpend)} icon={TrendingUp} color="text-violet-400" empty={!hasAdData} delay={0} />
              <KpiCard label="ROAS" value={fmtRoas(analytics.roas)} sub="Return on ad spend" icon={TrendingUp} color="text-primary" empty={!hasAdData} delay={0.05} />
              <KpiCard label="Impressions" value={fmt(analytics.impressions)} icon={BarChart2} color="text-cyan-400" empty={!hasAdData} delay={0.1} />
              <KpiCard label="Conversions" value={fmt(analytics.conversions)} sub={analytics.clicks ? `${analytics.clicks.toLocaleString()} clicks` : undefined} icon={TrendingUp} color="text-emerald-400" empty={!hasAdData} delay={0.15} />
            </div>
            {!hasAdData && (
              <EmptySection message="Create campaigns in the Campaigns tab to see paid ad metrics." />
            )}
          </div>

          {/* ── Social ───────────────────────────────── */}
          <div className="mb-8">
            <SectionHeader icon={Share2} title="Social Media" badge={hasSocial ? `${analytics.publishedPosts} posts published` : undefined} />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KpiCard label="Total Reach" value={fmt(analytics.socialReach)} icon={Share2} color="text-cyan-400" empty={!hasSocial} delay={0} />
              <KpiCard label="Engagement" value={fmt(analytics.socialEngagement)} sub="Likes + comments" icon={TrendingUp} color="text-violet-400" empty={!hasSocial} delay={0.05} />
              <KpiCard label="Posts Published" value={fmt(analytics.publishedPosts)} icon={Share2} color="text-primary" empty={!hasSocial} delay={0.1} />
            </div>
            {!hasSocial && (
              <EmptySection message="Publish social posts via the Social Media tab to populate reach and engagement." />
            )}
          </div>

          {/* ── Email ────────────────────────────────── */}
          <div className="mb-8">
            <SectionHeader icon={Mail} title="Email" badge={hasEmail ? `${analytics.sentCampaigns} campaigns sent` : undefined} />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <KpiCard label="Recipients" value={fmt(analytics.emailRecipients)} icon={Mail} color="text-emerald-400" empty={!hasEmail} delay={0} />
              <KpiCard label="Open Rate" value={analytics.emailOpenRate ? `${analytics.emailOpenRate.toFixed(1)}%` : "—"} icon={TrendingUp} color="text-cyan-400" empty={!hasEmail} delay={0.05} />
              <KpiCard label="Campaigns Sent" value={fmt(analytics.sentCampaigns)} icon={Mail} color="text-violet-400" empty={!hasEmail} delay={0.1} />
            </div>
            {!hasEmail && (
              <EmptySection message="Send email campaigns from the Email tab to see delivery and open rate stats." />
            )}
          </div>

          {/* ── Content Created ───────────────────────── */}
          <div className="mb-8">
            <SectionHeader icon={FileText} title="Content Created" />
            <div className="grid grid-cols-3 gap-3">
              <KpiCard label="Content Pieces" value={fmt(analytics.contentPieces)} icon={FileText} color="text-primary" empty={!analytics.contentPieces} delay={0} />
              <KpiCard label="Videos" value={fmt(analytics.videosCreated)} icon={Video} color="text-violet-400" empty={!analytics.videosCreated} delay={0.05} />
              <KpiCard label="Ad Creatives" value={fmt(analytics.adsGenerated)} icon={Megaphone} color="text-cyan-400" empty={!analytics.adsGenerated} delay={0.1} />
            </div>
          </div>

          {/* ── Activity Chart ────────────────────────── */}
          {analytics.chartData && analytics.chartData.length > 0 && (
            <div className="p-6 rounded-xl bg-card border border-border mb-8">
              <h2 className="font-bold mb-1 flex items-center gap-2 text-sm">
                <BarChart2 className="h-4 w-4 text-primary" />
                Content Activity — Last 30 Days
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Posts, content pieces, videos, and ad creatives created per day
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={analytics.chartData as Array<{ date: string; value: number }>}>
                  <defs>
                    <linearGradient id="colorActivity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#00E676" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#00E676" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "hsl(215 20.2% 65.1%)", fontSize: 10 }}
                    tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    interval={6}
                  />
                  <YAxis tick={{ fill: "hsl(215 20.2% 65.1%)", fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(222 47% 8%)", border: "1px solid hsl(217 33% 17%)", borderRadius: "8px", fontSize: "12px" }}
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                    formatter={(v: number) => [v, "Pieces created"]}
                  />
                  <Area type="monotone" dataKey="value" stroke="#00E676" fill="url(#colorActivity)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── AI Reports ───────────────────────────── */}
          <div>
            <h2 className="text-base font-bold mb-4 flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> AI Reports
            </h2>
            {reports && reports.length > 0 ? (
              <div className="space-y-3">
                {reports.map((report, i) => (
                  <motion.div
                    key={report.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="rounded-xl bg-card border border-border overflow-hidden"
                  >
                    <div className="p-5 flex items-start gap-4">
                      <FileText className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm capitalize">
                          {report.type} Report — {report.period}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {new Date(report.createdAt).toLocaleDateString()}
                        </div>
                        {report.summary && (
                          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{report.summary}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <a
                          href={`/api/projects/${projectId}/reports/${report.id}/pdf`}
                          download
                          className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          title="Download PDF"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                        <button
                          onClick={() => setExpandedReport(expandedReport === report.id ? null : report.id)}
                          className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {expandedReport === report.id
                            ? <ChevronUp className="h-4 w-4" />
                            : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    {expandedReport === report.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="border-t border-border px-5 py-4 space-y-4"
                      >
                        {report.summary && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Summary</div>
                            <p className="text-sm leading-relaxed">{report.summary}</p>
                          </div>
                        )}
                        {report.recommendations && (
                          <div>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recommendations</div>
                            <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans">{report.recommendations}</pre>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 rounded-xl border border-dashed border-border">
                <p className="text-muted-foreground text-sm">
                  No reports yet — click Generate Report to create your first AI performance report.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

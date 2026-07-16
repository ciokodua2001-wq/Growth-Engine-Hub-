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
import { Loader2, BarChart2, TrendingUp, Zap, FileText, ChevronDown, ChevronUp, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function ProjectAnalytics() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);
  const { data: analytics, isLoading } = useGetProjectAnalytics(projectId, { query: { queryKey: getGetProjectAnalyticsQueryKey(projectId), enabled: !!projectId } });
  const { data: reports } = useListReports(projectId, { query: { queryKey: getListReportsQueryKey(projectId), enabled: !!projectId } });
  const generateReport = useGenerateReport();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleGenerateReport = () => {
    generateReport.mutate(
      { id: projectId, data: { type: "performance", period: "monthly" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListReportsQueryKey(projectId) });
          toast({ title: "Report generated!" });
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  const kpis = analytics ? [
    { label: "Website Traffic", value: analytics.websiteTraffic?.toLocaleString() ?? "0", change: "+34%", color: "text-violet-400" },
    { label: "Leads Generated", value: analytics.leads?.toLocaleString() ?? "0", change: "+28%", color: "text-cyan-400" },
    { label: "Revenue", value: analytics.revenue ? `$${(analytics.revenue / 1000).toFixed(1)}K` : "$0", change: "+22%", color: "text-emerald-400" },
    { label: "ROAS", value: analytics.roas ? `${analytics.roas}x` : "0x", change: "+35%", color: "text-primary" },
  ] : [];

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Analytics & Reporting</h1>
          <p className="text-muted-foreground mt-1">Performance insights and AI-generated reports</p>
        </div>
        <button
          onClick={handleGenerateReport}
          disabled={generateReport.isPending}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
        >
          {generateReport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          Generate Report
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : analytics ? (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {kpis.map(({ label, value, change, color }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="p-5 rounded-xl bg-card border border-border"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />{change}
                  </span>
                </div>
                <div className={`text-3xl font-black ${color}`}>{value}</div>
              </motion.div>
            ))}
          </div>

          {/* Chart */}
          {analytics.chartData && (analytics.chartData as Array<{ date: string; value: number }>).length > 0 && (
            <div className="p-6 rounded-xl bg-card border border-border mb-8">
              <h2 className="font-bold mb-4 flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                Website Traffic (Last 30 Days)
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={analytics.chartData as Array<{ date: string; value: number }>}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(262 83% 58%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(262 83% 58%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 17%)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "hsl(215 20.2% 65.1%)", fontSize: 10 }}
                    tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    interval={6}
                  />
                  <YAxis tick={{ fill: "hsl(215 20.2% 65.1%)", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "hsl(222 47% 8%)", border: "1px solid hsl(217 33% 17%)", borderRadius: "8px", fontSize: "12px" }}
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                  />
                  <Area type="monotone" dataKey="value" stroke="hsl(262 83% 58%)" fill="url(#colorValue)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16 text-muted-foreground">No analytics data available yet.</div>
      )}

      {/* Reports */}
      <div>
        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" /> AI Reports
        </h2>
        {reports && reports.length > 0 ? (
          <div className="space-y-3">
            {reports.map((report, i) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="rounded-xl bg-card border border-border overflow-hidden"
              >
                <div className="p-5 flex items-start gap-4">
                  <FileText className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-bold text-sm capitalize">{report.type} Report — {report.period}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{new Date(report.createdAt).toLocaleDateString()}</div>
                    {report.summary && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{report.summary}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`/api/projects/${projectId}/reports/${report.id}/pdf`}
                      download
                      className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      title="Export as PDF"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => setExpandedReport(expandedReport === report.id ? null : report.id)}
                      className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {expandedReport === report.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {expandedReport === report.id && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="border-t border-border px-5 py-4 space-y-3">
                    {report.summary && <div><div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Summary</div><p className="text-sm text-foreground leading-relaxed">{report.summary}</p></div>}
                    {report.recommendations && <div><div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recommendations</div><pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans">{report.recommendations}</pre></div>}
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 rounded-xl border border-dashed border-border">
            <p className="text-muted-foreground text-sm">No reports yet — click Generate Report to create your first AI performance report.</p>
          </div>
        )}
      </div>
    </div>
  );
}

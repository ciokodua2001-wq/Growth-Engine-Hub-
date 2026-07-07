import { useParams } from "wouter";
import {
  useListCompetitors,
  useDiscoverCompetitors,
  useGetCompetitorReport,
  useGenerateCompetitorReport,
  getListCompetitorsQueryKey,
  getGetCompetitorReportQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Users2, TrendingUp, Globe, FileText, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function ScoreBar({ value, color }: { value: number | null; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value ?? 0}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{value ?? 0}</span>
    </div>
  );
}

export default function ProjectCompetitors() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const { data: competitors, isLoading } = useListCompetitors(projectId, { query: { enabled: !!projectId } });
  const { data: report } = useGetCompetitorReport(projectId, { query: { enabled: !!projectId } });
  const discoverCompetitors = useDiscoverCompetitors();
  const generateReport = useGenerateCompetitorReport();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDiscover = () => {
    discoverCompetitors.mutate(
      { id: projectId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCompetitorsQueryKey(projectId) });
          toast({ title: "Competitors discovered!" });
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  const handleGenerateReport = () => {
    generateReport.mutate(
      { id: projectId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCompetitorReportQueryKey(projectId) });
          toast({ title: "Competitor report generated!" });
        },
        onError: () => toast({ title: "Error", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Competitor Intelligence</h1>
          <p className="text-muted-foreground mt-1">AI-analyzed competitors with strategic insights and positioning opportunities</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleGenerateReport}
            disabled={generateReport.isPending}
            className="flex items-center gap-2 bg-secondary hover:bg-secondary/80 border border-border text-foreground font-bold px-4 py-2.5 rounded-xl text-sm transition-colors"
          >
            {generateReport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Generate Report
          </button>
          <button
            onClick={handleDiscover}
            disabled={discoverCompetitors.isPending}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 disabled:opacity-60 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            {discoverCompetitors.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {discoverCompetitors.isPending ? "Discovering..." : "Discover Competitors"}
          </button>
        </div>
      </div>

      {/* Competitor Report Summary */}
      {report && (report as { marketGaps?: string; positioningOpportunities?: string; winningHooks?: string }).marketGaps && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 p-6 rounded-xl bg-primary/5 border border-primary/20">
          <h2 className="font-bold mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Competitive Intelligence Report</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2 font-semibold">Market Gaps</div>
              <p className="text-foreground leading-relaxed">{(report as { marketGaps?: string }).marketGaps}</p>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2 font-semibold">Positioning Opportunities</div>
              <p className="text-foreground leading-relaxed">{(report as { positioningOpportunities?: string }).positioningOpportunities}</p>
            </div>
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wider mb-2 font-semibold">Winning Hooks</div>
              <p className="text-foreground leading-relaxed">{(report as { winningHooks?: string }).winningHooks}</p>
            </div>
          </div>
        </motion.div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : competitors && competitors.length > 0 ? (
        <div className="space-y-4">
          {competitors.map((competitor, i) => (
            <motion.div
              key={competitor.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="p-6 rounded-xl bg-card border border-border hover:border-border/80 transition-colors"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-bold text-lg">{competitor.name}</h3>
                  </div>
                  <a href={competitor.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{competitor.websiteUrl}</a>
                  {competitor.description && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{competitor.description}</p>}
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Hook Strength</div>
                  <ScoreBar value={competitor.hookStrength} color="bg-violet-500" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Conversion Potential</div>
                  <ScoreBar value={competitor.conversionPotential} color="bg-cyan-500" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wider">Differentiation Score</div>
                  <ScoreBar value={competitor.differentiationScore} color="bg-emerald-500" />
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4 text-xs">
                {competitor.strengths && (
                  <div>
                    <div className="text-emerald-400 font-semibold mb-1">Strengths</div>
                    <p className="text-muted-foreground leading-relaxed">{competitor.strengths}</p>
                  </div>
                )}
                {competitor.weaknesses && (
                  <div>
                    <div className="text-rose-400 font-semibold mb-1">Weaknesses</div>
                    <p className="text-muted-foreground leading-relaxed">{competitor.weaknesses}</p>
                  </div>
                )}
                {competitor.marketGaps && (
                  <div>
                    <div className="text-primary font-semibold mb-1">Market Gaps</div>
                    <p className="text-muted-foreground leading-relaxed">{competitor.marketGaps}</p>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Users2 className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Competitors Tracked Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Discover your top competitors and get strategic intelligence on their messaging, weaknesses, and market gaps.</p>
          <button onClick={handleDiscover} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Zap className="h-4 w-4" /> Discover Competitors
          </button>
        </div>
      )}
    </div>
  );
}

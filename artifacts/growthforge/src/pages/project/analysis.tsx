import { projectIdentityLabel } from "@/lib/projectIdentity";
import { useState } from "react";
import { useParams } from "wouter";
import {
  useGetBusinessAnalysis,
  useListPersonas,
  useAnalyzeWebsite,
  useGeneratePersonas,
  getGetBusinessAnalysisQueryKey,
  getListPersonasQueryKey,
  useGetProject,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Zap, Users2, Brain, Target, MessageCircle, TrendingUp, AlertTriangle } from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useTrialUsage } from "@/hooks/use-trial-usage";
import { isTrialPlan } from "@/lib/plan-access";

const ANALYZE_STEPS = [
  "Crawling website content...",
  "Extracting business intelligence...",
  "Identifying target customers...",
  "Mapping market opportunities...",
  "Generating strategic insights...",
];

const PERSONA_STEPS = [
  "Analyzing customer data...",
  "Building behavioral profiles...",
  "Mapping customer journeys...",
  "Identifying pain points & motivations...",
  "Finalizing persona profiles...",
];

function AnalysisCard({ title, content, icon: Icon }: { title: string; content: string | null | undefined; icon: React.ComponentType<{ className?: string }> }) {
  if (!content) return null;
  return (
    <div className="p-5 rounded-xl bg-card border border-border">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h3>
      </div>
      <p className="text-sm text-foreground leading-relaxed">{content}</p>
    </div>
  );
}


function fieldLabel(base: string, model?: string): string {
  if (model !== "creator" && model !== "hybrid") return base;
  const map: Record<string, string> = {
    "Business Summary": "Creator Overview",
    "Business Overview": "Creator Overview",
    "Customer Intelligence": "Audience Intelligence",
    "Customer Personas": "Audience Personas",
    "Industry": "Niche",
    "Products": "Digital Products / Merch",
    "Services": "Sponsorships / Services",
    "Unique Value Proposition": "Creator Value Proposition",
    "Brand Positioning": "Creator Positioning",
    "Target Customers": "Target Audience",
    "Ideal Customer Profile": "Ideal Audience / Brand Partner",
    "Customer Pain Points": "Audience Needs & Interests",
    "Customer Benefits": "Audience Value",
    "Purchase Triggers": "Engagement / Conversion Triggers",
    "Market Opportunities": "Audience Opportunities",
    "Growth Opportunities": "Creator Growth Opportunities",
  };
  return map[base] ?? base;
}

export default function ProjectAnalysis() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [analyzeModalOpen, setAnalyzeModalOpen] = useState(false);
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [sourceMismatch, setSourceMismatch] = useState<null | { url: string; warnings: string[]; details: { sourceType: string; sourceLabel: string; reason: string }[] }>(null);

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId } });
  const { data: analysis, isLoading } = useGetBusinessAnalysis(projectId, { query: { queryKey: getGetBusinessAnalysisQueryKey(projectId), enabled: !!projectId } });
  const { data: personas, isLoading: personasLoading } = useListPersonas(projectId, { query: { queryKey: getListPersonasQueryKey(projectId), enabled: !!projectId } });
  const analyzeWebsite = useAnalyzeWebsite();
  const generatePersonas = useGeneratePersonas();
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const { usage } = useTrialUsage(projectId);
  const isTrial = isTrialPlan(project?.plan, currentUser);
  const analysisLockedMessage = isTrial && usage && usage.analyses >= usage.limits.analyses
    ? "You've used your 1 website analysis included in the trial. Upgrade to re-analyze and keep building intelligence."
    : null;
  const personaLockedMessage = isTrial && usage && usage.personas >= usage.limits.personas
    ? "You've used both AI customer personas included in the trial. Upgrade to generate more."
    : null;

  const runAnalyze = (url: string, confirmSources: boolean): Promise<void> => {
    return new Promise((resolve, reject) => {
      analyzeWebsite.mutate(
        { id: projectId, data: { websiteUrl: url, confirmSources } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetBusinessAnalysisQueryKey(projectId) });
            setSourceMismatch(null);
            resolve();
          },
          onError: (err: unknown) => {
            const e = err as { status?: number; data?: { sourceMismatch?: { warnings?: string[]; details?: { sourceType: string; sourceLabel: string; reason: string }[] } } };
            if (e?.status === 409 && e?.data?.sourceMismatch) {
              setSourceMismatch({ url, warnings: e.data.sourceMismatch.warnings ?? [], details: e.data.sourceMismatch.details ?? [] });
              resolve();
            } else {
              reject(err);
            }
          },
        }
      );
    });
  };

  const handleAnalyze = (websiteUrl: string, _instructions: string): Promise<void> => {
    const url = websiteUrl || project?.websiteUrl || "";
    return runAnalyze(url, false);
  };

  const handleGeneratePersonas = (_websiteUrl: string, _instructions: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      generatePersonas.mutate(
        { id: projectId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPersonasQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Business Analysis</h1>
          <p className="text-muted-foreground mt-1">AI-powered intelligence about your business, customers, and market</p>
        </div>
        <button
          onClick={() => setAnalyzeModalOpen(true)}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl transition-colors text-sm"
        >
          <Zap className="h-4 w-4" />
          {analysis ? "Re-Analyze" : "Start Analysis"}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : analysis ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/10 border border-primary/20">
            <Brain className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">Analysis complete for {project ? projectIdentityLabel(project) : ""}</span>
            <span className="ml-auto text-xs text-primary bg-primary/20 px-2 py-1 rounded capitalize">{analysis.status}</span>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> {fieldLabel("Business Overview", project?.operatingModel)}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <AnalysisCard title={fieldLabel("Business Summary", project?.operatingModel)} content={analysis.businessSummary} icon={Brain} />
              <AnalysisCard title={fieldLabel("Industry", project?.operatingModel)} content={analysis.industry} icon={TrendingUp} />
              <AnalysisCard title={fieldLabel("Products", project?.operatingModel)} content={analysis.products} icon={Target} />
              <AnalysisCard title={fieldLabel("Services", project?.operatingModel)} content={analysis.services} icon={Target} />
              <AnalysisCard title={fieldLabel("Unique Value Proposition", project?.operatingModel)} content={analysis.uniqueValueProposition} icon={Zap} />
              <AnalysisCard title={fieldLabel("Brand Positioning", project?.operatingModel)} content={analysis.brandPositioning} icon={MessageCircle} />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Users2 className="h-5 w-5 text-cyan-400" /> {fieldLabel("Customer Intelligence", project?.operatingModel)}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <AnalysisCard title={fieldLabel("Target Customers", project?.operatingModel)} content={analysis.targetCustomers} icon={Users2} />
              <AnalysisCard title={fieldLabel("Ideal Customer Profile", project?.operatingModel)} content={analysis.idealCustomerProfile} icon={Target} />
              <AnalysisCard title={fieldLabel("Customer Pain Points", project?.operatingModel)} content={analysis.customerPainPoints} icon={MessageCircle} />
              <AnalysisCard title={fieldLabel("Customer Benefits", project?.operatingModel)} content={analysis.customerBenefits} icon={Zap} />
              <AnalysisCard title={fieldLabel("Purchase Triggers", project?.operatingModel)} content={analysis.purchaseTriggers} icon={TrendingUp} />
              <AnalysisCard title={fieldLabel("Brand Voice", project?.operatingModel)} content={analysis.brandVoice} icon={MessageCircle} />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-400" /> {fieldLabel("Market Opportunities", project?.operatingModel)}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <AnalysisCard title={fieldLabel("Market Opportunities", project?.operatingModel)} content={analysis.marketOpportunities} icon={TrendingUp} />
              <AnalysisCard title={fieldLabel("Growth Opportunities", project?.operatingModel)} content={analysis.growthOpportunities} icon={Zap} />
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Brain className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Analysis Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">
            {project?.operatingModel === "creator"
              ? "Run the AI analysis to extract creator intelligence from your sources."
              : project?.operatingModel === "hybrid"
              ? "Run the AI analysis to extract creator and business intelligence from your sources."
              : "Run the AI analysis to extract business intelligence from your website and sources."}
          </p>
          <button onClick={() => setAnalyzeModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Zap className="h-4 w-4" /> Start Analysis
          </button>
        </div>
      )}

      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Users2 className="h-6 w-6 text-cyan-400" /> {fieldLabel("Customer Personas", project?.operatingModel)}
          </h2>
          <button
            onClick={() => setPersonaModalOpen(true)}
            className="flex items-center gap-2 bg-secondary hover:bg-secondary/80 border border-border text-foreground font-bold px-4 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Users2 className="h-4 w-4" />
            Generate Personas
          </button>
        </div>

        {personasLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : personas && personas.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {personas.map((persona, i) => (
              <motion.div
                key={persona.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-6 rounded-xl bg-card border border-border"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center text-xl font-bold text-primary">
                    {persona.name.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold">{persona.name}</div>
                    <div className="text-xs text-muted-foreground">{persona.occupation}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {persona.age && <div className="text-xs"><span className="text-muted-foreground">Age:</span> <span>{persona.age}</span></div>}
                  {persona.income && <div className="text-xs"><span className="text-muted-foreground">Income:</span> <span>{persona.income}</span></div>}
                  {persona.motivations && (
                    <div className="text-xs mt-3">
                      <div className="text-muted-foreground font-medium mb-1">Motivations</div>
                      <p className="text-foreground leading-relaxed">{persona.motivations}</p>
                    </div>
                  )}
                  {persona.objections && (
                    <div className="text-xs mt-2">
                      <div className="text-muted-foreground font-medium mb-1">Objections</div>
                      <p className="text-foreground leading-relaxed">{persona.objections}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 rounded-xl border border-dashed border-border">
            <Users2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">No personas yet — click Generate Personas to create detailed customer profiles.</p>
          </div>
        )}
      </div>

      <GenerateModal
        isOpen={analyzeModalOpen}
        onClose={() => setAnalyzeModalOpen(false)}
        title={analysis ? "Re-Analyze Website" : "Start Business Analysis"}
        subtitle="AI will crawl your website and extract deep business intelligence"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Focus on SEO opportunities\n• Analyze competitor positioning\n• Deep dive into customer pain points\n• Map growth opportunities`}
        processingSteps={ANALYZE_STEPS}
        onSubmit={handleAnalyze}
        ctaLabel={analysis ? "Re-Analyze" : "Start Analysis"}
        lockedMessage={analysisLockedMessage}
      />

      <GenerateModal
        isOpen={personaModalOpen}
        onClose={() => setPersonaModalOpen(false)}
        title="Generate Customer Personas"
        subtitle="AI will build detailed behavioral profiles of your ideal customers"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Focus on B2B decision makers\n• Include millennial entrepreneurs\n• Target e-commerce store owners\n• Profile tech-savvy founders`}
        processingSteps={PERSONA_STEPS}
        onSubmit={handleGeneratePersonas}
        ctaLabel="Generate Personas"
        lockedMessage={personaLockedMessage}
      />

      {sourceMismatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-card border-border p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0" />
              <div>
                <h3 className="text-lg font-bold">Sources may belong to different businesses</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  GrowthForge detected that your website and connected social accounts may describe different businesses. Review before continuing — combining unrelated businesses will produce misleading intelligence.
                </p>
              </div>
            </div>
            {sourceMismatch.warnings.length > 0 && (
              <ul className="mt-4 space-y-2">
                {sourceMismatch.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-200/90 bg-amber-500/10 border-amber-500/20 rounded-lg px-3 py-2">{w}</li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setSourceMismatch(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => { runAnalyze(sourceMismatch.url, true).catch(() => {}); }}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90"
              >
                These are the same business — continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

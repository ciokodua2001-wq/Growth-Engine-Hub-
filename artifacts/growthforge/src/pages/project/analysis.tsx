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
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Zap, Users2, Brain, Target, MessageCircle, TrendingUp } from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

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

export default function ProjectAnalysis() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [analyzeModalOpen, setAnalyzeModalOpen] = useState(false);
  const [personaModalOpen, setPersonaModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: analysis, isLoading } = useGetBusinessAnalysis(projectId, { query: { enabled: !!projectId } });
  const { data: personas, isLoading: personasLoading } = useListPersonas(projectId, { query: { enabled: !!projectId } });
  const analyzeWebsite = useAnalyzeWebsite();
  const generatePersonas = useGeneratePersonas();
  const queryClient = useQueryClient();

  const handleAnalyze = (websiteUrl: string, _instructions: string): Promise<void> => {
    const url = websiteUrl || project?.websiteUrl || "";
    return new Promise((resolve, reject) => {
      analyzeWebsite.mutate(
        { id: projectId, data: { websiteUrl: url } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetBusinessAnalysisQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
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
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-8">
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
            <span className="text-sm font-medium">Analysis complete for {project?.websiteUrl}</span>
            <span className="ml-auto text-xs text-primary bg-primary/20 px-2 py-1 rounded capitalize">{analysis.status}</span>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Brain className="h-5 w-5 text-primary" /> Business Overview</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <AnalysisCard title="Business Summary" content={analysis.businessSummary} icon={Brain} />
              <AnalysisCard title="Industry" content={analysis.industry} icon={TrendingUp} />
              <AnalysisCard title="Products" content={analysis.products} icon={Target} />
              <AnalysisCard title="Services" content={analysis.services} icon={Target} />
              <AnalysisCard title="Unique Value Proposition" content={analysis.uniqueValueProposition} icon={Zap} />
              <AnalysisCard title="Brand Positioning" content={analysis.brandPositioning} icon={MessageCircle} />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Users2 className="h-5 w-5 text-cyan-400" /> Customer Intelligence</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <AnalysisCard title="Target Customers" content={analysis.targetCustomers} icon={Users2} />
              <AnalysisCard title="Ideal Customer Profile" content={analysis.idealCustomerProfile} icon={Target} />
              <AnalysisCard title="Customer Pain Points" content={analysis.customerPainPoints} icon={MessageCircle} />
              <AnalysisCard title="Customer Benefits" content={analysis.customerBenefits} icon={Zap} />
              <AnalysisCard title="Purchase Triggers" content={analysis.purchaseTriggers} icon={TrendingUp} />
              <AnalysisCard title="Brand Voice" content={analysis.brandVoice} icon={MessageCircle} />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-400" /> Market Opportunities</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <AnalysisCard title="Market Opportunities" content={analysis.marketOpportunities} icon={TrendingUp} />
              <AnalysisCard title="Growth Opportunities" content={analysis.growthOpportunities} icon={Zap} />
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Brain className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Analysis Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">Run the AI analysis to extract business intelligence from your website.</p>
          <button onClick={() => setAnalyzeModalOpen(true)} className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl">
            <Zap className="h-4 w-4" /> Start Analysis
          </button>
        </div>
      )}

      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Users2 className="h-6 w-6 text-cyan-400" /> Customer Personas
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
      />
    </div>
  );
}

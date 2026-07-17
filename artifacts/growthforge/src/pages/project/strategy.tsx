import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetMarketingStrategy,
  useGenerateMarketingStrategy,
  useGetProject,
  getGetProjectQueryKey,
  getGetMarketingStrategyQueryKey,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Megaphone, Zap, Target, MessageCircle,
  Globe, TrendingUp, Filter, Download, Bot,
} from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

const STRATEGY_STEPS = [
  "Analyzing brand positioning...",
  "Crafting messaging framework...",
  "Building SEO strategy...",
  "Designing conversion funnel...",
  "Finalizing marketing strategy...",
];

interface Subsection {
  label: string;
  body: string;
}

/**
 * Parses AI strategy text into structured sub-sections.
 * The AI consistently outputs ALL-CAPS labels (e.g. "PRIMARY PILLAR —", "CHANNEL 1 —",
 * "TONE:", "TOFU (Awareness):") followed by body text.
 */
function parseSubsections(text: string): Subsection[] {
  // Match: 2+ consecutive ALL-CAPS words (optionally with a trailing number and/or parens)
  // followed by — or :
  const re = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})*(?:\s+\d+)?(?:\s*\([^)]{1,100}\))?)\s*(?:—|:)\s*/g;

  const candidates: Array<{ index: number; end: number; label: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index).trim();
    const atStart = m.index === 0;
    const afterPeriod = /\.\s*$/.test(before);
    if (atStart || afterPeriod) {
      candidates.push({ index: m.index, end: m.index + m[0].length, label: m[1].trim() });
    }
  }

  if (candidates.length < 2) return [{ label: "", body: text.trim() }];

  const results: Subsection[] = [];

  if (candidates[0].index > 0) {
    const pre = text.slice(0, candidates[0].index).trim();
    if (pre) results.push({ label: "", body: pre });
  }

  for (let i = 0; i < candidates.length; i++) {
    const bodyEnd = candidates[i + 1]?.index ?? text.length;
    const body = text.slice(candidates[i].end, bodyEnd).trim();
    if (body) results.push({ label: candidates[i].label, body });
  }

  return results;
}

const LABEL_COLORS: Record<string, string> = {
  PRIMARY: "#00E676",
  SECONDARY: "#00D4FF",
  TERTIARY: "#14F195",
  CHANNEL: "#818cf8",
  TACTIC: "#fb923c",
  CLUSTER: "#f472b6",
  TOFU: "#34d399",
  MOFU: "#60a5fa",
  BOFU: "#a78bfa",
};

function labelColor(label: string): string {
  for (const [key, color] of Object.entries(LABEL_COLORS)) {
    if (label.startsWith(key)) return color;
  }
  return "#00D4FF";
}

function StrategyCard({
  title,
  content,
  icon: Icon,
  projectId,
  accentColor = "#00E676",
}: {
  title: string;
  content: string | null | undefined;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  projectId: number;
  accentColor?: string;
}) {
  if (!content) return null;
  const subsections = parseSubsections(content);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border overflow-hidden"
      style={{ background: "rgba(255,255,255,0.03)" }}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b border-border"
        style={{ background: "rgba(255,255,255,0.03)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `${accentColor}18` }}
          >
            <Icon className="h-4 w-4" style={{ color: accentColor }} />
          </div>
          <h3 className="font-bold text-sm text-white">{title}</h3>
        </div>
        <Link
          href={`/projects/${projectId}/agent`}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors"
          style={{
            background: "rgba(0,212,255,0.08)",
            color: "#00D4FF",
            border: "1px solid rgba(0,212,255,0.15)",
          }}
        >
          <Bot className="h-3 w-3" /> Ask AI
        </Link>
      </div>

      {/* Sub-sections */}
      <div className="px-5 py-4 space-y-4">
        {subsections.map((s, i) => (
          <div key={i} className={s.label ? "space-y-1.5" : ""}>
            {s.label && (
              <div
                className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase"
                style={{
                  background: `${labelColor(s.label)}14`,
                  color: labelColor(s.label),
                  border: `1px solid ${labelColor(s.label)}25`,
                }}
              >
                {s.label}
              </div>
            )}
            <p className="text-sm text-white/65 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function ProjectStrategy() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId },
  });
  const { data: strategy, isLoading } = useGetMarketingStrategy(projectId, {
    query: { queryKey: getGetMarketingStrategyQueryKey(projectId), enabled: !!projectId },
  });
  const generateStrategy = useGenerateMarketingStrategy();
  const queryClient = useQueryClient();

  const handleSubmit = (_websiteUrl: string, _instructions: string): Promise<void> =>
    new Promise((resolve, reject) => {
      generateStrategy.mutate(
        { id: projectId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetMarketingStrategyQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });

  const SECTIONS = [
    { key: "positioningStatement", title: "Positioning Statement", icon: Megaphone, accent: "#00E676", span: false },
    { key: "messagingFramework",   title: "Messaging Framework",   icon: MessageCircle, accent: "#00D4FF", span: false },
    { key: "brandVoiceGuide",      title: "Brand Voice Guide",     icon: MessageCircle, accent: "#14F195", span: false },
    { key: "seoStrategy",          title: "SEO Strategy",          icon: Globe,         accent: "#818cf8", span: false },
    { key: "campaignStrategy",     title: "Campaign Strategy",     icon: Target,        accent: "#fb923c", span: true  },
    { key: "leadGenerationStrategy", title: "Lead Generation Strategy", icon: TrendingUp, accent: "#f472b6", span: true },
    { key: "funnelRecommendations",  title: "Funnel Recommendations",  icon: Filter,     accent: "#60a5fa", span: true },
  ] as const;

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Marketing Strategy</h1>
          <p className="text-muted-foreground mt-1">AI-generated positioning, messaging, and growth strategy</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {strategy && (
            <>
              <Link
                href={`/projects/${projectId}/agent`}
                className="flex items-center gap-2 border border-border text-white/70 hover:text-white font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors"
                style={{ background: "rgba(0,212,255,0.07)" }}
              >
                <Bot className="h-4 w-4 text-[#00D4FF]" />
                Discuss with Forge AI
              </Link>
              <a
                href={`/api/projects/${projectId}/strategy/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-secondary hover:bg-secondary/80 border border-border text-foreground font-bold px-4 py-2.5 rounded-xl text-sm transition-colors"
              >
                <Download className="h-4 w-4" />
                Export PDF
              </a>
            </>
          )}
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            <Zap className="h-4 w-4" />
            {strategy ? "Re-Generate Strategy" : "Generate Strategy"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : strategy ? (
        <div className="grid md:grid-cols-2 gap-5">
          {SECTIONS.map(({ key, title, icon, accent, span }) => {
            const content = strategy[key as keyof typeof strategy] as string | null | undefined;
            return (
              <div key={key} className={span ? "md:col-span-2" : ""}>
                <StrategyCard
                  title={title}
                  content={content}
                  icon={icon}
                  projectId={projectId}
                  accentColor={accent}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <Megaphone className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Strategy Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">
            Generate your AI-powered marketing strategy with positioning, messaging, and growth recommendations.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl"
          >
            <Zap className="h-4 w-4" /> Generate Strategy
          </button>
        </div>
      )}

      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Generate Marketing Strategy"
        subtitle="AI will create your full positioning, messaging, and growth blueprint"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Focus on SaaS B2B positioning\n• Emphasize competitor differentiation\n• Target startup founders\n• Build aggressive growth funnel`}
        processingSteps={STRATEGY_STEPS}
        onSubmit={handleSubmit}
        ctaLabel={strategy ? "Re-Generate" : "Generate Strategy"}
      />
    </div>
  );
}

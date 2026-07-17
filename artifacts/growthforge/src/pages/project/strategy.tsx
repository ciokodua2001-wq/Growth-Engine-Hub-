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
  Globe, TrendingUp, Filter, Download, Bot, ExternalLink,
} from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

const SECTION_RESOURCES: Record<string, Array<{ name: string; url: string; description: string }>> = {
  positioningStatement: [
    { name: "Value Proposition Canvas", url: "https://www.strategyzer.com/canvas/value-proposition-canvas", description: "Design your positioning vs. customer needs" },
    { name: "Obviously Awesome", url: "https://www.aprildunford.com/obviously-awesome", description: "April Dunford's positioning framework" },
    { name: "HubSpot Positioning Templates", url: "https://offers.hubspot.com/brand-positioning-templates", description: "Free positioning worksheet" },
  ],
  messagingFramework: [
    { name: "StoryBrand", url: "https://storybrand.com/", description: "Clarify your brand message" },
    { name: "Copyhackers", url: "https://copyhackers.com/", description: "Conversion copywriting guides" },
    { name: "Swipe Files", url: "https://www.swipefiles.com/", description: "Best-in-class copy examples" },
  ],
  brandVoiceGuide: [
    { name: "Mailchimp Voice & Tone", url: "https://styleguide.mailchimp.com/voice-and-tone/", description: "Gold standard brand voice guide" },
    { name: "Grammarly Style Guide", url: "https://www.grammarly.com/business/learn/how-to-create-brand-style-guide/", description: "Build your content style guide" },
  ],
  seoStrategy: [
    { name: "Google Search Console", url: "https://search.google.com/search-console", description: "Monitor your search performance" },
    { name: "Ahrefs Free Tools", url: "https://ahrefs.com/free-seo-tools", description: "Keyword research & site audit" },
    { name: "Answer the Public", url: "https://answerthepublic.com/", description: "Questions your audience is searching" },
    { name: "Google Keyword Planner", url: "https://ads.google.com/home/tools/keyword-planner/", description: "Search volume & keyword ideas" },
  ],
  campaignStrategy: [
    { name: "Meta Ads Manager", url: "https://www.facebook.com/adsmanager", description: "Run Facebook & Instagram campaigns" },
    { name: "Meta Ads Library", url: "https://www.facebook.com/ads/library", description: "Research competitor creatives" },
    { name: "LinkedIn Campaign Manager", url: "https://www.linkedin.com/campaignmanager", description: "B2B audience targeting" },
    { name: "Reddit Ads", url: "https://ads.reddit.com/", description: "Reach niche communities" },
  ],
  leadGenerationStrategy: [
    { name: "HubSpot CRM (Free)", url: "https://www.hubspot.com/products/crm", description: "Track and manage leads" },
    { name: "Mailchimp", url: "https://mailchimp.com/", description: "Email list building & automation" },
    { name: "ConvertKit", url: "https://convertkit.com/", description: "Creator email marketing" },
    { name: "Hunter.io", url: "https://hunter.io/", description: "Find and verify business emails" },
  ],
  funnelRecommendations: [
    { name: "Google Analytics 4", url: "https://analytics.google.com/", description: "Track traffic and conversions" },
    { name: "Hotjar", url: "https://www.hotjar.com/", description: "Heatmaps & session recordings" },
    { name: "Microsoft Clarity", url: "https://clarity.microsoft.com/", description: "Free heatmaps (no limits)" },
    { name: "Mixpanel", url: "https://mixpanel.com/", description: "Product & funnel analytics" },
  ],
};

function ResourceChips({ resources }: { resources: Array<{ name: string; url: string; description: string }> }) {
  return (
    <div className="mt-4 pt-4 border-t border-white/[0.06]">
      <p className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-2.5">Tools & Resources</p>
      <div className="flex flex-wrap gap-1.5">
        {resources.map((r) => (
          <a
            key={r.name}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            title={r.description}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md transition-all hover:opacity-80"
            style={{
              background: "rgba(96,165,250,0.08)",
              color: "#60a5fa",
              border: "1px solid rgba(96,165,250,0.15)",
            }}
          >
            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
            {r.name}
          </a>
        ))}
      </div>
    </div>
  );
}

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
  resourceKey,
}: {
  title: string;
  content: string | null | undefined;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  projectId: number;
  accentColor?: string;
  resourceKey?: string;
}) {
  if (!content) return null;
  const subsections = parseSubsections(content);
  const resources = resourceKey ? SECTION_RESOURCES[resourceKey] : undefined;

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
        {resources && <ResourceChips resources={resources} />}
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

  type StrategyKey = "positioningStatement" | "messagingFramework" | "brandVoiceGuide" | "seoStrategy" | "campaignStrategy" | "leadGenerationStrategy" | "funnelRecommendations";
  const SECTIONS: Array<{
    key: StrategyKey;
    title: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    accent: string;
    span: boolean;
  }> = [
    { key: "positioningStatement",   title: "Positioning Statement",      icon: Megaphone,    accent: "#00E676", span: false },
    { key: "messagingFramework",     title: "Messaging Framework",        icon: MessageCircle,accent: "#00D4FF", span: false },
    { key: "brandVoiceGuide",        title: "Brand Voice Guide",          icon: MessageCircle,accent: "#14F195", span: false },
    { key: "seoStrategy",            title: "SEO Strategy",               icon: Globe,        accent: "#818cf8", span: false },
    { key: "campaignStrategy",       title: "Campaign Strategy",          icon: Target,       accent: "#fb923c", span: true  },
    { key: "leadGenerationStrategy", title: "Lead Generation Strategy",   icon: TrendingUp,   accent: "#f472b6", span: true  },
    { key: "funnelRecommendations",  title: "Funnel Recommendations",     icon: Filter,       accent: "#60a5fa", span: true  },
  ];

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
                  resourceKey={key}
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

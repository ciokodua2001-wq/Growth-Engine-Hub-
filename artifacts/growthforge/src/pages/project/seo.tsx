import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  SearchCheck, Zap, RefreshCw, ChevronDown, ChevronUp, Lock,
  Globe, Bot, TrendingUp, MapPin, Shield, Link, Lightbulb,
  AlertTriangle, CheckCircle2, Target, Calendar, Star, ExternalLink,
} from "lucide-react";
import { useGetProject } from "@workspace/api-client-react";

/* ─── Types ──────────────────────────────────────────────────── */

interface KeywordOpp {
  keyword: string; intent: string; difficulty: string; opportunity: string;
}
interface TopicCluster { pillar: string; spokes: string[]; }
interface LocalSeo { applicable: boolean; recommendations: string[]; }
interface RoadmapPhase { phase: string; theme: string; actions: string[]; }
interface PlatformGeo { chatgpt: string[]; perplexity: string[]; gemini: string[]; claude: string[]; }
interface GeoStrategy {
  readinessScore: number; readinessSummary: string;
  eatSignals: { expertise: string; authority: string; trustworthiness: string };
  contentStructureRecommendations: string[];
  aiCitationRecommendations: string[];
  platformSpecific: PlatformGeo;
  schemaMarkupPriorities: string[];
  faqOpportunities: string[];
}
interface TraditionalSeo {
  strengths: string[]; gaps: string[];
  keywordOpportunities: KeywordOpp[];
  contentGapAnalysis: string[];
  topicClusters: TopicCluster[];
  localSeo: LocalSeo;
  technicalChecklist: string[];
  linkBuildingOpportunities: string[];
}
interface Strategy {
  overallScore: number; summary: string; priorityActions: string[];
  traditionalSeo: TraditionalSeo; geoStrategy: GeoStrategy;
  competitorVisibility: { likelyGaps: string[]; opportunities: string[] };
  authorityBuilding: string[];
  ninetyDayRoadmap: RoadmapPhase[];
}
interface SeoStrategyRow { id: number; projectId: number; status: string; strategy: Strategy | null; errorMessage: string | null; createdAt: string; updatedAt: string; }

/* ─── Helpers ────────────────────────────────────────────────── */

const STEPS = [
  "Analyzing business context…",
  "Researching traditional SEO opportunities…",
  "Mapping keyword landscape…",
  "Building GEO strategy for AI search platforms…",
  "Generating 90-day roadmap…",
];

function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const color = score >= 70 ? "#00E676" : score >= 40 ? "#f59e0b" : "#ef4444";
  const sizes = { sm: "w-10 h-10 text-sm", md: "w-16 h-16 text-xl", lg: "w-20 h-20 text-2xl" };
  return (
    <div className={`${sizes[size]} rounded-full flex items-center justify-center font-black border-2`}
      style={{ borderColor: color, color, background: `${color}12` }}>
      {score}
    </div>
  );
}

function Section({ title, icon: Icon, color = "#00E676", children, defaultOpen = false }: {
  title: string; icon: React.FC<{ className?: string; style?: React.CSSProperties }>;
  color?: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <span className="text-white font-semibold text-sm">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-white/6">{children}</div>}
    </div>
  );
}

function Pill({ text, color }: { text: string; color?: string }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ background: color ? `${color}15` : "rgba(255,255,255,0.08)", color: color ?? "rgba(255,255,255,0.6)", border: `1px solid ${color ? `${color}25` : "rgba(255,255,255,0.1)"}` }}>
      {text}
    </span>
  );
}

function BulletList({ items, icon: Icon, color }: { items: string[]; icon?: React.FC<{ className?: string; style?: React.CSSProperties }>; color?: string }) {
  return (
    <ul className="space-y-2 mt-3">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm text-white/70">
          {Icon ? <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: color ?? "#00E676" }} /> : <span className="w-3.5 shrink-0 mt-0.5 text-center text-white/25 text-[10px]">·</span>}
          {item}
        </li>
      ))}
    </ul>
  );
}

const DIFFICULTY_COLORS: Record<string, string> = { low: "#00E676", medium: "#f59e0b", high: "#ef4444" };
const INTENT_COLORS: Record<string, string> = { transactional: "#00E676", commercial: "#00D4FF", informational: "#a78bfa", navigational: "#f59e0b" };

function PlatformCard({ platform, tips, logoChar, color }: { platform: string; tips: string[]; logoChar: string; color: string }) {
  return (
    <div className="rounded-xl p-4 space-y-2" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-black" style={{ background: `${color}20`, color }}>
          {logoChar}
        </div>
        <span className="text-white/70 text-sm font-semibold">{platform}</span>
      </div>
      {tips.map((tip, i) => (
        <p key={i} className="text-white/55 text-xs leading-relaxed pl-8">{tip}</p>
      ))}
    </div>
  );
}

/* ─── Generating state ───────────────────────────────────────── */

function GeneratingState() {
  const [step, setStep] = useState(0);
  useState(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => clearInterval(t);
  });
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <div className="relative">
        <div className="w-20 h-20 rounded-full border-2 border-[#00E676]/20 flex items-center justify-center">
          <SearchCheck className="w-8 h-8 text-[#00E676]" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-t-[#00E676] border-r-transparent border-b-transparent border-l-transparent animate-spin" />
      </div>
      <div className="text-center space-y-2">
        <p className="text-white font-bold text-lg">Building Your SEO Strategy</p>
        <AnimatePresence mode="wait">
          <motion.p key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="text-white/40 text-sm">
            {STEPS[step]}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="flex gap-1.5">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i <= step ? "w-6 bg-[#00E676]" : "w-1.5 bg-white/15"}`} />
        ))}
      </div>
      <p className="text-white/20 text-xs">This takes 20–30 seconds</p>
    </div>
  );
}

/* ─── Strategy display ───────────────────────────────────────── */

function StrategyDisplay({ data, onRegenerate, plan }: { data: SeoStrategyRow; onRegenerate: () => void; plan: string }) {
  const s = data.strategy as Strategy;
  const generatedAt = new Date(data.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-2xl border border-white/8 p-6" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-5">
            <ScoreBadge score={s.overallScore ?? 0} size="lg" />
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-white font-black text-xl">SEO Maturity Score</span>
                <Pill text={generatedAt} />
              </div>
              <p className="text-white/55 text-sm leading-relaxed max-w-xl">{s.summary}</p>
            </div>
          </div>
          <button onClick={onRegenerate}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white/40 border border-white/10 hover:text-white hover:border-white/30 transition-all shrink-0">
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate
          </button>
        </div>

        {/* Priority actions */}
        {s.priorityActions?.length > 0 && (
          <div className="mt-5 pt-5 border-t border-white/8">
            <p className="text-white/35 text-[10px] uppercase tracking-widest mb-3">Top Priority Actions</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {s.priorityActions.map((action, i) => (
                <div key={i} className="flex items-start gap-2.5 p-3 rounded-xl" style={{ background: "rgba(0,230,118,0.05)", border: "1px solid rgba(0,230,118,0.1)" }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5" style={{ background: "#00E676", color: "#000" }}>{i + 1}</span>
                  <span className="text-white/70 text-xs leading-relaxed">{action}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Traditional SEO */}
      <Section title="Traditional SEO (Google & Bing)" icon={Globe} color="#00E676" defaultOpen>
        {s.traditionalSeo && (
          <div className="space-y-5 mt-3">
            {/* Strengths + Gaps */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">Strengths</p>
                <BulletList items={s.traditionalSeo.strengths ?? []} icon={CheckCircle2} color="#00E676" />
              </div>
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">Gaps to Close</p>
                <BulletList items={s.traditionalSeo.gaps ?? []} icon={AlertTriangle} color="#f59e0b" />
              </div>
            </div>

            {/* Keywords */}
            {s.traditionalSeo.keywordOpportunities?.length > 0 && (
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">Keyword Opportunities</p>
                <div className="space-y-2">
                  {s.traditionalSeo.keywordOpportunities.map((kw, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-white font-semibold text-sm">{kw.keyword}</span>
                          <Pill text={kw.intent} color={INTENT_COLORS[kw.intent] ?? "#a78bfa"} />
                          <Pill text={kw.difficulty} color={DIFFICULTY_COLORS[kw.difficulty] ?? "#94a3b8"} />
                        </div>
                        <p className="text-white/45 text-xs">{kw.opportunity}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Topic Clusters */}
            {s.traditionalSeo.topicClusters?.length > 0 && (
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">Topic Clusters</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {s.traditionalSeo.topicClusters.map((tc, i) => (
                    <div key={i} className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <p className="text-white font-semibold text-sm mb-2 flex items-center gap-1.5">
                        <Star className="w-3 h-3 text-[#00E676]" /> {tc.pillar}
                      </p>
                      <ul className="space-y-1">
                        {tc.spokes?.map((s, j) => <li key={j} className="text-white/45 text-xs pl-4 border-l border-white/10">↳ {s}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Content gaps + Technical + Links */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">Content Gaps</p>
                <BulletList items={s.traditionalSeo.contentGapAnalysis ?? []} />
              </div>
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">Technical Checklist</p>
                <BulletList items={s.traditionalSeo.technicalChecklist ?? []} />
              </div>
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">Link Building</p>
                <BulletList items={s.traditionalSeo.linkBuildingOpportunities ?? []} icon={Link} color="#00D4FF" />
              </div>
            </div>

            {/* Local SEO */}
            {s.traditionalSeo.localSeo?.applicable && (
              <div className="p-4 rounded-xl" style={{ background: "rgba(20,241,149,0.05)", border: "1px solid rgba(20,241,149,0.1)" }}>
                <p className="text-[#14F195] font-semibold text-sm flex items-center gap-1.5 mb-2"><MapPin className="w-3.5 h-3.5" /> Local SEO Opportunities</p>
                <BulletList items={s.traditionalSeo.localSeo.recommendations} />
              </div>
            )}
          </div>
        )}
      </Section>

      {/* GEO Strategy */}
      <Section title="GEO — Generative Engine Optimization (AI Search)" icon={Bot} color="#00D4FF">
        {s.geoStrategy && (
          <div className="space-y-5 mt-3">
            {/* Readiness */}
            <div className="flex items-start gap-4 p-4 rounded-xl" style={{ background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.1)" }}>
              <ScoreBadge score={s.geoStrategy.readinessScore ?? 0} size="sm" />
              <div>
                <p className="text-[#00D4FF] font-semibold text-sm">AI Search Readiness Score</p>
                <p className="text-white/55 text-xs leading-relaxed mt-1">{s.geoStrategy.readinessSummary}</p>
              </div>
            </div>

            {/* E-E-A-T */}
            <div>
              <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">E-E-A-T Signals for AI Crawlers</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { key: "expertise", label: "Expertise", color: "#00E676" },
                  { key: "authority", label: "Authority", color: "#00D4FF" },
                  { key: "trustworthiness", label: "Trustworthiness", color: "#14F195" },
                ].map(({ key, label, color }) => (
                  <div key={key} className="p-3 rounded-xl" style={{ background: `${color}06`, border: `1px solid ${color}15` }}>
                    <p className="font-semibold text-xs mb-1" style={{ color }}>{label}</p>
                    <p className="text-white/50 text-xs leading-relaxed">
                      {(s.geoStrategy.eatSignals as Record<string, string>)?.[key]}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-platform */}
            <div>
              <p className="text-white/35 text-[10px] uppercase tracking-wider mb-2">Platform-Specific Optimization</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PlatformCard platform="ChatGPT / Bing AI" tips={s.geoStrategy.platformSpecific.chatgpt ?? []} logoChar="C" color="#00a67e" />
                <PlatformCard platform="Perplexity" tips={s.geoStrategy.platformSpecific.perplexity ?? []} logoChar="P" color="#a78bfa" />
                <PlatformCard platform="Google Gemini / AI Overviews" tips={s.geoStrategy.platformSpecific.gemini ?? []} logoChar="G" color="#4285f4" />
                <PlatformCard platform="Claude / Anthropic" tips={s.geoStrategy.platformSpecific.claude ?? []} logoChar="A" color="#c96442" />
              </div>
            </div>

            {/* Content + Citation + Schema + FAQ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">Content Structure</p>
                <BulletList items={s.geoStrategy.contentStructureRecommendations ?? []} />
              </div>
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">AI Citation Readiness</p>
                <BulletList items={s.geoStrategy.aiCitationRecommendations ?? []} icon={Target} color="#00D4FF" />
              </div>
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">Schema Markup Priorities</p>
                <BulletList items={s.geoStrategy.schemaMarkupPriorities ?? []} />
              </div>
              <div>
                <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">FAQ Opportunities</p>
                <BulletList items={s.geoStrategy.faqOpportunities ?? []} icon={Lightbulb} color="#f59e0b" />
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Competitor Visibility */}
      <Section title="Competitor Visibility" icon={TrendingUp} color="#f59e0b">
        {s.competitorVisibility && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            <div>
              <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">Likely Gaps vs Competitors</p>
              <BulletList items={s.competitorVisibility.likelyGaps ?? []} icon={AlertTriangle} color="#f59e0b" />
            </div>
            <div>
              <p className="text-white/35 text-[10px] uppercase tracking-wider mb-1">Outperformance Opportunities</p>
              <BulletList items={s.competitorVisibility.opportunities ?? []} icon={CheckCircle2} color="#00E676" />
            </div>
          </div>
        )}
      </Section>

      {/* Authority Building */}
      <Section title="Authority Building" icon={Shield} color="#14F195">
        <div className="mt-3">
          <BulletList items={s.authorityBuilding ?? []} icon={Star} color="#14F195" />
        </div>
      </Section>

      {/* 90-Day Roadmap */}
      <Section title="90-Day Action Roadmap" icon={Calendar} color="#a78bfa">
        {s.ninetyDayRoadmap && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
            {s.ninetyDayRoadmap.map((phase, i) => {
              const colors = ["#00E676", "#00D4FF", "#14F195"];
              const c = colors[i] ?? "#a78bfa";
              return (
                <div key={i} className="rounded-xl p-4" style={{ background: `${c}06`, border: `1px solid ${c}15` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: c, color: "#000" }}>{i + 1}</span>
                    <span className="text-xs font-bold" style={{ color: c }}>{phase.phase}</span>
                  </div>
                  <p className="text-white/60 font-semibold text-sm mb-2">{phase.theme}</p>
                  <ul className="space-y-1.5">
                    {phase.actions?.map((a, j) => (
                      <li key={j} className="text-white/50 text-xs leading-relaxed flex items-start gap-1.5">
                        <span className="shrink-0 mt-0.5" style={{ color: c }}>›</span> {a}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function ProjectSeo() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = parseInt(projectId ?? "", 10);
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  const { data: project } = useGetProject(id, { query: { enabled: !!id } });
  const plan = project?.plan ?? "trial";
  const isTrialOrMissing = plan === "trial";

  const { data, isLoading } = useQuery<SeoStrategyRow | null>({
    queryKey: ["/api/seo-strategy", id],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${id}/seo-strategy`, { credentials: "include" });
      if (!r.ok) return null;
      const j = await r.json();
      return j ?? null;
    },
    enabled: !!id,
    refetchInterval: (q) => q.state.data?.status === "generating" ? 3000 : false,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      setGenError("");
      setGenerating(true);
      const r = await fetch(`/api/projects/${id}/seo-strategy/generate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({ error: "Generation failed" }));
        throw new Error(e.error ?? "Generation failed");
      }
      return r.json();
    },
    onSuccess: (result) => {
      setGenerating(false);
      qc.setQueryData(["/api/seo-strategy", id], result);
      qc.invalidateQueries({ queryKey: ["/api/seo-strategy", id] });
    },
    onError: (err) => {
      setGenerating(false);
      setGenError(err instanceof Error ? err.message : "Generation failed");
    },
  });

  const isGenerating = generating || data?.status === "generating";

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <SearchCheck className="w-6 h-6 text-[#00E676]" />
            AI SEO Strategy Builder
          </h1>
          <p className="text-white/40 text-sm mt-1">
            Traditional search + AI-powered discovery platforms (ChatGPT, Perplexity, Gemini, Claude)
          </p>
        </div>
        {data?.status === "complete" && !isGenerating && (
          <a href="https://search.google.com/search-console/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-white/40 border border-white/10 hover:text-white hover:border-white/25 transition-all shrink-0">
            <ExternalLink className="w-3 h-3" /> Google Search Console
          </a>
        )}
      </div>

      {/* Trial gate */}
      {isTrialOrMissing && (
        <div className="rounded-2xl border border-white/10 p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center" style={{ background: "rgba(0,230,118,0.1)", border: "1px solid rgba(0,230,118,0.2)" }}>
            <Lock className="w-6 h-6 text-[#00E676]" />
          </div>
          <div>
            <p className="text-white font-bold text-lg">AI SEO Strategy Builder</p>
            <p className="text-white/40 text-sm mt-1 max-w-sm mx-auto">
              Included in all paid plans. Generate a comprehensive SEO strategy covering traditional search and AI discovery platforms.
            </p>
          </div>
          <a href="/plans" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black"
            style={{ background: "#00E676" }}>
            <Zap className="w-4 h-4" /> Upgrade to Unlock
          </a>
        </div>
      )}

      {/* Loading */}
      {!isTrialOrMissing && isLoading && (
        <div className="flex items-center justify-center py-20 gap-3 text-white/30">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading strategy…</span>
        </div>
      )}

      {/* Generating */}
      {!isTrialOrMissing && !isLoading && isGenerating && <GeneratingState />}

      {/* Empty state */}
      {!isTrialOrMissing && !isLoading && !isGenerating && !data && (
        <div className="rounded-2xl border border-white/8 p-12 text-center space-y-5" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center" style={{ background: "rgba(0,230,118,0.08)", border: "1px solid rgba(0,230,118,0.15)" }}>
            <SearchCheck className="w-7 h-7 text-[#00E676]" />
          </div>
          <div>
            <p className="text-white font-bold text-lg">No SEO Strategy Yet</p>
            <p className="text-white/40 text-sm mt-1 max-w-md mx-auto">
              Generate a complete SEO strategy covering keyword opportunities, topic clusters, competitor gaps, GEO recommendations for ChatGPT, Perplexity, Gemini, and Claude, plus a 90-day roadmap.
            </p>
          </div>
          {genError && (
            <div className="flex items-center gap-2 justify-center text-red-400 text-sm">
              <AlertTriangle className="w-4 h-4" /> {genError}
            </div>
          )}
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-black transition-all hover:scale-[1.02] disabled:opacity-50"
            style={{ background: "#00E676" }}>
            <Zap className="w-4 h-4" />
            {generateMutation.isPending ? "Generating…" : "Generate SEO Strategy"}
          </button>
          <p className="text-white/20 text-xs">Requires completed website analysis · Takes ~25 seconds</p>
        </div>
      )}

      {/* Failed state */}
      {!isTrialOrMissing && !isLoading && !isGenerating && data?.status === "failed" && (
        <div className="rounded-2xl border border-red-500/20 p-8 text-center space-y-4">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
          <div>
            <p className="text-white font-bold">Generation Failed</p>
            <p className="text-white/40 text-sm mt-1">{data.errorMessage ?? "An error occurred. Please try again."}</p>
          </div>
          <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-black"
            style={{ background: "#00E676" }}>
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
        </div>
      )}

      {/* Strategy display */}
      {!isTrialOrMissing && !isLoading && !isGenerating && data?.status === "complete" && data.strategy && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <StrategyDisplay data={data} onRegenerate={() => generateMutation.mutate()} plan={plan} />
        </motion.div>
      )}
    </div>
  );
}

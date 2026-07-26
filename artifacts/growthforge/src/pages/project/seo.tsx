import { useState } from "react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  SearchCheck, Zap, RefreshCw, ChevronDown, ChevronUp, Lock,
  Globe, Bot, TrendingUp, MapPin, Shield, Link as LinkIcon, Lightbulb,
  AlertTriangle, CheckCircle2, Target, Calendar, Star, ExternalLink,
  FileText, Code2, ListTree, Presentation, Copy, Trash2, Clock,
  Plus
} from "lucide-react";

import { 
  useGetProject, getGetProjectQueryKey,
  useListSeoBlogPosts, getListSeoBlogPostsQueryKey, useGenerateSeoBlogPost, useDeleteSeoBlogPost,
  useGetSeoMetaTags, getGetSeoMetaTagsQueryKey, useGenerateSeoMetaTags,
  useGetSeoSchema, getGetSeoSchemaQueryKey, useGenerateSeoSchema, useGenerateSeoSitemap,
  useGetSeoWatchdog, getGetSeoWatchdogQueryKey, useGenerateSeoWatchdog
} from "@workspace/api-client-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UpgradeModal } from "@/components/ui/upgrade-modal";
import { useCurrentUser } from "@/hooks/use-current-user";

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

function TrialGate({ featureName, description }: { featureName: string; description: string }) {
  return (
    <div className="rounded-2xl border border-white/10 p-8 text-center space-y-4 bg-white/5">
      <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center" style={{ background: "rgba(0,230,118,0.1)", border: "1px solid rgba(0,230,118,0.2)" }}>
        <Lock className="w-6 h-6 text-[#00E676]" />
      </div>
      <div>
        <p className="text-white font-bold text-lg">{featureName}</p>
        <p className="text-white/40 text-sm mt-1 max-w-sm mx-auto">{description}</p>
      </div>
      <a href="/plans" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black hover:scale-[1.02] transition-transform" style={{ background: "#00E676" }}>
        <Zap className="w-4 h-4" /> Upgrade to Unlock
      </a>
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
        <p className="text-white font-bold text-lg">Working on it…</p>
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
                <BulletList items={s.traditionalSeo.linkBuildingOpportunities ?? []} icon={LinkIcon} color="#00D4FF" />
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

/* ─── Markdown Parser for Blogs ──────────────────────────────── */

function SimpleMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-4 text-white/80 leading-relaxed text-sm">
      {lines.map((line, i) => {
        if (line.startsWith('# ')) return <h1 key={i} className="text-2xl font-bold text-white mt-8 mb-4">{parseInline(line.slice(2))}</h1>;
        if (line.startsWith('## ')) return <h2 key={i} className="text-xl font-bold text-white mt-8 mb-4">{parseInline(line.slice(3))}</h2>;
        if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-bold text-white mt-6 mb-3">{parseInline(line.slice(4))}</h3>;
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 list-disc marker:text-[#00E676]">{parseInline(line.slice(2))}</li>;
        if (line.match(/^\d+\. /)) return <li key={i} className="ml-4 list-decimal marker:text-[#00E676]">{parseInline(line.replace(/^\d+\. /, ''))}</li>;
        if (!line.trim()) return null;
        return <p key={i}>{parseInline(line)}</p>;
      })}
    </div>
  );
}

function parseInline(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

/* ─── Tabs Content Components ────────────────────────────────── */

function SeoStrategyTab({ projectId, plan }: { projectId: number; plan: string }) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  const isTrialOrMissing = plan === "trial";

  const { data, isLoading } = useQuery<SeoStrategyRow | null>({
    queryKey: ["/api/seo-strategy", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/seo-strategy`, { credentials: "include" });
      if (!r.ok) return null;
      const j = await r.json();
      return j ?? null;
    },
    enabled: !!projectId,
    refetchInterval: (q) => q.state.data?.status === "generating" ? 3000 : false,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      setGenError("");
      setGenerating(true);
      const r = await fetch(`/api/projects/${projectId}/seo-strategy/generate`, {
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
      qc.setQueryData(["/api/seo-strategy", projectId], result);
      qc.invalidateQueries({ queryKey: ["/api/seo-strategy", projectId] });
    },
    onError: (err) => {
      setGenerating(false);
      setGenError(err instanceof Error ? err.message : "Generation failed");
    },
  });

  const isGenerating = generating || data?.status === "generating";

  if (isTrialOrMissing) {
    return <TrialGate featureName="AI SEO Strategy Builder" description="Included in all paid plans. Generate a comprehensive SEO strategy covering traditional search and AI discovery platforms." />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-white/30">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span>Loading strategy…</span>
      </div>
    );
  }

  if (isGenerating) return <GeneratingState />;

  if (!data) {
    return (
      <div className="rounded-2xl border border-white/8 p-12 text-center space-y-5 bg-white/5">
        <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center bg-[#00E676]/10 border border-[#00E676]/20">
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
    );
  }

  if (data.status === "failed") {
    return (
      <div className="rounded-2xl border border-red-500/20 p-8 text-center space-y-4">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
        <div>
          <p className="text-white font-bold">Generation Failed</p>
          <p className="text-white/40 text-sm mt-1">{data.errorMessage ?? "An error occurred. Please try again."}</p>
        </div>
        <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-black bg-[#00E676]">
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
      </div>
    );
  }

  if (data.status === "complete" && data.strategy) {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <StrategyDisplay data={data} onRegenerate={() => generateMutation.mutate()} plan={plan} />
      </motion.div>
    );
  }

  return null;
}

function SeoBlogTab({ projectId, plan }: { projectId: number; plan: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: posts, isLoading } = useListSeoBlogPosts(projectId, { 
    query: { queryKey: getListSeoBlogPostsQueryKey(projectId), enabled: !!projectId }
  });

  const deleteMutation = useDeleteSeoBlogPost({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListSeoBlogPostsQueryKey(projectId) });
        toast({ description: "Blog post deleted." });
      }
    }
  });

  const generateMutation = useGenerateSeoBlogPost({
    mutation: {
      onSuccess: () => {
        setIsModalOpen(false);
        qc.invalidateQueries({ queryKey: getListSeoBlogPostsQueryKey(projectId) });
        toast({ description: "Blog post generated!" });
      },
      onError: (err) => {
        toast({ variant: "destructive", description: err.message });
      }
    }
  });

  const form = useForm({
    resolver: zodResolver(z.object({
      keyword: z.string().min(1, "Keyword is required"),
      tone: z.string().min(1)
    })),
    defaultValues: { keyword: "", tone: "professional" }
  });

  const onSubmit = (values: { keyword: string; tone: string }) => {
    generateMutation.mutate({ id: projectId, data: values });
  };

  const handleDelete = (postId: number) => {
    if (window.confirm("Are you sure you want to delete this blog post?")) {
      deleteMutation.mutate({ id: projectId, postId });
    }
  };

  if (plan === "trial") {
    return <TrialGate featureName="SEO Blog Post Generator" description="Generate complete, publication-ready SEO blog articles optimized for your exact keywords." />;
  }

  if (isLoading) return <div className="py-20 text-center text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={() => setIsModalOpen(true)} className="px-4 py-2 bg-[#00E676] text-black font-bold rounded-xl hover:scale-[1.02] transition-transform text-sm flex items-center gap-2 shadow-lg shadow-[#00E676]/20">
          <Plus className="w-4 h-4" /> Generate New Post
        </button>
      </div>

      {!posts || posts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-12 text-center bg-white/5">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center bg-[#00E676]/10 border border-[#00E676]/20 mb-4">
            <FileText className="w-7 h-7 text-[#00E676]" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No Blog Posts Yet</h3>
          <p className="text-white/50 text-sm max-w-md mx-auto mb-6">Our AI writers create 1,000+ word publication-ready SEO articles optimized for your exact keywords.</p>
          <button onClick={() => setIsModalOpen(true)} className="px-5 py-2.5 bg-[#00E676] text-black font-bold rounded-xl hover:scale-[1.02] transition-transform shadow-lg shadow-[#00E676]/20">
            Generate First Post
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post: any) => (
            <BlogCard key={post.id} post={post} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="bg-[#080f1e] border-white/10 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate New SEO Blog Post</DialogTitle>
            <DialogDescription className="text-white/50">
              Our AI will write a 1,000+ word publication-ready article optimized for your keyword.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
              <FormField control={form.control} name="keyword" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Target Keyword</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. business growth strategies" {...field} className="bg-black/50 border-white/10 focus-visible:ring-[#00E676]/50" />
                  </FormControl>
                  <FormMessage className="text-red-400" />
                </FormItem>
              )} />
              <FormField control={form.control} name="tone" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white/70">Tone of Voice</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="bg-black/50 border-white/10 focus-visible:ring-[#00E676]/50">
                        <SelectValue placeholder="Select tone" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-[#080f1e] border-white/10 text-white">
                      <SelectItem value="professional" className="hover:bg-white/10 cursor-pointer">Professional & Authoritative</SelectItem>
                      <SelectItem value="conversational" className="hover:bg-white/10 cursor-pointer">Conversational & Approachable</SelectItem>
                      <SelectItem value="friendly" className="hover:bg-white/10 cursor-pointer">Friendly & Enthusiastic</SelectItem>
                      <SelectItem value="provocative" className="hover:bg-white/10 cursor-pointer">Bold & Provocative</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-red-400" />
                </FormItem>
              )} />
              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-semibold text-white/50 hover:text-white">Cancel</button>
                <button type="submit" disabled={generateMutation.isPending} className="px-5 py-2 bg-[#00E676] text-black font-bold rounded-lg text-sm disabled:opacity-50 flex items-center gap-2">
                  {generateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Generate Post
                </button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BlogCard({ post, onDelete }: { post: any; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();
  
  const copyMeta = () => {
    navigator.clipboard.writeText(`Title: ${post.metaTitle}\nDescription: ${post.metaDescription}`);
    toast({ description: "Meta tags copied" });
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden transition-all">
      <div className="p-5 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-white mb-2 leading-tight">{post.title}</h3>
          <div className="flex items-center gap-3">
            <Pill text={post.keyword} color="#00E676" />
            <span className="text-xs font-semibold text-white/40 bg-white/5 px-2 py-1 rounded-md">{post.wordCount} words</span>
            <span className="text-xs font-semibold text-white/40 bg-white/5 px-2 py-1 rounded-md">{new Date(post.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded(!expanded)} className="px-4 py-2 rounded-lg bg-[#00E676]/10 text-[#00E676] text-xs font-bold hover:bg-[#00E676]/20 transition-colors border border-[#00E676]/20">
            {expanded ? "Close Article" : "View Article"}
          </button>
          <button onClick={() => onDelete(post.id)} className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-colors border border-red-500/20">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {expanded && (
        <div className="border-t border-white/10 bg-black/40 p-6 md:p-8 space-y-8">
          {post.metaTitle && (
            <div className="p-5 rounded-2xl border border-[#00D4FF]/20 bg-[#00D4FF]/5 flex justify-between items-start">
              <div>
                <p className="text-xs font-black text-[#00D4FF] uppercase tracking-wider mb-3">SEO Meta Tags</p>
                <p className="text-sm text-white/90 font-medium mb-1"><span className="text-white/40 mr-2 font-normal">Title:</span> {post.metaTitle}</p>
                <p className="text-sm text-white/70"><span className="text-white/40 mr-2 font-normal">Desc:</span> {post.metaDescription}</p>
              </div>
              <button onClick={copyMeta} className="text-white/40 hover:text-white bg-white/5 p-2 rounded-lg transition-colors"><Copy className="w-4 h-4" /></button>
            </div>
          )}
          <div className="prose prose-invert max-w-none">
            <SimpleMarkdown content={post.content} />
          </div>
        </div>
      )}
    </div>
  );
}

function SeoMetaTab({ projectId, plan }: { projectId: number; plan: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useGetSeoMetaTags(projectId, { 
    query: { queryKey: getGetSeoMetaTagsQueryKey(projectId), enabled: !!projectId }
  });
  
  const generateMutation = useGenerateSeoMetaTags({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetSeoMetaTagsQueryKey(projectId) });
        toast({ description: "Meta tags generated!" });
      },
      onError: (err) => {
        toast({ variant: "destructive", description: err.message });
      }
    }
  });

  if (plan === "trial") {
    return <TrialGate featureName="Meta Tags Generator" description="Generate SEO meta titles, descriptions, and Open Graph tags for all your pages. Upgrade to a paid plan." />;
  }

  if (isLoading) return <div className="py-20 text-center text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></div>;

  if (generateMutation.isPending) return <GeneratingState />;

  const pages = (data?.pages as unknown as any[]) || [];

  if (pages.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 p-12 text-center bg-white/5">
        <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center bg-[#00D4FF]/10 border border-[#00D4FF]/20 mb-4">
          <Code2 className="w-7 h-7 text-[#00D4FF]" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Generate Meta Tags</h3>
        <p className="text-white/50 text-sm max-w-md mx-auto mb-6">Automatically generate SEO-optimized title tags, meta descriptions, and Open Graph tags for all your core pages.</p>
        <button onClick={() => generateMutation.mutate({ id: projectId, data: {} })} className="px-5 py-2.5 bg-[#00D4FF] text-black font-bold rounded-xl hover:scale-[1.02] transition-transform flex items-center gap-2 mx-auto shadow-lg shadow-[#00D4FF]/20">
          <Zap className="w-4 h-4" /> Generate Meta Tags
        </button>
      </div>
    );
  }

  const copyAll = () => {
    const allSnippets = pages.map(p => `<!-- ${p.pageName} -->\n${p.htmlSnippet}`).join("\n\n");
    navigator.clipboard.writeText(allSnippets);
    toast({ description: "All meta tags copied!" });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-3">
        <button onClick={copyAll} className="px-4 py-2 bg-white/5 border border-white/10 text-white font-semibold rounded-xl hover:bg-white/10 transition-colors text-sm flex items-center gap-2">
          <Copy className="w-4 h-4" /> Copy All HTML
        </button>
        <button onClick={() => generateMutation.mutate({ id: projectId, data: {} })} className="px-4 py-2 bg-white/5 border border-white/10 text-white font-semibold rounded-xl hover:bg-white/10 transition-colors text-sm flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Regenerate Meta Tags
        </button>
      </div>
      <div className="space-y-4">
        {pages.map((p, i) => (
          <MetaTagCard key={i} page={p} />
        ))}
      </div>
    </div>
  );
}

function MetaTagCard({ page }: { page: any }) {
  const { toast } = useToast();
  const copyHtml = () => {
    navigator.clipboard.writeText(page.htmlSnippet || "");
    toast({ description: "HTML snippet copied!" });
  };

  const titleLength = (page.metaTitle || "").length;
  const descLength = (page.metaDescription || "").length;
  
  const titleColor = titleLength >= 50 && titleLength <= 60 ? "text-[#00E676]" : "text-yellow-500";
  const descColor = descLength >= 150 && descLength <= 160 ? "text-[#00E676]" : "text-yellow-500";

  return (
    <div className="p-6 rounded-2xl border border-white/10 bg-white/5 space-y-5">
      <div className="flex items-center justify-between pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-lg">{page.pageName}</span>
          <Pill text={page.pageType} color="#a78bfa" />
          {page.primaryKeyword && <Pill text={page.primaryKeyword} color="#00D4FF" />}
        </div>
        <button onClick={copyHtml} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors">
          <Copy className="w-3.5 h-3.5" /> Copy HTML Snippet
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-[11px] text-white/40 uppercase font-black tracking-wider">Meta Title</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded bg-black/40 ${titleColor}`}>{titleLength} chars</span>
          </div>
          <div className="p-4 bg-black/40 rounded-xl text-white/90 text-sm font-medium border border-white/5 shadow-inner">
            {page.metaTitle}
          </div>
        </div>
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-[11px] text-white/40 uppercase font-black tracking-wider">Meta Description</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded bg-black/40 ${descColor}`}>{descLength} chars</span>
          </div>
          <div className="p-4 bg-black/40 rounded-xl text-white/80 text-sm border border-white/5 shadow-inner leading-relaxed">
            {page.metaDescription}
          </div>
        </div>
        <div>
          <span className="text-[11px] text-white/40 uppercase font-black tracking-wider mb-2 block">OG Title</span>
          <div className="p-4 bg-black/40 rounded-xl text-white/90 text-sm font-medium border border-white/5 shadow-inner">
            {page.ogTitle}
          </div>
        </div>
        <div>
          <span className="text-[11px] text-white/40 uppercase font-black tracking-wider mb-2 block">OG Description</span>
          <div className="p-4 bg-black/40 rounded-xl text-white/80 text-sm border border-white/5 shadow-inner leading-relaxed">
            {page.ogDescription}
          </div>
        </div>
      </div>
    </div>
  );
}

function SeoSchemaSitemapTab({ projectId, plan }: { projectId: number; plan: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  
  const { data: schemaData, isLoading: schemaLoading } = useGetSeoSchema(projectId, {
    query: { queryKey: getGetSeoSchemaQueryKey(projectId), enabled: !!projectId }
  });
  
  const generateSchemaMutation = useGenerateSeoSchema({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetSeoSchemaQueryKey(projectId) });
        toast({ description: "Schema markup generated!" });
      },
      onError: (err) => {
        toast({ variant: "destructive", description: err.message });
      }
    }
  });
  
  const [sitemapData, setSitemapData] = useState<any>(null);
  const generateSitemapMutation = useGenerateSeoSitemap({
    mutation: {
      onSuccess: (data: any) => {
        setSitemapData(data);
        toast({ description: "Sitemap generated!" });
      },
      onError: (err) => {
        toast({ variant: "destructive", description: err.message });
      }
    }
  });

  if (plan === "trial") {
    return <TrialGate featureName="Schema & Sitemap Generator" description="Generate JSON-LD schema markup and XML sitemaps to help search engines understand your site." />;
  }
  
  const schemas = (schemaData?.schemas as unknown as any[]) || [];

  return (
    <div className="space-y-12">
      {/* Schema Section */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><ListTree className="w-5 h-5 text-[#14F195]" /> Schema Markup</h2>
            <p className="text-white/50 text-sm mt-1">Rich JSON-LD snippets for your website head.</p>
          </div>
          {schemas.length > 0 && (
            <button onClick={() => generateSchemaMutation.mutate({ id: projectId })} disabled={generateSchemaMutation.isPending} className="px-4 py-2 bg-white/5 border border-white/10 text-white font-semibold rounded-xl hover:bg-white/10 transition-colors text-sm flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Regenerate Schema
            </button>
          )}
        </div>

        {schemaLoading ? (
          <div className="py-20 text-center text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></div>
        ) : generateSchemaMutation.isPending ? (
          <GeneratingState />
        ) : schemas.length === 0 ? (
          <div className="rounded-2xl border border-white/10 p-12 text-center bg-white/5">
            <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center bg-[#14F195]/10 border border-[#14F195]/20 mb-4">
              <ListTree className="w-7 h-7 text-[#14F195]" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Generate Schema Markup</h3>
            <p className="text-white/50 text-sm max-w-md mx-auto mb-6">Create rich JSON-LD schema snippets to help search engines understand your business identity and offerings.</p>
            <button onClick={() => generateSchemaMutation.mutate({ id: projectId })} className="px-5 py-2.5 bg-[#14F195] text-black font-bold rounded-xl hover:scale-[1.02] transition-transform flex items-center gap-2 mx-auto shadow-lg shadow-[#14F195]/20">
               <Zap className="w-4 h-4" /> Generate Schema
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {schemas.map((s, i) => (
              <SchemaCard key={i} schema={s} />
            ))}
          </div>
        )}
      </div>

      {/* Sitemap Section */}
      <div className="pt-12 border-t border-white/10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><Globe className="w-5 h-5 text-[#00E676]" /> XML Sitemap Generator</h2>
            <p className="text-white/50 text-sm mt-1">Generate a structured XML sitemap to submit to Google and Bing.</p>
          </div>
          <button onClick={() => generateSitemapMutation.mutate({ id: projectId })} disabled={generateSitemapMutation.isPending} className="px-4 py-2 bg-[#00E676]/10 border border-[#00E676]/20 text-[#00E676] font-bold rounded-xl hover:bg-[#00E676]/20 transition-colors text-sm flex items-center gap-2">
            {generateSitemapMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : sitemapData ? "Regenerate Sitemap" : "Generate Sitemap.xml"}
          </button>
        </div>
        
        {generateSitemapMutation.isPending && <GeneratingState />}
        
        {sitemapData && !generateSitemapMutation.isPending && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 text-sm text-white/70 bg-white/5 p-4 rounded-xl border border-white/10 shadow-inner">
              <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-[#00D4FF]" /> <strong className="text-white">{sitemapData.pageCount}</strong> Pages indexed</div>
              <div className="w-1 h-1 rounded-full bg-white/20" />
              <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-[#14F195]" /> Generated today</div>
            </div>

            {/* Sitemap URL — this is what you submit to Google/Bing */}
            {sitemapData.sitemapUrl && (
              <div className="p-5 rounded-2xl border border-[#00E676]/30 bg-[#00E676]/5">
                <p className="text-[#00E676] font-black text-xs uppercase tracking-wider mb-3 flex items-center gap-2">
                  <SearchCheck className="w-4 h-4" /> Your Sitemap URL — Submit This to Google &amp; Bing
                </p>
                <div className="flex items-center gap-3">
                  <code className="flex-1 text-white font-mono text-sm bg-black/40 px-4 py-3 rounded-xl border border-white/10 truncate">
                    {sitemapData.sitemapUrl}
                  </code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(sitemapData.sitemapUrl); toast({ description: "Sitemap URL copied!" }); }}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#00E676]/15 hover:bg-[#00E676]/25 border border-[#00E676]/30 text-[#00E676] font-bold text-sm transition-colors whitespace-nowrap"
                  >
                    <Copy className="w-4 h-4" /> Copy URL
                  </button>
                </div>
                <p className="text-white/40 text-xs mt-3">Paste this URL (not the XML) into Google Search Console → Sitemaps → Add new sitemap.</p>
              </div>
            )}
            
            <div className="rounded-2xl border border-white/10 bg-black/60 overflow-hidden relative group shadow-2xl">
              <button onClick={() => { navigator.clipboard.writeText(sitemapData.xml); toast({description: "Sitemap XML copied"}); }} className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold backdrop-blur-sm transition-colors border border-white/10">
                <Copy className="w-3.5 h-3.5" /> Copy XML
              </button>
              <pre className="p-6 overflow-x-auto text-xs text-[#00D4FF] font-mono leading-relaxed h-96">
                <code>{sitemapData.xml}</code>
              </pre>
            </div>
            
            <div className="p-6 rounded-2xl border border-white/10 bg-white/5">
              <p className="text-sm font-black text-white uppercase tracking-wider mb-5">Submission Instructions</p>
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-black/40 border border-[#00E676]/20 border-l-4 border-l-[#00E676]">
                  <p className="text-[#00E676] font-bold text-sm mb-2 flex items-center gap-2"><SearchCheck className="w-4 h-4" /> Google Search Console</p>
                  <p className="text-white/70 text-sm leading-relaxed">Go to <strong className="text-white">Google Search Console → Sitemaps → Add new sitemap</strong>. Paste the sitemap URL above (not the XML). Click Submit.</p>
                </div>
                <div className="p-4 rounded-xl bg-black/40 border border-[#00D4FF]/20 border-l-4 border-l-[#00D4FF]">
                  <p className="text-[#00D4FF] font-bold text-sm mb-2 flex items-center gap-2"><Globe className="w-4 h-4" /> Bing Webmaster Tools</p>
                  <p className="text-white/70 text-sm leading-relaxed">Go to <strong className="text-white">Bing Webmaster Tools → Sitemaps → Submit sitemap</strong>. Paste the sitemap URL above. Click Submit.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SchemaCard({ schema }: { schema: any }) {
  const { toast } = useToast();
  const copyJson = () => {
    navigator.clipboard.writeText(schema.jsonLd || "");
    toast({ description: "JSON-LD Copied" });
  };
  
  const priorityColor = schema.priority === "essential" ? "#00E676" : schema.priority === "recommended" ? "#00D4FF" : "#94a3b8";
  
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden shadow-lg">
      <div className="p-6 flex items-start justify-between border-b border-white/5 bg-white/[0.02]">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-white font-bold text-lg tracking-tight">{schema.type || "Schema"}</span>
            <Pill text={(schema.priority || "optional").toUpperCase()} color={priorityColor} />
          </div>
          <p className="text-white/60 text-sm leading-relaxed max-w-2xl">{schema.description}</p>
        </div>
        <button onClick={copyJson} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors border border-white/10">
          <Copy className="w-3.5 h-3.5" /> Copy Code
        </button>
      </div>
      <div className="p-0 bg-black/60 border-b border-white/5">
        <pre className="p-6 overflow-x-auto text-xs text-[#14F195] font-mono leading-relaxed max-h-60">
          <code>{schema.jsonLd}</code>
        </pre>
      </div>
      <div className="p-6 bg-white/[0.02]">
        <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-4">Installation Guide</p>
        <Tabs defaultValue="wordpress" className="w-full">
          <TabsList className="bg-black/40 border border-white/10 rounded-lg p-1 w-full justify-start h-auto flex-wrap">
            <TabsTrigger value="wordpress" className="text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white h-8">WordPress</TabsTrigger>
            <TabsTrigger value="shopify" className="text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white h-8">Shopify</TabsTrigger>
            <TabsTrigger value="squarespace" className="text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white h-8">Squarespace</TabsTrigger>
            <TabsTrigger value="wix" className="text-xs data-[state=active]:bg-white/10 data-[state=active]:text-white h-8">Wix</TabsTrigger>
          </TabsList>
          {["wordpress", "shopify", "squarespace", "wix"].map((platform) => (
            <TabsContent key={platform} value={platform} className="mt-4 p-5 rounded-xl bg-black/30 border border-white/5 text-sm text-white/80 leading-relaxed font-medium">
              {schema.platforms?.[platform] || "No instructions provided for this platform."}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

function SeoCoachTab({ projectId, plan }: { projectId: number; plan: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  
  const { data, isLoading } = useGetSeoWatchdog(projectId, {
    query: { queryKey: getGetSeoWatchdogQueryKey(projectId), enabled: !!projectId }
  });
  
  const [showUpgrade, setShowUpgrade] = useState(false);
  
  const generateMutation = useGenerateSeoWatchdog({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetSeoWatchdogQueryKey(projectId) });
        toast({ description: "New coaching plan generated!" });
      },
      onError: (err) => {
        if (err.message?.toLowerCase().includes("requires a paid plan") || err.message?.toLowerCase().includes("quota")) {
          setShowUpgrade(true);
        } else {
          toast({ variant: "destructive", description: err.message });
        }
      }
    }
  });

  const handleGenerate = () => {
    if (plan === "trial" && data) {
      setShowUpgrade(true);
      return;
    }
    generateMutation.mutate({ id: projectId });
  };

  if (isLoading) return <div className="py-20 text-center text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></div>;

  if (generateMutation.isPending) return <GeneratingState />;

  if (!data) {
    return (
      <div className="rounded-2xl border border-white/10 p-12 text-center bg-white/5 shadow-2xl">
        <div className="w-20 h-20 rounded-3xl mx-auto flex items-center justify-center bg-[#00D4FF]/10 border border-[#00D4FF]/20 mb-6 shadow-lg shadow-[#00D4FF]/10">
          <Presentation className="w-10 h-10 text-[#00D4FF]" />
        </div>
        <h3 className="text-2xl font-black text-white mb-3">Start Your First SEO Coaching Session</h3>
        <p className="text-white/50 text-sm max-w-md mx-auto mb-8 leading-relaxed">Get a weekly actionable checklist from your personal AI SEO coach based on your exact business context and progress.</p>
        <button onClick={handleGenerate} className="px-6 py-3 bg-[#00D4FF] text-black font-bold rounded-xl hover:scale-[1.02] transition-transform flex items-center gap-2 mx-auto shadow-lg shadow-[#00D4FF]/20">
          <Zap className="w-4 h-4" /> Get Coaching Plan
        </button>
        <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} feature="SEO Coaching Sessions" />
      </div>
    );
  }

  const actions = (data.actions as unknown as any[]) || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-end mb-6">
        <button onClick={handleGenerate} className="px-4 py-2 bg-white/5 border border-white/10 text-white font-semibold rounded-xl hover:bg-white/10 transition-colors text-sm flex items-center gap-2 shadow-sm">
          <RefreshCw className="w-4 h-4" /> Get Fresh Coaching
        </button>
      </div>

      {plan === "trial" && (
        <div className="p-4 rounded-xl bg-[#00E676]/10 border border-[#00E676]/20 flex items-start gap-3 mb-6">
          <Zap className="w-5 h-5 text-[#00E676] shrink-0" />
          <div>
            <p className="text-sm font-bold text-[#00E676]">Free Trial Session</p>
            <p className="text-xs text-[#00E676]/70 mt-1">You get 1 free AI SEO Coaching session on your trial plan. Upgrade to receive weekly tailored action plans.</p>
          </div>
        </div>
      )}

      {/* Top Card */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-8 md:p-10 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#00D4FF]/10 blur-[100px] rounded-full pointer-events-none" />
        <p className="text-[#00D4FF] font-black text-xs uppercase tracking-widest mb-3">{data.weekOf}</p>
        <h2 className="text-3xl md:text-4xl font-black text-white mb-4 tracking-tight leading-tight max-w-3xl">{data.headline}</h2>
        <p className="text-white/70 text-base md:text-lg leading-relaxed max-w-4xl font-medium">{data.summary}</p>
        {data.progressNote && (
          <div className="mt-6 inline-flex items-center gap-3 px-4 py-2 rounded-xl bg-[#00E676]/10 border border-[#00E676]/20 text-sm font-semibold text-[#00E676]">
            <TrendingUp className="w-4 h-4" /> {data.progressNote}
          </div>
        )}
      </div>

      {/* Action Items */}
      <div className="space-y-4 pt-4">
        <h3 className="text-lg font-bold text-white mb-2 px-2 text-white/50">Your Actions for the Week</h3>
        {actions.map((action, i) => (
          <div key={i} className="p-6 md:p-8 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors relative overflow-hidden group">
            {action.priority === "CRITICAL" && (
               <div className="absolute top-0 left-0 w-1 h-full bg-red-500" />
            )}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                {action.priority === "CRITICAL" ? <Pill text="CRITICAL" color="#ef4444" /> : action.priority === "HIGH" ? <Pill text="HIGH PRIORITY" color="#f59e0b" /> : <Pill text="MEDIUM PRIORITY" color="#94a3b8" />}
                <Pill text={action.category} color="#00D4FF" />
              </div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white/40 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
                <Clock className="w-3.5 h-3.5" /> {action.estimatedTime}
              </div>
            </div>
            <h3 className="text-xl font-bold text-white mb-3 tracking-tight">{action.title}</h3>
            <p className="text-white/60 text-sm mb-6 leading-relaxed max-w-4xl">{action.why}</p>
            
            <div className="bg-black/50 rounded-xl p-6 border border-white/5 shadow-inner">
              <h4 className="text-[11px] font-black text-white/30 uppercase tracking-widest mb-4">How to execute</h4>
              <ul className="space-y-4">
                {action.how?.map((step: string, j: number) => (
                  <li key={j} className="flex gap-4 text-sm text-white/80 items-start">
                    <span className="w-6 h-6 shrink-0 rounded-full bg-white/10 text-white flex items-center justify-center text-xs font-black shadow-sm mt-0">{j+1}</span>
                    <span className="leading-relaxed pt-0.5">{step}</span>
                  </li>
                ))}
              </ul>
            </div>
            
            {action.expectedResult && (
              <div className="mt-6 flex items-center gap-2.5 text-sm font-semibold text-[#14F195] bg-[#14F195]/5 px-4 py-3 rounded-xl border border-[#14F195]/10 inline-flex">
                <CheckCircle2 className="w-4 h-4" /> <span className="text-white/40 font-normal mr-1">Expected:</span> {action.expectedResult}
              </div>
            )}
          </div>
        ))}
      </div>

      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} feature="SEO Coaching Sessions" />
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function ProjectSeo() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = parseInt(projectId ?? "", 10);
  
  const [, setLocation] = useLocation();
  const search = useSearch();
  const currentTab = new URLSearchParams(search).get("tab") || "strategy";

  const { data: project } = useGetProject(id, { query: { queryKey: getGetProjectQueryKey(id), enabled: !!id } });
  const { data: currentUserData } = useCurrentUser();
  const isOwner = currentUserData?.isOwner ?? false;
  const plan = isOwner ? "pro" : (project?.plan ?? "trial");

  const handleTabChange = (tab: string) => {
    setLocation(`${window.location.pathname}?tab=${tab}`);
  };

  const TABS = [
    { id: "strategy", label: "Strategy", icon: Target },
    { id: "blog", label: "Blog Posts", icon: FileText },
    { id: "meta", label: "Meta Tags", icon: Code2 },
    { id: "schema", label: "Schema & Sitemap", icon: ListTree },
    { id: "coach", label: "SEO Coach", icon: Presentation },
  ];

  return (
    <div className="p-6 md:p-8 space-y-8 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight flex items-center gap-3">
            <SearchCheck className="w-8 h-8 text-[#00E676]" />
            AI SEO War Room
          </h1>
          <p className="text-white/50 text-sm mt-2 font-medium">
            Dominate traditional search and AI discovery engines (ChatGPT, Perplexity, Gemini).
          </p>
        </div>
        <a href="https://search.google.com/search-console/" target="_blank" rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white/50 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-all shadow-sm">
          <ExternalLink className="w-3.5 h-3.5" /> Google Search Console
        </a>
      </div>

      {/* Tabbed interface */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full">
        <div className="overflow-x-auto pb-2 scrollbar-none">
          <TabsList className="bg-black/40 border border-white/10 p-1.5 rounded-2xl flex gap-1.5 w-full shadow-inner">
            {TABS.map(t => (
              <TabsTrigger 
                key={t.id} 
                value={t.id}
                className="flex-1 rounded-xl data-[state=active]:bg-[#00E676]/15 data-[state=active]:text-[#00E676] text-white/50 px-2 py-2.5 text-xs sm:text-sm font-bold transition-all data-[state=active]:border data-[state=active]:border-[#00E676]/30 border border-transparent whitespace-nowrap data-[state=active]:shadow-[0_0_15px_rgba(0,230,118,0.1)] flex items-center justify-center gap-1.5"
              >
                <t.icon className="w-3.5 h-3.5 shrink-0" /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="mt-8">
          <TabsContent value="strategy" className="mt-0 outline-none"><SeoStrategyTab projectId={id} plan={plan} /></TabsContent>
          <TabsContent value="blog" className="mt-0 outline-none"><SeoBlogTab projectId={id} plan={plan} /></TabsContent>
          <TabsContent value="meta" className="mt-0 outline-none"><SeoMetaTab projectId={id} plan={plan} /></TabsContent>
          <TabsContent value="schema" className="mt-0 outline-none"><SeoSchemaSitemapTab projectId={id} plan={plan} /></TabsContent>
          <TabsContent value="coach" className="mt-0 outline-none"><SeoCoachTab projectId={id} plan={plan} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

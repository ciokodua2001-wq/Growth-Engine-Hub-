import { useState, useEffect } from "react";
import { useParams } from "wouter";
import {
  useListVideos,
  useGenerateVideos,
  useGetProject,
  useStartVideoRender,
  useGetVideoRenderStatus,
  useGenerateImage,
  useGetProjectUsage,
  getListVideosQueryKey,
  getGetVideoRenderStatusQueryKey,
  getGetProjectQueryKey,
  ImageGenerateInputStyle,
  ImageGenerateInputOrientation,
} from "@workspace/api-client-react";
import type { Video as VideoModel } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Video as VideoIcon, Play, Sparkles, Film, Check, X,
  AlertCircle, ChevronDown, Image as ImageIcon, RefreshCw,
  Lock, Download, ExternalLink,
  Search, Filter, Clock, Archive, BarChart3, RotateCcw,
} from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";
import CommercialProductionProgress from "@/components/ui/commercial-progress";
import VideoWalletWidget from "@/components/video-wallet-widget";

// ── Cinematic Plan types ──────────────────────────────────────────────────────
type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

interface CinematicShot {
  shotNumber: number;
  duration: number;
  dialogue: string; // exact words actor speaks in this shot
  environment: string;
  subjectAction: string;
  facialExpression: string;
  bodyMovement: string;
  cameraMovement: string;
  lensStyle: string;
  lighting: string;
  visualEffects: string;
  transition: string;
}

interface CinematicPlan {
  visualStyle: string;
  characterDescription: string;
  environment: string;
  lighting: string;
  cameraLanguage: string;
  performanceDirection: string;
  shots: CinematicShot[];
  textOverlayPlacement: string;
  finalHeroShot: string;
}

function parseCinematicPlan(json: string | null | undefined): CinematicPlan | null {
  if (!json) return null;
  try { return JSON.parse(json) as CinematicPlan; } catch { return null; }
}

// ── Cinematic Blueprint Viewer ────────────────────────────────────────────────
function CinematicBlueprintViewer({ plan, script }: { plan: CinematicPlan; script?: string | null }) {
  return (
    <div className="mt-4 pt-4 border-t border-border space-y-4">
      {/* Production Brief */}
      <div className="rounded-xl bg-white/2 border border-white/8 p-3 space-y-3">
        <p className="text-[10px] font-black text-[#00E676] uppercase tracking-widest">Production Brief</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {([
            ["Visual Style", plan.visualStyle],
            ["Environment", plan.environment],
            ["Lighting", plan.lighting],
            ["Camera Language", plan.cameraLanguage],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label}>
              <p className="text-[9px] font-semibold text-white/30 uppercase tracking-wider">{label}</p>
              <p className="text-[11px] text-white/70 mt-0.5 leading-snug">{value}</p>
            </div>
          ))}
        </div>
        {plan.characterDescription && (
          <div className="pt-2.5 border-t border-white/6">
            <p className="text-[9px] font-semibold text-white/30 uppercase tracking-wider">Character</p>
            <p className="text-[11px] text-white/70 mt-0.5 leading-snug">{plan.characterDescription}</p>
          </div>
        )}
        {plan.performanceDirection && (
          <div>
            <p className="text-[9px] font-semibold text-white/30 uppercase tracking-wider">Performance Direction</p>
            <p className="text-[11px] text-white/70 mt-0.5 leading-snug">{plan.performanceDirection}</p>
          </div>
        )}
      </div>

      {/* Shot List */}
      <div>
        <p className="text-[10px] font-black text-white/35 uppercase tracking-widest mb-2.5">
          Shot List · {plan.shots.length} Shot{plan.shots.length !== 1 ? "s" : ""}
        </p>
        <div className="space-y-2">
          {plan.shots.map((shot) => (
            <div key={shot.shotNumber} className="rounded-xl bg-white/2 border border-white/6 p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[10px] font-black text-[#00D4FF] bg-[#00D4FF]/10 border border-[#00D4FF]/20 px-2 py-0.5 rounded-md">
                  SHOT {shot.shotNumber}
                </span>
                <span className="text-[10px] text-white/35">{shot.duration}s</span>
                <span className="text-[10px] font-semibold text-white/55 truncate">{shot.cameraMovement}</span>
                {shot.lensStyle && (
                  <span className="text-[10px] text-white/25 ml-auto truncate">{shot.lensStyle}</span>
                )}
              </div>
              {/* Actor dialogue for this shot */}
              {shot.dialogue ? (
                <div className="mb-2.5 rounded-lg bg-[#00E676]/6 border border-[#00E676]/15 px-2.5 py-2">
                  <p className="text-[9px] font-black text-[#00E676]/50 uppercase tracking-widest mb-1">Actor Line</p>
                  <p className="text-xs text-white/85 leading-snug italic">"{shot.dialogue}"</p>
                </div>
              ) : (
                <p className="text-[9px] text-white/25 mb-2 italic">Silent — no spoken line</p>
              )}
              <p className="text-xs text-white/60 leading-snug mb-2">{shot.subjectAction}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {([
                  ["Expression", shot.facialExpression],
                  ["Body", shot.bodyMovement],
                  ["Lighting", shot.lighting],
                  ["Transition", shot.transition],
                ] as [string, string][]).map(([label, value]) =>
                  value && value.toLowerCase() !== "none" ? (
                    <div key={label} className="flex items-start gap-1">
                      <span className="text-[9px] text-white/25 shrink-0 mt-0.5">{label}:</span>
                      <span className="text-[9px] text-white/50 leading-snug">{value}</span>
                    </div>
                  ) : null
                )}
              </div>
              {shot.environment && (
                <p className="text-[9px] text-white/30 mt-1.5 italic">{shot.environment}</p>
              )}
              {shot.visualEffects && !["none", "n/a", "no effects"].includes(shot.visualEffects.toLowerCase()) && (
                <p className="text-[9px] text-[#14F195]/70 mt-1.5">✦ {shot.visualEffects}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Post-production details */}
      <div className="grid gap-2">
        {plan.textOverlayPlacement && (
          <div className="rounded-xl bg-white/2 border border-white/6 p-2.5">
            <p className="text-[9px] font-black text-white/30 uppercase tracking-widest mb-1">Text Overlays</p>
            <p className="text-[11px] text-white/60 leading-snug">{plan.textOverlayPlacement}</p>
          </div>
        )}
        {plan.finalHeroShot && (
          <div className="rounded-xl bg-[#00D4FF]/4 border border-[#00D4FF]/10 p-2.5">
            <p className="text-[9px] font-black text-[#00D4FF]/60 uppercase tracking-widest mb-1">Final Hero Shot</p>
            <p className="text-[11px] text-white/60 leading-snug">{plan.finalHeroShot}</p>
          </div>
        )}
      </div>

      {/* Actor Script */}
      {script && (
        <div>
          <p className="text-[10px] font-black text-white/35 uppercase tracking-widest mb-2">Actor Script</p>
          <div className="rounded-xl bg-[#00E676]/4 border border-[#00E676]/12 p-3">
            <pre className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed font-sans">{script}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Trial gate: hardcoded sample blueprint preview ────────────────────────────
const SAMPLE_BLUEPRINT: CinematicPlan = {
  visualStyle: "Clean corporate minimalism with dynamic motion — crisp whites and deep navy, punctuated by electric accent lighting. Shot to feel like a premium product launch.",
  characterDescription: "Founder in her 30s — sharp, confident, well-tailored blazer. Radiates the energy of someone who has already solved the problem.",
  environment: "Modern open-plan office at golden hour. Floor-to-ceiling windows. City skyline behind. Laptop open on a minimal glass desk.",
  lighting: "Motivated window key — soft key, blue fill from off-camera LED. Lens flares on glass surfaces.",
  cameraLanguage: "Handheld with intent — smooth but alive. Push-ins on key emotional beats. 50mm for dialogue, 85mm for hero shots.",
  performanceDirection: "Quiet confidence. No overselling. The product speaks for itself — she just invites you in.",
  textOverlayPlacement: "Lower-third brand lockup on opener. Product name animates in at midpoint. CTA card at end with URL.",
  finalHeroShot: "Slow pull back from laptop screen showing the dashboard — founder smiling knowingly at camera, city glowing behind her.",
  shots: [
    {
      shotNumber: 1,
      duration: 5,
      dialogue: "You didn't start a business to spend all day managing it.",
      environment: "Tight on founder's eyes — shallow depth, city blurred behind",
      subjectAction: "Founder looks directly into camera, a slight knowing smile forming",
      facialExpression: "Calm confidence — the look of someone who found the answer",
      bodyMovement: "Still. Minimal. Presence over movement.",
      cameraMovement: "Very slow push in to extreme close-up",
      lensStyle: "85mm f/1.4 — cinematic bokeh",
      lighting: "Single window key, cool blue fill",
      transition: "Cut on the word 'managing'",
      visualEffects: "Subtle lens flare from window reflection",
    },
    {
      shotNumber: 2,
      duration: 8,
      dialogue: "GrowthForge reads your business and builds your marketing department in minutes.",
      environment: "Over-the-shoulder — laptop screen showing the dashboard loading with AI-generated content",
      subjectAction: "Founder types URL, watches results populate in real time",
      facialExpression: "Focused, then impressed — eyebrows lifting as content appears",
      bodyMovement: "Leans forward slightly, elbows on desk",
      cameraMovement: "Rack focus from founder's face to laptop screen mid-sentence",
      lensStyle: "50mm f/2.0",
      lighting: "Screen glow on face + window key",
      transition: "Smash cut to screen recording insert",
      visualEffects: "Screen reflection in glasses",
    },
    {
      shotNumber: 3,
      duration: 10,
      dialogue: "Competitors. Strategy. Social posts, email campaigns, video — generated and ready to publish.",
      environment: "Split-screen of dashboard features — competitor cards, strategy docs, content tiles",
      subjectAction: "Founder scrolls through dashboard, taps each section with natural confidence",
      facialExpression: "Engaged, gesturing — natural, not rehearsed",
      bodyMovement: "Points at screen as features appear",
      cameraMovement: "Static wide — then three fast ECUs of each feature loading",
      lensStyle: "35mm wide, macro for screen detail",
      lighting: "Even ambient — product clarity over mood",
      transition: "Fast cuts synced to voiceover beats",
      visualEffects: "Motion graphics callouts highlight each feature on screen",
    },
    {
      shotNumber: 4,
      duration: 7,
      dialogue: "Start free. No credit card. Your entire marketing engine — live in seven minutes.",
      environment: "Hero shot — founder standing, laptop closed, full city skyline visible",
      subjectAction: "Turns to face camera, confident and inviting",
      facialExpression: "Open, warm, direct — close of a trusted advisor",
      bodyMovement: "Natural weight shift, open body language",
      cameraMovement: "Slow pull back to reveal full environment",
      lensStyle: "24mm — environmental context",
      lighting: "Golden hour backlight, rim light on shoulders",
      transition: "Fade to brand card",
      visualEffects: "Warm lens flare on pull back",
    },
  ],
};

const SAMPLE_SCRIPT = `SHOT 1 — OPEN ON FOUNDER
"You didn't start a business to spend all day managing it."

SHOT 2 — PRODUCT REVEAL
"GrowthForge reads your business and builds your marketing department in minutes."

SHOT 3 — FEATURE SHOWCASE (V/O over screen recordings)
"Competitors. Strategy. Social posts, email campaigns, video — generated and ready to publish."

SHOT 4 — CLOSE / CTA
"Start free. No credit card. Your entire marketing engine — live in seven minutes."

[END CARD: GrowthForge · UseGrowthForge.com · Start Free Trial]`;

function VideoStudioTrialGate() {
  return (
    <div className="mt-2">
      {/* Label */}
      <p className="text-[10px] font-semibold text-white/25 uppercase tracking-widest mb-3 flex items-center gap-2">
        <Lock className="w-3 h-3" /> Sample Blueprint — Paid Plans Only
      </p>

      <div className="relative rounded-2xl overflow-hidden border border-white/8">
        {/* Blurred preview of a real blueprint */}
        <div className="pointer-events-none select-none" style={{ filter: "blur(3px)", opacity: 0.45 }}>
          {/* Fake card header */}
          <div className="px-4 pt-4 pb-3 border-b border-white/6 flex items-center gap-3">
            <span className="text-[10px] font-black text-violet-400 bg-violet-500/15 border border-violet-500/20 px-2 py-0.5 rounded-full">PROMO</span>
            <p className="text-sm font-bold text-white">30-Second Brand Commercial — Launch Campaign</p>
            <span className="ml-auto text-[10px] text-white/25 shrink-0">4 Shots · 30s</span>
          </div>
          {/* Blueprint content */}
          <div className="px-4 pb-4 max-h-80 overflow-hidden">
            <CinematicBlueprintViewer plan={SAMPLE_BLUEPRINT} script={SAMPLE_SCRIPT} />
          </div>
        </div>

        {/* Upgrade overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#040B14]/50 backdrop-blur-[2px]">
          <div className="rounded-2xl border border-[#00E676]/25 bg-[#040B14]/92 backdrop-blur-md p-8 max-w-md w-full text-center"
            style={{ boxShadow: "0 0 60px rgba(0,230,118,0.06), 0 25px 50px rgba(0,0,0,0.6)" }}>
            <div className="w-12 h-12 rounded-2xl bg-[#00E676]/15 border border-[#00E676]/25 flex items-center justify-center mx-auto mb-4">
              <Film className="w-6 h-6 text-[#00E676]" />
            </div>
            <h3 className="text-xl font-black text-white mb-2">AI Commercial Studio</h3>
            <p className="text-sm text-white/55 mb-2 leading-relaxed">
              That's a real blueprint above — actor scripts, cinematic shot lists, and production notes generated for your actual brand.
            </p>
            <p className="text-xs text-white/30 mb-6 leading-relaxed">
              Upgrade to generate up to 48 Promotional Videos per month and render them into broadcast-ready 1080p HD commercials with AI voiceover and cinematic footage.
            </p>
            <a
              href="/plans"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-black transition-all hover:scale-[1.02] active:scale-[0.99]"
              style={{ background: "#00E676", boxShadow: "0 0 28px rgba(0,230,118,0.3)" }}
            >
              <Sparkles className="w-4 h-4" /> Upgrade to Unlock Studio
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

const typeColors: Record<string, string> = {
  promo: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  product: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  social: "bg-pink-500/15 text-pink-400 border-pink-500/20",
};

const VIDEO_STEPS = [
  "Studying your brand and audience...",
  "Writing high-converting scripts...",
  "Designing cinematic storyboards...",
  "Engineering hooks for maximum attention...",
  "Assembling your commercial production pack...",
];

const IMAGE_STEPS = [
  "Reading your brand context...",
  "Crafting the visual prompt...",
  "Generating marketing image...",
  "Finalizing output...",
];

type RenderResolution = "1080p";

function ScoreBar({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-bold">{value ?? 0}</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value ?? 0}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  );
}

function RenderStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    idle:       { label: "Ready to Produce", cls: "bg-white/5 text-white/30 border-white/10" },
    queued:     { label: "In Queue",         cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" },
    processing: { label: "Producing…",       cls: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
    complete:   { label: "Delivered",         cls: "bg-[#00E676]/15 text-[#00E676] border-[#00E676]/20" },
    failed:     { label: "Needs Attention",  cls: "bg-red-500/15 text-red-400 border-red-500/20" },
  };
  const { label, cls } = map[status] ?? map["idle"];
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

// ── Render Panel (shown inside selected video card) ───────────────────────────
const RENDER_STEPS = [
  { after: 0,    label: "Preparing your production…" },
  { after: 15,   label: "Recording AI voiceover…" },
  { after: 40,   label: "Filming AI video scenes…" },
  { after: 90,   label: "Scene production in progress (~10 min)…" },
  { after: 600,  label: "Assembling your final commercial…" },
];

function RenderPanel({
  video,
  projectId,
  isTrial,
  isStarterPlan,
}: {
  video: VideoModel;
  projectId: number;
  isTrial: boolean;
  isStarterPlan: boolean;
}) {
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [locallyStarted, setLocallyStarted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [cancellingRender, setCancellingRender] = useState(false);
  const queryClient = useQueryClient();

  const startRender = useStartVideoRender();

  // Poll render status when in progress (either from DB or just started locally)
  const renderInProgress =
    locallyStarted ||
    video.renderStatus === "queued" ||
    video.renderStatus === "processing";

  const { data: renderStatus } = useGetVideoRenderStatus(
    projectId,
    video.id,
    {
      query: {
        queryKey: getGetVideoRenderStatusQueryKey(projectId, video.id),
        enabled: renderInProgress,
        refetchInterval: renderInProgress ? 5000 : false,
      },
    }
  );

  // Elapsed-time ticker so the step label advances meaningfully
  useEffect(() => {
    if (!renderInProgress) return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [renderInProgress]);

  // Sync locallyStarted back off once the DB confirms queued/processing/complete/failed
  const polledStatus = renderStatus?.renderStatus;
  useEffect(() => {
    if (locallyStarted && polledStatus && polledStatus !== "idle") {
      setLocallyStarted(false);
    }
  }, [locallyStarted, polledStatus]);

  const currentStatus = polledStatus ?? video.renderStatus ?? "idle";
  const currentVideoUrl = renderStatus?.videoUrl ?? video.videoUrl;

  // Pick the most descriptive step label based on elapsed time
  const stepLabel = RENDER_STEPS.reduce(
    (acc, step) => (elapsedSec >= step.after ? step.label : acc),
    RENDER_STEPS[0].label,
  );

  const handleCancelRender = async () => {
    setCancellingRender(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/videos/${video.id}/render`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Cancel failed");
      }
      setLocallyStarted(false);
      await queryClient.invalidateQueries({ queryKey: getListVideosQueryKey(projectId) });
      await queryClient.invalidateQueries({ queryKey: getGetVideoRenderStatusQueryKey(projectId, video.id) });
    } catch (_err) {
      // ignore — the poll will update status shortly
    } finally {
      setCancellingRender(false);
    }
  };

  const handleRender = () => {
    setLocallyStarted(true);
    setElapsedSec(0);
    startRender.mutate(
      {
        id: projectId,
        videoId: video.id,
        data: { resolution: "1080p" as const, aspectRatio, captionsEnabled },
      },
      {
        onSuccess: () => {
          // Invalidate the video list so the parent card badge updates
          void queryClient.invalidateQueries({
            queryKey: getListVideosQueryKey(projectId),
          });
        },
        onError: () => {
          setLocallyStarted(false);
        },
      },
    );
  };

  if (isTrial) {
    return (
      <div className="mt-4 pt-4 border-t border-border rounded-xl bg-[#00E676]/5 border border-[#00E676]/20 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-[#00E676]" />
          <span className="text-sm font-bold text-[#00E676]">Commercial Production — Paid Plans Only</span>
        </div>
        <p className="text-xs text-white/50 mb-3">
          Your trial includes full Commercial Blueprints — scripts, storyboards, and scene direction. Upgrade to produce broadcast-ready MP4 commercials with AI voiceover and cinematic footage.
        </p>
        <a
          href="/plans"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-black bg-[#00E676] hover:bg-[#00E676]/90 transition-colors"
        >
          <Sparkles className="w-3 h-3" /> Upgrade to Produce
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-4">
      {/* Completed render */}
      {currentStatus === "complete" && currentVideoUrl && (
        <div className="rounded-xl overflow-hidden border border-[#00E676]/30 bg-[#00E676]/5">
          <video controls className="w-full max-h-48 bg-black" src={currentVideoUrl} />
          <div className="flex gap-2 p-3">
            <a
              href={currentVideoUrl}
              download
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/70 transition-colors"
            >
              <Download className="w-3 h-3" /> Download
            </a>
            <a
              href={currentVideoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/70 transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Open
            </a>
          </div>
        </div>
      )}

      {/* Error message */}
      {currentStatus === "failed" && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-400">Production failed</p>
            <p className="text-xs text-white/40 mt-0.5">{renderStatus?.renderError ?? video.renderError ?? "Something went wrong during production. Please try again."}</p>
          </div>
          <button
            onClick={handleRender}
            disabled={startRender.isPending}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200 border border-red-500/30 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3 h-3" /> Try Again
          </button>
        </div>
      )}

      {/* In-progress indicator */}
      {(locallyStarted || currentStatus === "queued" || currentStatus === "processing") && (
        <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-blue-400">Producing your commercial…</p>
              <p className="text-xs text-white/50 mt-0.5">{stepLabel}</p>
            </div>
            <span className="text-[10px] text-white/25 tabular-nums shrink-0">
              {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")}
            </span>
          </div>
          {/* Progress track */}
          <div className="space-y-1.5">
            {RENDER_STEPS.map((step, i) => {
              const done = elapsedSec >= step.after;
              const isActive = done && (i === RENDER_STEPS.length - 1 || elapsedSec < RENDER_STEPS[i + 1].after);
              return (
                <div key={i} className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all ${
                    isActive ? "bg-blue-400 scale-125" : done ? "bg-blue-400/50" : "bg-white/10"
                  }`} />
                  <span className={`text-[10px] transition-colors ${
                    isActive ? "text-blue-300 font-semibold" : done ? "text-white/30" : "text-white/15"
                  }`}>{step.label}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-white/25">AI scene production takes 10–15 minutes. You can safely leave this page — your commercial keeps running.</p>
          <button
            onClick={() => void handleCancelRender()}
            disabled={cancellingRender}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/60 border border-white/10 transition-colors disabled:opacity-40 w-fit"
          >
            <X className="w-3 h-3" />
            {cancellingRender ? "Cancelling…" : "Cancel Production"}
          </button>
        </div>
      )}

      {/* Render config — only show when not in progress */}
      {!locallyStarted && currentStatus !== "queued" && currentStatus !== "processing" && (
        <>
          {/* Aspect Ratio */}
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Aspect Ratio</p>
            <div className="grid grid-cols-4 gap-1.5">
              {([
                { value: "16:9", label: "16:9", sub: "YouTube / LinkedIn" },
                { value: "9:16", label: "9:16", sub: "TikTok / Reels" },
                { value: "1:1",  label: "1:1",  sub: "Instagram Feed" },
                { value: "4:5",  label: "4:5",  sub: "Portrait" },
              ] as { value: AspectRatio; label: string; sub: string }[]).map((r) => (
                <button
                  key={r.value}
                  onClick={() => setAspectRatio(r.value)}
                  className={`py-2 px-1 rounded-xl border text-center transition-all ${
                    aspectRatio === r.value
                      ? "border-[#00D4FF]/50 bg-[#00D4FF]/10 text-[#00D4FF]"
                      : "border-white/8 hover:border-white/15 text-white/50"
                  }`}
                >
                  <p className="text-[11px] font-black">{r.label}</p>
                  <p className="text-[8px] text-white/30 mt-0.5 leading-tight">{r.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Captions Toggle */}
          <div className="flex items-center justify-between rounded-xl border border-white/8 bg-white/2 px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold text-white/70">Bold Captions</p>
              <p className="text-[10px] text-white/35 mt-0.5">Burned-in subtitles for social engagement</p>
            </div>
            <button
              role="switch"
              aria-checked={captionsEnabled}
              onClick={() => setCaptionsEnabled(!captionsEnabled)}
              style={{
                position: "relative",
                flexShrink: 0,
                marginLeft: "12px",
                width: "44px",
                height: "24px",
                borderRadius: "12px",
                border: "none",
                padding: 0,
                cursor: "pointer",
                backgroundColor: captionsEnabled ? "#00E676" : "rgba(255,255,255,0.15)",
                transition: "background-color 0.2s",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "2px",
                  left: captionsEnabled ? "22px" : "2px",
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  backgroundColor: "white",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                  transition: "left 0.2s",
                }}
              />
            </button>
          </div>

          {/* Render button */}
          <button
            onClick={handleRender}
            disabled={startRender.isPending}
            className="w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "#00E676", color: "#040B14" }}
          >
            {startRender.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Starting production…</>
            ) : (
              <><Film className="w-4 h-4" /> Produce My Commercial</>
            )}
          </button>

          {startRender.isError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {(startRender.error as { message?: string })?.message ?? "Couldn't start production — please try again"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── AI Image Studio ───────────────────────────────────────────────────────────
function ImageStudio({ projectId, isTrial }: { projectId: number; isTrial: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<ImageGenerateInputStyle>(ImageGenerateInputStyle.photorealistic);
  const [orientation, setOrientation] = useState<ImageGenerateInputOrientation>(ImageGenerateInputOrientation.landscape);
  const [count, setCount] = useState(1);
  const [generatedUrls, setGeneratedUrls] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateImage = useGenerateImage();

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const result = await generateImage.mutateAsync({
        id: projectId,
        data: { prompt: prompt || undefined, style, orientation, count },
      });
      setGeneratedUrls((prev) => [...(result.urls ?? []), ...prev]);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error ?? e?.message ?? "Image generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const styles: { value: ImageGenerateInputStyle; label: string }[] = [
    { value: ImageGenerateInputStyle.photorealistic, label: "Photo" },
    { value: ImageGenerateInputStyle.illustration, label: "Illustration" },
    { value: ImageGenerateInputStyle["3d"], label: "3D Render" },
    { value: ImageGenerateInputStyle.minimal, label: "Minimal" },
    { value: ImageGenerateInputStyle.cinematic, label: "Cinematic" },
  ];

  return (
    <div className="mt-10 pt-8 border-t border-border">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 rounded-xl bg-[#00D4FF]/15 flex items-center justify-center">
          <ImageIcon className="w-4 h-4 text-[#00D4FF]" />
        </div>
        <div>
          <h2 className="text-lg font-black">Creative Image Studio</h2>
          <p className="text-xs text-muted-foreground">AI-generated marketing visuals rooted in your brand story</p>
        </div>
        {isTrial && (
          <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#00E676]/15 text-[#00E676] border border-[#00E676]/20">
            5 images on trial
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">
              Prompt <span className="normal-case font-normal text-white/30">(leave blank to auto-generate from your brand)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Hero shot of our product on a clean white desk with soft shadows"
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl bg-white/4 border border-white/8 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:border-[#00D4FF]/40"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">Style</label>
            <div className="flex flex-wrap gap-1.5">
              {styles.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStyle(s.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                    style === s.value
                      ? "border-[#00D4FF]/50 bg-[#00D4FF]/10 text-[#00D4FF]"
                      : "border-white/8 text-white/50 hover:border-white/20"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">Orientation</label>
              <div className="flex gap-1.5">
                {(["landscape", "portrait", "square"] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setOrientation(o as ImageGenerateInputOrientation)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all border capitalize ${
                      orientation === o
                        ? "border-[#00D4FF]/50 bg-[#00D4FF]/10 text-[#00D4FF]"
                        : "border-white/8 text-white/50 hover:border-white/20 hover:text-white/70"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">
                Count {isTrial && <span className="text-white/25 normal-case font-normal">(max 4 on trial)</span>}
              </label>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all border ${
                      count === n
                        ? "border-[#00D4FF]/50 bg-[#00D4FF]/10 text-[#00D4FF]"
                        : "border-white/8 text-white/50 hover:border-white/20 hover:text-white/70"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
            </p>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-all hover:opacity-90"
            style={{ background: "#00D4FF", color: "#040B14" }}
          >
            {generating ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Generate {count > 1 ? `${count} Images` : "Image"}</>
            )}
          </button>
        </div>

        {/* Generated images gallery */}
        <div>
          {generatedUrls.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {generatedUrls.slice(0, 8).map((url, i) => (
                <div key={`${url}-${i}`} className="relative group rounded-xl overflow-hidden border border-white/8 aspect-video bg-white/3">
                  <img src={url} alt={`Generated ${i + 1}`} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <a
                      href={url}
                      download
                      className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download className="w-3.5 h-3.5 text-white" />
                    </a>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-lg bg-white/20 hover:bg-white/30 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-white" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full min-h-48 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/8 text-center p-6">
              <ImageIcon className="w-10 h-10 text-white/15 mb-3" />
              <p className="text-sm text-white/25">Your generated images appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBatchTime(d: Date): string {
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  const diffHr  = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 2)  return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24)  return `${diffHr}h ago`;
  if (diffDay < 7)  return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function groupIntoBatches(vids: VideoModel[]): { anchor: Date; videos: VideoModel[] }[] {
  if (vids.length === 0) return [];
  const batches: { anchor: Date; videos: VideoModel[] }[] = [];
  for (const v of vids) {
    const t = new Date(v.createdAt).getTime();
    const last = batches[batches.length - 1];
    if (last && Math.abs(new Date(last.anchor).getTime() - t) <= 5 * 60 * 1000) {
      last.videos.push(v);
    } else {
      batches.push({ anchor: new Date(v.createdAt), videos: [v] });
    }
  }
  return batches;
}

// ── VideoCard ─────────────────────────────────────────────────────────────────

function VideoCard({
  video,
  index,
  isSelected,
  isArchived,
  onSelect,
  onArchive,
  projectId,
  isTrial,
  isStarterPlan,
}: {
  video: VideoModel;
  index: number;
  isSelected: boolean;
  isArchived: boolean;
  onSelect: () => void;
  onArchive: () => void;
  projectId: number;
  isTrial: boolean;
  isStarterPlan: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className={`p-5 rounded-xl bg-card border transition-all ${
        isSelected ? "border-primary shadow-lg shadow-primary/10" : "border-border hover:border-border/80"
      }`}
    >
      {/* Thumbnail */}
      <div
        className="h-36 rounded-lg bg-secondary flex items-center justify-center mb-4 relative overflow-hidden group cursor-pointer"
        onClick={onSelect}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent" />
        {video.videoUrl ? (
          <video src={video.videoUrl} className="absolute inset-0 w-full h-full object-cover" muted />
        ) : (
          <Play className="h-10 w-10 text-primary/60 group-hover:text-primary transition-colors" />
        )}
        <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded border ${typeColors[video.type] ?? "bg-secondary text-muted-foreground border-border"}`}>
          {video.type}
        </span>
        <div className="absolute bottom-2 left-2">
          <RenderStatusBadge status={video.renderStatus ?? "idle"} />
        </div>
        {/* Archive / Restore button */}
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(); }}
          title={isArchived ? "Restore from archive" : "Archive this blueprint"}
          className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white/60 hover:text-white"
        >
          {isArchived ? <RotateCcw className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
        </button>
      </div>

      {/* Title + meta */}
      <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={onSelect}>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm leading-snug">{video.title}</h3>
          {video.duration && (
            <p className="text-xs text-muted-foreground mt-0.5">{video.duration}s · {video.status}</p>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform mt-0.5 ${isSelected ? "rotate-180" : ""}`} />
      </div>

      {/* Score bars */}
      <div className="space-y-2 mt-3">
        <ScoreBar label="Hook Strength"   value={video.hookStrength}       color="bg-violet-500" />
        <ScoreBar label="Engagement"      value={video.engagementPotential} color="bg-cyan-500" />
        <ScoreBar label="Viral Potential" value={video.viralPotential}     color="bg-pink-500" />
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {(() => {
              const plan = parseCinematicPlan(video.cinematicPlan);
              if (plan) return <CinematicBlueprintViewer plan={plan} script={video.script} />;
              return video.script ? (
                <div className="mt-4 pt-4 border-t border-border space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Script</div>
                    <pre className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-sans">{video.script}</pre>
                  </div>
                  {video.storyboard && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Storyboard</div>
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans">{video.storyboard}</pre>
                    </div>
                  )}
                </div>
              ) : null;
            })()}
            <CommercialProductionProgress video={video} projectId={projectId} isTrial={isTrial} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Usage Panel ───────────────────────────────────────────────────────────────

const PLAN_LABEL: Record<string, string> = {
  trial:       "Trial",
  starter:     "Starter",
  "get-going": "Get-Going",
  growth:      "Growth",
  agency:      "Agency",
};
const PLAN_COLOR: Record<string, string> = {
  trial:       "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  starter:     "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "get-going": "bg-[#00E676]/15 text-[#00E676] border-[#00E676]/30",
  growth:      "bg-violet-500/15 text-violet-400 border-violet-500/30",
  agency:      "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

function UsagePanel({ projectId, plan }: { projectId: number; plan: string }) {
  const { data: usageData, isLoading } = useGetProjectUsage(projectId);

  if (isLoading || !usageData) return null;

  const isTrial = plan === "trial";
  const { usage, periodStart } = usageData;

  const metrics: { label: string; feature: string; icon: string }[] = [
    { label: "Promotional Videos", feature: "video_blueprints",  icon: "🎬" },
    { label: "Social Posts",       feature: "social_posts",      icon: "📱" },
    { label: "Email Campaigns",    feature: "email_campaigns",   icon: "📧" },
    { label: "AI Agent Messages",  feature: "agent_messages",    icon: "🤖" },
  ];

  const resetDate = periodStart
    ? new Date(new Date(periodStart).setMonth(new Date(periodStart).getMonth() + 1)).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <div className="mb-6 rounded-2xl border border-white/8 bg-white/2 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#00D4FF]" />
          <span className="text-sm font-bold text-white/70">
            {isTrial ? "Trial Usage" : "Monthly Usage"}
          </span>
          {!isTrial && resetDate && (
            <span className="text-[10px] text-white/25">resets {resetDate}</span>
          )}
        </div>
        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${PLAN_COLOR[plan] ?? "bg-white/10 text-white/60 border-white/20"}`}>
          {PLAN_LABEL[plan] ?? plan}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map(({ label, feature, icon }) => {
          const entry = usage[feature];
          if (!entry) return null;
          const pct = entry.limit != null ? Math.min(100, (entry.used / entry.limit) * 100) : null;
          const remaining = entry.limit != null ? entry.limit - entry.used : null;
          const warn = pct != null && pct >= 80;
          return (
            <div key={feature} className="rounded-xl bg-white/3 border border-white/6 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/40 leading-snug">{label}</span>
                <span className="text-[10px]">{icon}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-black text-white">{entry.used}</span>
                {entry.limit != null && (
                  <span className="text-xs text-white/30">/ {entry.limit}</span>
                )}
              </div>
              {pct != null ? (
                <div className="space-y-1">
                  <div className="h-1 bg-white/8 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${warn ? "bg-orange-400" : "bg-[#00E676]"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {remaining != null && (
                    <p className={`text-[9px] font-medium ${warn ? "text-orange-400" : "text-white/30"}`}>
                      {remaining} remaining
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[9px] text-white/30">Unlimited</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProjectVideos() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);

  // Generation controls
  const [mode, setMode]                   = useState<"auto" | "prompt">("auto");
  const [targetDuration, setTargetDuration] = useState<15 | 30 | 45 | 60 | 90>(45);
  const [blueprintCount, setBlueprintCount] = useState(5);
  const [modalOpen, setModalOpen]         = useState(false);
  const [imgModalOpen, setImgModalOpen]   = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);

  // Organisation state
  const [searchQuery,   setSearchQuery]   = useState("");
  const [filterType,    setFilterType]    = useState<"all" | "promo" | "product" | "social">("all");
  const [filterStatus,  setFilterStatus]  = useState<"all" | "rendered" | "not_rendered" | "failed">("all");
  const [sortBy,        setSortBy]        = useState<"newest" | "hookStrength" | "engagement">("newest");
  const [showHistory,   setShowHistory]   = useState(false);
  const [showArchived,  setShowArchived]  = useState(false);
  const [archivedIds,   setArchivedIds]   = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem(`gf-archived-${projectId}`);
      return raw ? new Set(JSON.parse(raw) as number[]) : new Set<number>();
    } catch { return new Set<number>(); }
  });

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId } });
  const { data: videos, isLoading } = useListVideos(projectId, { query: { queryKey: getListVideosQueryKey(projectId), enabled: !!projectId } });
  const generateVideos = useGenerateVideos();
  const queryClient = useQueryClient();

  const isTrial      = project?.plan === "trial";
  const isStarterPlan = project?.plan === "starter";
  const plan          = project?.plan ?? "starter";

  const toggleArchive = (videoId: number) => {
    setArchivedIds(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId); else next.add(videoId);
      try { localStorage.setItem(`gf-archived-${projectId}`, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const handleSubmit = (_url: string, _instructions: string, locale: string): Promise<void> =>
    new Promise((resolve, reject) => {
      generateVideos.mutate(
        { id: projectId, data: { mode, count: blueprintCount, targetDuration, targetLocale: locale || undefined } },
        {
          onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListVideosQueryKey(projectId) }); resolve(); },
          onError: reject,
        },
      );
    });

  const allVideos     = videos ?? [];
  const activeVideos  = allVideos.filter(v => !archivedIds.has(v.id));
  const archivedVideos = allVideos.filter(v => archivedIds.has(v.id));

  const filteredVideos = activeVideos
    .filter(v => filterType === "all" || v.type === filterType)
    .filter(v => {
      if (filterStatus === "rendered")     return v.renderStatus === "complete";
      if (filterStatus === "not_rendered") return !v.renderStatus || v.renderStatus === "idle";
      if (filterStatus === "failed")       return v.renderStatus === "failed";
      return true;
    })
    .filter(v => !searchQuery || v.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "hookStrength") return (b.hookStrength ?? 0) - (a.hookStrength ?? 0);
      if (sortBy === "engagement")   return (b.engagementPotential ?? 0) - (a.engagementPotential ?? 0);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const batches      = groupIntoBatches(filteredVideos);
  const activeBatch  = batches[0] ?? null;
  const historyBatches = batches.slice(1);
  const hasFilters   = !!(searchQuery || filterType !== "all" || filterStatus !== "all" || sortBy !== "newest");

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">GrowthForge Commercial Studio</h1>
          <p className="text-muted-foreground mt-1">
            Commercial briefs · AI-produced video · Brand image creation
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-0.5">Duration</p>
            <div className="flex rounded-xl border border-border overflow-hidden">
              {([15, 30, 45, 60, 90] as const).map((d) => (
                <button key={d} onClick={() => setTargetDuration(d)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${targetDuration === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {d}s
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-0.5">Blueprints</p>
            <div className="flex items-center rounded-xl border border-border overflow-hidden">
              <button onClick={() => setBlueprintCount(c => Math.max(1, c - 1))} className="px-3 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors">−</button>
              <span className="px-3 py-2 text-sm font-semibold min-w-[2rem] text-center">{blueprintCount}</span>
              <button onClick={() => setBlueprintCount(c => Math.min(12, c + 1))} className="px-3 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors">+</button>
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-0.5">Mode</p>
            <div className="flex rounded-xl border border-border overflow-hidden">
              {(["auto", "prompt"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {m === "auto" ? "Auto" : "Prompt"}
                </button>
              ))}
            </div>
          </div>
          {isTrial ? (
            <a
              href="/plans"
              className="flex items-center gap-2 font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-lg self-end text-black"
              style={{ background: "#00E676", boxShadow: "0 0 20px rgba(0,230,118,0.2)" }}
            >
              <Lock className="h-4 w-4" /> Upgrade to Create
            </a>
          ) : (
            <div className="flex items-center gap-2 self-end">
              <VideoWalletWidget compact />
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-lg shadow-primary/20"
              >
                <Sparkles className="h-4 w-4" />
                Create {blueprintCount} Commercial Brief{blueprintCount !== 1 ? "s" : ""}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Usage panel ── */}
      <UsagePanel projectId={projectId} plan={plan} />

      {/* ── Video wallet (non-trial) ── */}
      {!isTrial && (
        <div className="mt-2 mb-6 max-w-sm">
          <VideoWalletWidget />
        </div>
      )}

      {/* ── Blueprint library ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : allVideos.length > 0 ? (
        <div>
          {/* Filter / Sort / Search bar */}
          <div className="flex flex-col sm:flex-row gap-2 mb-6 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search blueprints…"
                className="w-full pl-8 pr-8 py-2 rounded-xl bg-white/4 border border-white/8 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 transition-colors"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Type filter */}
            <div className="flex rounded-xl border border-white/8 overflow-hidden shrink-0">
              {(["all", "promo", "product", "social"] as const).map((t) => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${filterType === t ? "bg-white/12 text-white" : "text-white/40 hover:text-white/60"}`}>
                  {t === "all" ? "All" : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex rounded-xl border border-white/8 overflow-hidden shrink-0">
              {([
                { v: "all",         l: "All" },
                { v: "rendered",    l: "Delivered" },
                { v: "not_rendered",l: "Ready to Produce" },
                { v: "failed",      l: "Needs Attention" },
              ] as const).map((s) => (
                <button key={s.v} onClick={() => setFilterStatus(s.v)}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${filterStatus === s.v ? "bg-white/12 text-white" : "text-white/40 hover:text-white/60"}`}>
                  {s.l}
                </button>
              ))}
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-2 rounded-xl bg-white/4 border border-white/8 text-xs text-white/60 focus:outline-none focus:border-white/20 transition-colors shrink-0"
            >
              <option value="newest">Newest first</option>
              <option value="hookStrength">Hook Strength</option>
              <option value="engagement">Engagement</option>
            </select>

            {hasFilters && (
              <button
                onClick={() => { setSearchQuery(""); setFilterType("all"); setFilterStatus("all"); setSortBy("newest"); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/8 text-xs text-white/40 hover:text-white/60 transition-colors shrink-0"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {filteredVideos.length === 0 ? (
            <div className="text-center py-20">
              <Filter className="w-10 h-10 text-white/15 mx-auto mb-3" />
              <p className="text-sm text-white/40">No blueprints match your filters</p>
              <button
                onClick={() => { setSearchQuery(""); setFilterType("all"); setFilterStatus("all"); setSortBy("newest"); }}
                className="mt-3 text-xs text-[#00E676] hover:text-[#00E676]/80 transition-colors"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <>
              {/* ── Active Workspace — latest generation batch ── */}
              {activeBatch && (
                <div className="mb-10">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00E676] animate-pulse" />
                    <h2 className="text-[10px] font-bold text-white/50 uppercase tracking-widest">Active Workspace</h2>
                    <span className="text-[10px] text-white/25">
                      {formatBatchTime(activeBatch.anchor)} · {activeBatch.videos.length} blueprint{activeBatch.videos.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="grid lg:grid-cols-2 gap-4">
                    {activeBatch.videos.map((video, i) => (
                      <VideoCard
                        key={video.id} video={video} index={i}
                        isSelected={selectedVideo === video.id}
                        isArchived={archivedIds.has(video.id)}
                        onSelect={() => setSelectedVideo(selectedVideo === video.id ? null : video.id)}
                        onArchive={() => toggleArchive(video.id)}
                        projectId={projectId} isTrial={isTrial} isStarterPlan={isStarterPlan}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── History — older generation batches ── */}
              {historyBatches.length > 0 && (
                <div className="pt-6 border-t border-white/6">
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="flex items-center gap-2 mb-4 w-full text-xs text-white/40 hover:text-white/60 transition-colors"
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-bold uppercase tracking-widest">History</span>
                    <span className="text-white/25">
                      {historyBatches.reduce((s, b) => s + b.videos.length, 0)} blueprints across {historyBatches.length} generation{historyBatches.length !== 1 ? "s" : ""}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 transition-transform ${showHistory ? "rotate-180" : ""}`} />
                  </button>

                  <AnimatePresence>
                    {showHistory && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden space-y-8"
                      >
                        {historyBatches.map((batch, bi) => (
                          <div key={bi}>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-[10px] font-semibold text-white/25 uppercase tracking-wider">
                                {formatBatchTime(batch.anchor)}
                              </span>
                              <span className="text-[10px] text-white/20">
                                · {batch.videos.length} blueprint{batch.videos.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <div className="grid lg:grid-cols-2 gap-4">
                              {batch.videos.map((video, i) => (
                                <VideoCard
                                  key={video.id} video={video} index={i}
                                  isSelected={selectedVideo === video.id}
                                  isArchived={archivedIds.has(video.id)}
                                  onSelect={() => setSelectedVideo(selectedVideo === video.id ? null : video.id)}
                                  onArchive={() => toggleArchive(video.id)}
                                  projectId={projectId} isTrial={isTrial} isStarterPlan={isStarterPlan}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </>
          )}

          {/* ── Archived blueprints ── */}
          {archivedVideos.length > 0 && (
            <div className="mt-8 pt-6 border-t border-white/6">
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="flex items-center gap-2 mb-4 w-full text-xs text-white/25 hover:text-white/45 transition-colors"
              >
                <Archive className="w-3.5 h-3.5 shrink-0" />
                <span className="font-bold uppercase tracking-widest">Archived</span>
                <span className="text-white/20">{archivedVideos.length} blueprint{archivedVideos.length !== 1 ? "s" : ""}</span>
                <ChevronDown className={`w-3.5 h-3.5 ml-auto shrink-0 transition-transform ${showArchived ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence>
                {showArchived && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="grid lg:grid-cols-2 gap-4 opacity-55">
                      {archivedVideos.map((video, i) => (
                        <VideoCard
                          key={video.id} video={video} index={i}
                          isSelected={selectedVideo === video.id}
                          isArchived={true}
                          onSelect={() => setSelectedVideo(selectedVideo === video.id ? null : video.id)}
                          onArchive={() => toggleArchive(video.id)}
                          projectId={projectId} isTrial={isTrial} isStarterPlan={isStarterPlan}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      ) : isTrial ? (
        <VideoStudioTrialGate />
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <VideoIcon className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">Your Studio is Ready</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">
            Create commercial briefs — fully written scripts, cinematic storyboards, and scene-by-scene production notes tailored to your brand.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground font-bold px-6 py-3 rounded-xl"
          >
            <Sparkles className="h-4 w-4" />
            Generate {mode === "auto" ? "9 Blueprints" : "3 Blueprints"}
          </button>
        </div>
      )}

      {/* ── AI Image Studio ── */}
      <ImageStudio projectId={projectId} isTrial={isTrial} />

      {/* ── Modals ── */}
      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Generate ${blueprintCount} Blueprint${blueprintCount !== 1 ? "s" : ""}`}
        subtitle="AI will write actor scripts, storyboards, and production notes for each video"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        detectedLocale={project?.detectedLocale ?? undefined}
        instructionsPlaceholder={`Examples:\n• Focus on product demo videos\n• Create viral TikTok hooks\n• Target founder pain points\n• Include customer testimonial style`}
        processingSteps={VIDEO_STEPS}
        onSubmit={handleSubmit}
        ctaLabel={`Generate ${blueprintCount} Blueprint${blueprintCount !== 1 ? "s" : ""}`}
      />
      <GenerateModal
        isOpen={imgModalOpen}
        onClose={() => setImgModalOpen(false)}
        title="Generate AI Marketing Images"
        subtitle="AI generates marketing visuals grounded in your brand"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
        instructionsPlaceholder={`Examples:\n• Hero product shot, clean background\n• Social media banner, bold typography\n• Team photo style, warm lighting`}
        processingSteps={IMAGE_STEPS}
        onSubmit={async () => {}}
        ctaLabel="Generate Images"
      />
    </div>
  );
}

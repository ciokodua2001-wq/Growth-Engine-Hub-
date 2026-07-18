import { useState, useEffect } from "react";
import { useParams } from "wouter";
import {
  useListVideos,
  useGenerateVideos,
  useGetProject,
  useStartVideoRender,
  useGetVideoRenderStatus,
  useGenerateImage,
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
  Lock, Download, ExternalLink, Plus, Trash2, User,
} from "lucide-react";
import GenerateModal from "@/components/ui/generate-modal";

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

const typeColors: Record<string, string> = {
  promo: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  product: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  social: "bg-pink-500/15 text-pink-400 border-pink-500/20",
};

const VIDEO_STEPS = [
  "Analyzing brand story...",
  "Writing video scripts...",
  "Creating storyboards...",
  "Optimizing hooks for virality...",
  "Finalizing video production pack...",
];

const IMAGE_STEPS = [
  "Reading your brand context...",
  "Crafting the visual prompt...",
  "Generating marketing image...",
  "Finalizing output...",
];

type RenderMode = "footage" | "avatar" | "combined";
type RenderResolution = "1080p" | "4k";

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
    idle:       { label: "Not Rendered", cls: "bg-white/5 text-white/30 border-white/10" },
    queued:     { label: "Queued",       cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20" },
    processing: { label: "Rendering…",  cls: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
    complete:   { label: "Done",         cls: "bg-[#00E676]/15 text-[#00E676] border-[#00E676]/20" },
    failed:     { label: "Failed",       cls: "bg-red-500/15 text-red-400 border-red-500/20" },
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
  { after: 0,    label: "Starting pipeline…" },
  { after: 15,   label: "Generating AI voiceover…" },
  { after: 40,   label: "Generating video scenes…" },
  { after: 90,   label: "AI video generation in progress (~10 min)…" },
  { after: 600,  label: "Assembling your video…" },
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
  const [renderMode, setRenderMode] = useState<RenderMode>("avatar");
  const [resolution, setResolution] = useState<RenderResolution>("1080p");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [locallyStarted, setLocallyStarted] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
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

  const handleRender = () => {
    setLocallyStarted(true);
    setElapsedSec(0);
    startRender.mutate(
      {
        id: projectId,
        videoId: video.id,
        data: { mode: renderMode, resolution, aspectRatio, captionsEnabled },
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
          <span className="text-sm font-bold text-[#00E676]">Video Rendering — Paid Plans Only</span>
        </div>
        <p className="text-xs text-white/50 mb-3">
          Your trial includes video blueprints (actor scripts + storyboards). Upgrade to render actual MP4 videos with AI voiceover, HeyGen presenter, and B-roll footage.
        </p>
        <a
          href="/plans"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-black bg-[#00E676] hover:bg-[#00E676]/90 transition-colors"
        >
          <Sparkles className="w-3 h-3" /> Upgrade to Render
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
            <p className="text-xs font-semibold text-red-400">Render failed</p>
            <p className="text-xs text-white/40 mt-0.5">{video.renderError ?? "An error occurred during rendering. Please try again."}</p>
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
              <p className="text-xs font-bold text-blue-400">Rendering your video…</p>
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
          <p className="text-[10px] text-white/25">AI video generation takes 10–15 minutes. You can leave this page and come back.</p>
        </div>
      )}

      {/* Render config — only show when not in progress */}
      {!locallyStarted && currentStatus !== "queued" && currentStatus !== "processing" && (
        <>
          {/* Video Style */}
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Video Style</p>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { value: "avatar",   label: "Presenter", sub: "HeyGen talking head" },
                { value: "footage",  label: "B-Roll",    sub: "AI scenic clips" },
                { value: "combined", label: "Combined",  sub: "Presenter + B-Roll" },
              ] as { value: RenderMode; label: string; sub: string }[]).map((m) => (
                <button
                  key={m.value}
                  onClick={() => setRenderMode(m.value)}
                  className={`py-2 px-1 rounded-xl border text-center transition-all ${
                    renderMode === m.value
                      ? "border-[#00E676]/50 bg-[#00E676]/10 text-[#00E676]"
                      : "border-white/8 hover:border-white/15 text-white/50"
                  }`}
                >
                  <p className="text-[11px] font-black">{m.label}</p>
                  <p className="text-[8px] text-white/30 mt-0.5 leading-tight">{m.sub}</p>
                </button>
              ))}
            </div>
          </div>

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

          {/* Resolution */}
          <div>
            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">Resolution</p>
            <div className="flex gap-2">
              {([
                { value: "1080p", label: "1080p HD", available: true },
                { value: "4k", label: "4K Ultra HD", available: !isStarterPlan },
              ] as { value: RenderResolution; label: string; available: boolean }[]).map((r) => (
                <button
                  key={r.value}
                  onClick={() => r.available && setResolution(r.value)}
                  disabled={!r.available}
                  className={`flex-1 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    !r.available
                      ? "border-white/5 text-white/20 bg-white/2 cursor-not-allowed"
                      : resolution === r.value
                        ? "border-[#00E676]/50 bg-[#00E676]/10 text-[#00E676]"
                        : "border-white/8 hover:border-white/15 text-white/60"
                  }`}
                >
                  {r.label}
                  {!r.available && <span className="ml-1 text-[9px] text-white/20">(Get-Going+)</span>}
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
              <><Loader2 className="w-4 h-4 animate-spin" /> Starting render…</>
            ) : (
              <><Film className="w-4 h-4" /> Render Video</>
            )}
          </button>

          {startRender.isError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {(startRender.error as { message?: string })?.message ?? "Failed to start render"}
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
          <h2 className="text-lg font-black">AI Image Studio</h2>
          <p className="text-xs text-muted-foreground">Generate marketing visuals grounded in your business</p>
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">Orientation</label>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as ImageGenerateInputOrientation)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/4 border border-white/8 text-sm text-white focus:outline-none"
              >
                <option value={ImageGenerateInputOrientation.landscape}>Landscape</option>
                <option value={ImageGenerateInputOrientation.portrait}>Portrait</option>
                <option value={ImageGenerateInputOrientation.square}>Square</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-1.5 block">
                Count {isTrial && <span className="text-white/25 normal-case font-normal">(max {Math.min(count, 4)})</span>}
              </label>
              <select
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value))}
                className="w-full px-3 py-2.5 rounded-xl bg-white/4 border border-white/8 text-sm text-white focus:outline-none"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n} image{n > 1 ? "s" : ""}</option>
                ))}
              </select>
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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectVideos() {
  const params = useParams<{ projectId: string }>();
  const projectId = parseInt(params.projectId, 10);
  const [mode, setMode] = useState<"auto" | "prompt">("auto");
  const [targetDuration, setTargetDuration] = useState<15 | 30 | 45 | 60 | 90>(45);
  const [blueprintCount, setBlueprintCount] = useState(5);
  const [selectedVideo, setSelectedVideo] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [imgModalOpen, setImgModalOpen] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId } });
  const { data: videos, isLoading } = useListVideos(projectId, { query: { queryKey: getListVideosQueryKey(projectId), enabled: !!projectId } });
  const generateVideos = useGenerateVideos();
  const queryClient = useQueryClient();

  const isTrial = project?.plan === "trial";
  const isStarterPlan = project?.plan === "starter";

  const handleSubmit = (_websiteUrl: string, _instructions: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      generateVideos.mutate(
        { id: projectId, data: { mode, count: blueprintCount, targetDuration } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListVideosQueryKey(projectId) });
            resolve();
          },
          onError: reject,
        }
      );
    });
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Video Studio</h1>
          <p className="text-muted-foreground mt-1">
            AI-generated blueprints · Real video rendering · Marketing image generation
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Duration picker */}
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-0.5">Duration</p>
            <div className="flex rounded-xl border border-border overflow-hidden">
              {([15, 30, 45, 60, 90] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setTargetDuration(d)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${targetDuration === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>
          {/* Count picker */}
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-0.5">Blueprints</p>
            <div className="flex items-center rounded-xl border border-border overflow-hidden">
              <button
                onClick={() => setBlueprintCount(c => Math.max(1, c - 1))}
                className="px-3 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
              >−</button>
              <span className="px-3 py-2 text-sm font-semibold min-w-[2rem] text-center">{blueprintCount}</span>
              <button
                onClick={() => setBlueprintCount(c => Math.min(12, c + 1))}
                className="px-3 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
              >+</button>
            </div>
          </div>
          {/* Mode toggle */}
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-0.5">Mode</p>
            <div className="flex rounded-xl border border-border overflow-hidden">
              {(["auto", "prompt"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "auto" ? "Auto" : "Prompt"}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-lg shadow-primary/20 self-end"
          >
            <Sparkles className="h-4 w-4" />
            Generate {blueprintCount} Blueprint{blueprintCount !== 1 ? "s" : ""}
          </button>
        </div>
      </div>

      {/* Blueprint cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : videos && videos.length > 0 ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {videos.map((video, i) => {
            const isSelected = selectedVideo === video.id;
            return (
              <motion.div
                key={video.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className={`p-5 rounded-xl bg-card border transition-all ${
                  isSelected ? "border-primary shadow-lg shadow-primary/10" : "border-border hover:border-border/80"
                }`}
              >
                {/* Thumbnail */}
                <div
                  className="h-36 rounded-lg bg-secondary flex items-center justify-center mb-4 relative overflow-hidden group cursor-pointer"
                  onClick={() => setSelectedVideo(isSelected ? null : video.id)}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent" />
                  {video.videoUrl ? (
                    <video
                      src={video.videoUrl}
                      className="absolute inset-0 w-full h-full object-cover"
                      muted
                    />
                  ) : (
                    <Play className="h-10 w-10 text-primary/60 group-hover:text-primary transition-colors" />
                  )}
                  <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-1 rounded border ${typeColors[video.type] ?? "bg-secondary text-muted-foreground border-border"}`}>
                    {video.type}
                  </span>
                  <div className="absolute bottom-2 left-2">
                    <RenderStatusBadge status={video.renderStatus ?? "idle"} />
                  </div>
                </div>

                {/* Title + meta */}
                <div
                  className="flex items-start justify-between gap-2 cursor-pointer"
                  onClick={() => setSelectedVideo(isSelected ? null : video.id)}
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm leading-snug">{video.title}</h3>
                    {video.duration && (
                      <p className="text-xs text-muted-foreground mt-0.5">{video.duration}s · {video.status}</p>
                    )}
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform mt-0.5 ${isSelected ? "rotate-180" : ""}`}
                  />
                </div>

                {/* Score bars */}
                <div className="space-y-2 mt-3">
                  <ScoreBar label="Hook Strength" value={video.hookStrength} color="bg-violet-500" />
                  <ScoreBar label="Engagement" value={video.engagementPotential} color="bg-cyan-500" />
                  <ScoreBar label="Viral Potential" value={video.viralPotential} color="bg-pink-500" />
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
                      {/* Cinematic Blueprint or legacy Script/Storyboard */}
                      {(() => {
                        const plan = parseCinematicPlan(video.cinematicPlan);
                        if (plan) {
                          return <CinematicBlueprintViewer plan={plan} script={video.script} />;
                        }
                        // Fallback for older blueprints that pre-date cinematic plans
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

                      {/* Render panel */}
                      <RenderPanel
                        video={video}
                        projectId={projectId}
                        isTrial={isTrial}
                        isStarterPlan={isStarterPlan}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <VideoIcon className="h-16 w-16 text-primary/30 mb-6" />
          <h2 className="text-2xl font-bold mb-3">No Blueprints Yet</h2>
          <p className="text-muted-foreground mb-8 max-w-sm">
            Generate video blueprints — scripts, storyboards, and production notes for promos, product demos, and social shorts.
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

      {/* AI Image Studio */}
      <ImageStudio projectId={projectId} isTrial={isTrial} />

      {/* Modals */}
      <GenerateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Generate ${blueprintCount} Blueprint${blueprintCount !== 1 ? "s" : ""}`}
        subtitle="AI will write actor scripts, storyboards, and production notes for each video"
        defaultWebsiteUrl={project?.websiteUrl ?? ""}
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

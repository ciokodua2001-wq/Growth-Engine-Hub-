/**
 * CommercialProductionProgress
 *
 * Replaces the old time-based render spinner with a real, API-driven production
 * progress system. Covers the full pipeline:
 *
 *   Blueprint stages (pre-complete, shown in sequence)
 *   → Scene generation  (polls GET /scenes, per-scene retry)
 *   → Assembly          (polls GET /assemblies, simulated sub-stages)
 *   → Complete          (inline video player + download)
 */

import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, AlertCircle, RefreshCw, Download,
  Loader2, Clock, Film, Music, Sparkles, BarChart2,
  Target, FileText, Clapperboard, Play,
  Lock as LockIcon, Upload, Trash2,
  Share2, Copy, Type,
} from "lucide-react";

// ── API types ─────────────────────────────────────────────────────────────────

interface SceneRecord {
  id: number;
  sceneIndex: number;
  sceneName: string | null;
  sceneType: string | null;
  status: "pending" | "submitted" | "processing" | "succeed" | "failed";
  errorMessage: string | null;
  retryCount: number;
}

interface ScenesResponse {
  totalScenes: number;
  progress: { completed: number; inProgress: number; pending: number; failed: number; percentComplete: number };
  allComplete: boolean;
  scenes: SceneRecord[];
}

interface AssemblyRecord {
  id: number;
  outputFormat: string;
  status: "pending" | "processing" | "complete" | "failed";
  videoUrl: string | null;
  errorMessage: string | null;
}

interface AssembliesResponse {
  overallStatus: "idle" | "processing" | "complete" | "partial" | "failed";
  assemblies: AssemblyRecord[];
}

// ── Stage definitions ─────────────────────────────────────────────────────────

type StageId =
  | "analysis" | "strategy" | "script" | "blueprint"
  | "scene_0" | "scene_1" | "scene_2" | "scene_3" | "scene_4" | "scene_5"
  | "rendering" | "music" | "finalizing" | "complete";

interface Stage {
  id: StageId;
  label: string;
  detail: string;
  icon: React.ElementType;
  weight: number; // contribution to overall %
}

const STAGES: Stage[] = [
  { id: "analysis",   label: "Reading Your Brand",            detail: "Immersing in your business, audience, and competitive landscape to ground every frame…", icon: BarChart2,     weight: 3 },
  { id: "strategy",   label: "Crafting the Message",          detail: "Identifying the sharpest angles, emotional hooks, and calls-to-action for your audience…", icon: Target,        weight: 3 },
  { id: "script",     label: "Writing the Script",            detail: "Building a high-converting 30-second narrative with a proven Hook → Problem → CTA arc…",   icon: FileText,      weight: 3 },
  { id: "blueprint",  label: "Designing the Production",      detail: "Laying out 6 cinematic scenes with camera language, lighting mood, and performance notes…", icon: Clapperboard,  weight: 3 },
  { id: "scene_0",    label: "Filming Scene 1 — Hook",        detail: "Producing the opening moment that stops the scroll and demands attention in 3 seconds…",   icon: Film,          weight: 10 },
  { id: "scene_1",    label: "Filming Scene 2 — Problem",     detail: "Capturing the viewer's challenge with empathy and visual authenticity…",                    icon: Film,          weight: 10 },
  { id: "scene_2",    label: "Filming Scene 3 — Solution",    detail: "Revealing your product as the elegant, obvious answer to what they've been missing…",       icon: Film,          weight: 10 },
  { id: "scene_3",    label: "Filming Scene 4 — Benefits",    detail: "Bringing the three most powerful benefits to life through cinematic storytelling…",          icon: Film,          weight: 10 },
  { id: "scene_4",    label: "Filming Scene 5 — Proof",       detail: "Instilling confidence with transformation moments and social proof that converts…",         icon: Film,          weight: 10 },
  { id: "scene_5",    label: "Filming Scene 6 — Call to Act", detail: "Closing with brand authority and urgency that drives immediate viewer response…",           icon: Film,          weight: 10 },
  { id: "rendering",  label: "Assembling Your Commercial",    detail: "Joining all 6 scenes with cinematic crossfades and professional color normalization…",      icon: Film,          weight: 5 },
  { id: "music",      label: "Adding the Score",              detail: "Weaving in background music at the perfect volume — supporting tone without distraction…",  icon: Music,         weight: 5 },
  { id: "finalizing", label: "Preparing for Delivery",        detail: "Encoding to H.264 High Profile with faststart — instant playback on every platform…",      icon: Sparkles,      weight: 5 },
  { id: "complete",   label: "Commercial Delivered",          detail: "Your commercial is ready to publish, share, and drive results.",                            icon: Check,         weight: 0 },
];

const TOTAL_WEIGHT = STAGES.reduce((s, st) => s + st.weight, 0);

// ── Helpers ───────────────────────────────────────────────────────────────────

function stageIndex(id: StageId): number { return STAGES.findIndex(s => s.id === id); }

function computeProgress(
  completedStageIds: Set<StageId>,
  currentStageId: StageId,
  sceneProgress: number, // 0-100 from /scenes API
  assemblyProgress: number, // 0-100 from /assemblies API
): number {
  let pct = 0;
  for (const stage of STAGES) {
    if (stage.weight === 0) continue;
    if (completedStageIds.has(stage.id)) {
      pct += stage.weight;
    } else if (stage.id === currentStageId) {
      if (stage.id.startsWith("scene_")) pct += stage.weight * (sceneProgress / 100) * 0.8;
      else if (["rendering","music","finalizing"].includes(stage.id)) pct += stage.weight * (assemblyProgress / 100) * 0.7;
      else pct += stage.weight * 0.4;
    }
  }
  return Math.min(99, Math.round((pct / TOTAL_WEIGHT) * 100));
}

function formatETA(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  return `~${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const SCENE_ETA_MINUTES = 8;
const ASSEMBLY_ETA_MINUTES = 4;
const MAX_SCENE_RETRIES = 10;

// ── Sub-components ────────────────────────────────────────────────────────────

function SceneTile({ scene }: { scene: SceneRecord }) {
  const name = scene.sceneName ?? `Scene ${scene.sceneIndex + 1}`;
  const isSuccess = scene.status === "succeed";
  // Anything that isn't succeeded yet — including a scene that's silently
  // being retried behind the scenes — reads as "still filming" to the
  // customer. We never surface failure/retry language here: the system
  // keeps working automatically until the scene comes back succeeded, and
  // customers should simply trust the video is on its way.
  const isInProgress = !isSuccess;

  return (
    <div className={`relative rounded-xl border p-2.5 transition-all duration-500 ${
      isSuccess ? "border-[#00E676]/30 bg-[#00E676]/6"
      : isInProgress ? "border-[#00D4FF]/25 bg-[#00D4FF]/5"
      : "border-white/6 bg-white/2"
    }`}>
      {/* Status icon */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center mx-auto mb-1.5 ${
        isSuccess ? "bg-[#00E676] text-black"
        : isInProgress ? "bg-[#00D4FF]/15 border border-[#00D4FF]/30"
        : "bg-white/5 border border-white/10"
      }`}>
        {isSuccess ? <Check className="w-3 h-3" />
          : isInProgress ? (
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-[#00D4FF]"
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
              transition={{ repeat: Infinity, duration: 1.4 }}
            />
          ) : <div className="w-1.5 h-1.5 rounded-full bg-white/15" />}
      </div>

      {/* Label */}
      <p className={`text-[9px] font-semibold text-center truncate ${
        isSuccess ? "text-[#00E676]"
        : isInProgress ? "text-[#00D4FF]"
        : "text-white/30"
      }`}>
        {name.split(" — ")[1] ?? name}
      </p>
    </div>
  );
}

// ── Caption overlay helpers ───────────────────────────────────────────────────

function wrapCaptionText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const c = line ? `${line} ${w}` : w;
    if (c.length <= maxChars) { line = c; }
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function buildSubtitleTimings(
  voiceover: string,
  duration: number,
): Array<{ text: string; startSec: number; endSec: number }> {
  if (!voiceover || duration <= 0) return [];
  const raw = voiceover.replace(/([.!?])\s+/g, "$1\n").split(/\n/).map(s => s.trim()).filter(Boolean);
  if (raw.length === 0) return [];
  const totalChars = raw.reduce((sum, s) => sum + s.length, 0);
  const entries: Array<{ text: string; startSec: number; endSec: number }> = [];
  let t = 0.1;
  for (const sentence of raw) {
    if (t >= duration - 0.3) break;
    const dur = Math.max(1.0, (sentence.length / totalChars) * duration * 0.95);
    const end = Math.min(t + dur, duration - 0.1);
    entries.push({ text: wrapCaptionText(sentence, 32), startSec: t, endSec: end });
    t = end + 0.08;
  }
  return entries;
}

type CaptionPresetKey = "classic" | "box" | "bold" | "neon" | "cinematic";
type CaptionPosKey = "bottom" | "middle" | "top";

function getCaptionOverlayStyle(
  pos: CaptionPosKey,
  preset: CaptionPresetKey,
): CSSProperties {
  const posBase: CSSProperties =
    pos === "top"    ? { top: "8%",  transform: "translateX(-50%)" }           :
    pos === "middle" ? { top: "50%", transform: "translateX(-50%) translateY(-50%)" } :
                       { bottom: "12%", transform: "translateX(-50%)" };

  const presetStyle: CSSProperties =
    preset === "box" ? {
      color: "#FFFFFF", fontWeight: "700",
      fontSize: "clamp(10px, 2.8vw, 15px)",
      background: "rgba(0,0,0,0.75)", padding: "5px 10px", borderRadius: "5px",
    } :
    preset === "bold" ? {
      color: "#FFFF00", fontWeight: "900",
      fontSize: "clamp(11px, 3.1vw, 16px)",
      textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
    } :
    preset === "neon" ? {
      color: "#00E676", fontWeight: "700",
      fontSize: "clamp(10px, 2.8vw, 15px)",
      textShadow: "0 0 8px rgba(0,230,118,0.5), -1px -1px 0 rgba(255,255,255,0.5), 1px -1px 0 rgba(255,255,255,0.5), -1px 1px 0 rgba(255,255,255,0.5), 1px 1px 0 rgba(255,255,255,0.5)",
    } :
    preset === "cinematic" ? {
      color: "rgba(255,255,255,0.92)", fontStyle: "italic", fontWeight: "400",
      fontSize: "clamp(9px, 2.5vw, 13px)",
      textShadow: "0 2px 10px rgba(0,0,0,0.95), 0 0 30px rgba(0,0,0,0.6)",
    } :
    /* classic */ {
      color: "#FFFFFF", fontWeight: "600",
      fontSize: "clamp(10px, 2.8vw, 15px)",
      textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, -2px 0 0 #000, 2px 0 0 #000",
    };

  return {
    position: "absolute",
    left: "50%",
    width: "82%",
    textAlign: "center",
    zIndex: 10,
    pointerEvents: "none",
    lineHeight: "1.45",
    letterSpacing: "0.01em",
    ...posBase,
    ...presetStyle,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export interface CommercialProgressVideo {
  id: number;
  title: string;
  script?: string | null;
  storyboard?: string | null;
  cinematicPlan?: string | null;
  renderStatus?: string | null;
  videoUrl?: string | null;
  voiceover?: string | null;
}

interface Props {
  video: CommercialProgressVideo;
  projectId: number;
  isTrial?: boolean;
  onBack?: () => void;
}

type Phase = "idle" | "blueprint" | "scenes" | "assembling" | "complete" | "error";

export default function CommercialProductionProgress({ video, projectId, isTrial = false, onBack }: Props) {
  const apiBase = `/api/projects/${projectId}/videos/${video.id}`;

  // ── State ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("idle");
  const [completedStages, setCompletedStages] = useState<Set<StageId>>(new Set());
  const { toast } = useToast();
  const [currentStage, setCurrentStage] = useState<StageId>("analysis");
  const [scenes, setScenes] = useState<SceneRecord[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblyRecord[]>([]);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(video.videoUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicFileName, setMusicFileName] = useState<string | null>(null);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const musicUrlRef = useRef<string | null>(null); // keeps startAssembly closure fresh
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  // Tracks scene IDs we've already auto-triggered a client-side retry for,
  // so we don't fire multiple retries from successive poll ticks.
  const autoRetriedRef = useRef<Set<number>>(new Set());
  // Counts silent assembly retries — mirrors the scene auto-retry philosophy:
  // the customer never sees a stitching failure, we just quietly try again.
  const assemblyAutoRetryCountRef = useRef(0);

  type OutputFormat = "landscape" | "square" | "vertical";
  const [selectedFormats, setSelectedFormats] = useState<OutputFormat[]>(["landscape"]);
  const selectedFormatsRef = useRef<OutputFormat[]>(["landscape"]);

  // ── Caption overlay state (post-render, browser-side) ──────────────────────
  type CaptionPreset = "classic" | "box" | "bold" | "neon" | "cinematic";
  type CaptionPos = "bottom" | "middle" | "top";
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>("classic");
  const [captionPos, setCaptionPos] = useState<CaptionPos>("bottom");
  const [currentCaptionText, setCurrentCaptionText] = useState<string | null>(null);
  const [captionExportState, setCaptionExportState] = useState<"idle" | "rendering" | "done" | "error">("idle");
  const [finalAssemblyId, setFinalAssemblyId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const subtitleTimingsRef = useRef<Array<{ text: string; startSec: number; endSec: number }>>([]);

  // ── Detect resume state on mount ───────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    const rs = video.renderStatus ?? "idle";

    // Already complete
    if (video.videoUrl && rs === "complete") {
      setFinalVideoUrl(video.videoUrl);
      const all = new Set(STAGES.map(s => s.id) as StageId[]);
      setCompletedStages(all);
      setCurrentStage("complete");
      setPhase("complete");
      return;
    }

    // In progress — restore from API
    if (rs === "processing" || rs === "queued") {
      setPhase("scenes");
      setCurrentStage("scene_0");
      void pollScenes();
    }

    return () => { mountedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Caption overlay timing ─────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !video.voiceover || phase !== "complete") return;

    const buildTimings = () => {
      if (v.duration && isFinite(v.duration)) {
        subtitleTimingsRef.current = buildSubtitleTimings(video.voiceover!, v.duration);
      }
    };
    const onTimeUpdate = () => {
      const t = v.currentTime;
      const entry = subtitleTimingsRef.current.find(e => t >= e.startSec && t < e.endSec) ?? null;
      setCurrentCaptionText(entry?.text ?? null);
    };

    v.addEventListener("loadedmetadata", buildTimings);
    v.addEventListener("timeupdate", onTimeUpdate);
    buildTimings();

    return () => {
      v.removeEventListener("loadedmetadata", buildTimings);
      v.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [phase, finalVideoUrl, video.voiceover]);

  // ── Elapsed timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "idle" || phase === "complete" || phase === "error") return;
    const t = setInterval(() => setElapsedSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // ── Blueprint warm-up (pre-complete stages) ────────────────────────────────
  const runBlueprintStages = useCallback(async () => {
    const preStages: StageId[] = ["analysis", "strategy", "script", "blueprint"];
    for (let i = 0; i < preStages.length; i++) {
      if (!mountedRef.current) return;
      setCurrentStage(preStages[i]!);
      await new Promise(r => setTimeout(r, 900 + Math.random() * 400));
      if (!mountedRef.current) return;
      setCompletedStages(prev => new Set([...prev, preStages[i]!]));
    }
  }, []);

  // ── Scene polling ──────────────────────────────────────────────────────────
  const pollScenes = useCallback(async () => {
    const INTERVAL = 10_000;
    while (mountedRef.current) {
      try {
        const r = await fetch(`${apiBase}/scenes`);
        if (!r.ok) throw new Error(`/scenes HTTP ${r.status}`);
        const data = (await r.json()) as ScenesResponse;
        if (!mountedRef.current) return;

        setScenes(data.scenes);

        // ── Client-side auto-retry ──────────────────────────────────────────
        // When a scene lands in "failed" status (server auto-retries exhausted),
        // silently trigger another retry from the client without showing any
        // failure UI to the user. Each auto-retry on the server runs 4 Kling
        // attempts internally, so this gives another full retry cycle.
        // We track which scene IDs we've already triggered so we don't fire
        // duplicate retries on successive poll ticks.
        for (const scene of data.scenes) {
          if (
            scene.status === "failed" &&
            scene.retryCount < MAX_SCENE_RETRIES &&
            !autoRetriedRef.current.has(scene.id)
          ) {
            autoRetriedRef.current.add(scene.id);
            // Optimistically flip to "pending" so the tile stays blue (no red flash)
            setScenes(prev => prev.map(s =>
              s.id === scene.id ? { ...s, status: "pending" as const } : s,
            ));
            // Fire and forget — errors are non-fatal (next poll will catch it)
            fetch(`${apiBase}/scenes/${scene.id}/retry`, { method: "POST" }).catch(() => {
              // Re-allow retry next cycle if the request itself failed
              autoRetriedRef.current.delete(scene.id);
            });
          }
        }

        // Update the active scene stage label
        const activeScene = data.scenes.find(
          s => s.status === "submitted" || s.status === "processing",
        ) ?? data.scenes.find(s => s.status === "pending");
        if (activeScene) {
          setCurrentStage(`scene_${activeScene.sceneIndex}` as StageId);
        }

        // Mark completed scenes
        const completedIndices = data.scenes.filter(s => s.status === "succeed").map(s => s.sceneIndex);
        setCompletedStages(prev => {
          const next = new Set(prev);
          for (const idx of completedIndices) next.add(`scene_${idx}` as StageId);
          return next;
        });

        // All scenes done → move to assembly
        if (data.allComplete) {
          setCompletedStages(prev => {
            const next = new Set(prev);
            STAGES.slice(0, 10).forEach(s => next.add(s.id));
            return next;
          });
          setCurrentStage("rendering");
          setPhase("assembling");
          assemblyAutoRetryCountRef.current = 0;
          await startAssembly();
          return;
        }
      } catch (err) {
        if (!mountedRef.current) return;
        // Non-fatal — just keep polling
      }
      await new Promise(r => setTimeout(r, INTERVAL));
    }
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Caption export — POST /assemble with captions burned in ───────────────
  const handleExportWithCaptions = useCallback(async () => {
    setCaptionExportState("rendering");
    try {
      const r = await fetch(`${apiBase}/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputFormats: selectedFormatsRef.current.length > 0 ? selectedFormatsRef.current : ["landscape"],
          captionsEnabled: true,
          captionPreset,
          captionPosition: captionPos,
          transitionType: "fade",
          transitionDuration: 0.5,
          ...(musicUrlRef.current ? { backgroundMusicUrl: musicUrlRef.current } : {}),
          force: true,
        }),
      });
      if (!r.ok) throw new Error(`Assembly start failed (${r.status})`);
      const { assemblyIds } = (await r.json()) as { assemblyIds: number[] };
      const targetId = assemblyIds[0];

      // Poll until the captioned assembly completes, then auto-download
      while (mountedRef.current) {
        await new Promise(res => setTimeout(res, 8_000));
        const pr = await fetch(`${apiBase}/assemblies`);
        if (!pr.ok) continue;
        const data = (await pr.json()) as AssembliesResponse;
        const target = data.assemblies.find(a => a.id === targetId);
        if (target?.status === "complete" && target.videoUrl && target.id) {
          setCaptionExportState("done");
          // Use the proxy route to force a real file download on mobile Chrome
          const proxyUrl = `${apiBase}/assemblies/${target.id}/download`;
          try {
            const dr = await fetch(proxyUrl);
            if (dr.ok) {
              const blob = await dr.blob();
              const objectUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = objectUrl;
              a.download = `${video.title ?? "commercial"}-captioned.mp4`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(objectUrl);
            }
          } catch { /* non-fatal — user can manually download */ }
          return;
        }
        if (target?.status === "failed") throw new Error("Caption export failed on server");
      }
    } catch (err) {
      setCaptionExportState("error");
      toast({ title: "Export failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
      setTimeout(() => setCaptionExportState("idle"), 4_000);
    }
  }, [apiBase, captionPreset, captionPos, video.title, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Share / copy-link / download handlers ──────────────────────────────────

  // Returns the proxy download URL for the current clean assembly.
  // Proxy route handles GCS auth + forces Content-Disposition: attachment.
  const getProxyDownloadUrl = useCallback(() => {
    if (!finalAssemblyId) return null;
    return `${apiBase}/assemblies/${finalAssemblyId}/download`;
  }, [apiBase, finalAssemblyId]);

  const handleDownload = useCallback(async () => {
    const proxyUrl = getProxyDownloadUrl();
    if (!proxyUrl) return;
    setDownloading(true);
    try {
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${video.title ?? "commercial"}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }, [getProxyDownloadUrl, video.title, toast]);

  const handleShare = useCallback(async () => {
    if (!finalVideoUrl) return;
    const proxyUrl = getProxyDownloadUrl();

    // Try native file-share first (mobile share sheet sends the actual video)
    if (proxyUrl && navigator.share && typeof navigator.canShare === "function") {
      try {
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], `${video.title ?? "commercial"}.mp4`, { type: "video/mp4" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ title: video.title ?? "GrowthForge Commercial", files: [file] });
            return;
          }
        }
      } catch { /* fall through to URL share */ }
    }

    // URL share (desktop / browsers without file-share)
    if (navigator.share) {
      try {
        await navigator.share({ title: video.title, text: "Check out this commercial made with GrowthForge AI", url: finalVideoUrl });
        return;
      } catch { /* user cancelled */ }
    }

    // Clipboard fallback
    await navigator.clipboard.writeText(finalVideoUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2_500);
  }, [finalVideoUrl, getProxyDownloadUrl, video.title]);

  const handleCopyLink = useCallback(async () => {
    if (!finalVideoUrl) return;
    await navigator.clipboard.writeText(finalVideoUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2_500);
  }, [finalVideoUrl]);

  // ── Assembly trigger ───────────────────────────────────────────────────────
  const handleMusicUpload = useCallback(async (file: File) => {
    setUploadingMusic(true);
    try {
      const form = new FormData();
      form.append("music", file);
      const r = await fetch(`${apiBase}/music`, { method: "POST", body: form });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `Upload failed (${r.status})`);
      }
      const { url, name } = (await r.json()) as { url: string; name: string };
      setMusicUrl(url);
      setMusicFileName(name);
      musicUrlRef.current = url; // keep ref in sync so startAssembly gets the latest
    } catch (err) {
      toast({ title: "Music upload failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setUploadingMusic(false);
    }
  }, [apiBase, toast]);

  // Assembly hiccups (a stitching failure, a stuck/idle job, a timeout) are
  // never shown to the customer as an error. We quietly re-trigger assembly
  // a bounded number of times in the background first — only after that
  // budget is exhausted do we fall back to the visible error screen, as a
  // last-resort safety net for genuinely unrecoverable cases.
  const ASSEMBLY_AUTO_RETRY_LIMIT = 5;
  const ASSEMBLY_AUTO_RETRY_DELAY_MS = 8_000;

  const startAssembly = useCallback(async (force = false) => {
    try {
      const r = await fetch(`${apiBase}/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputFormats: selectedFormatsRef.current.length > 0 ? selectedFormatsRef.current : ["landscape"],
          transitionType: "fade",
          transitionDuration: 0.5,
          ...(musicUrlRef.current ? { backgroundMusicUrl: musicUrlRef.current } : {}),
          ...(force ? { force: true } : {}),
        }),
      });
      if (!r.ok) {
        throw new Error(`Assembly start failed (${r.status})`);
      }
      // Kick off assembly polling
      await pollAssembly();
    } catch (err) {
      if (!mountedRef.current) return;
      if (assemblyAutoRetryCountRef.current < ASSEMBLY_AUTO_RETRY_LIMIT) {
        assemblyAutoRetryCountRef.current += 1;
        await new Promise(res => setTimeout(res, ASSEMBLY_AUTO_RETRY_DELAY_MS));
        if (!mountedRef.current) return;
        await startAssembly(true);
        return;
      }
      setError("This is taking longer than expected. Please try again in a few minutes.");
      setPhase("error");
    }
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Assembly polling with simulated sub-stages ─────────────────────────────
  const pollAssembly = useCallback(async () => {
    const INTERVAL = 6_000;
    const MAX_WAIT_MS = 8 * 60 * 1000; // 8 minutes per attempt — generous even for slow presets
    const assemblySubStages: StageId[] = ["rendering", "music", "finalizing"];
    let subStageIdx = 0;
    const startedAt = Date.now();

    // Silently re-triggers assembly, or — only once the retry budget is
    // exhausted — falls back to a plain, non-technical error message.
    const retryOrGiveUp = async (): Promise<void> => {
      if (!mountedRef.current) return;
      if (assemblyAutoRetryCountRef.current < ASSEMBLY_AUTO_RETRY_LIMIT) {
        assemblyAutoRetryCountRef.current += 1;
        await new Promise(res => setTimeout(res, ASSEMBLY_AUTO_RETRY_DELAY_MS));
        if (!mountedRef.current) return;
        await startAssembly(true);
        return;
      }
      setError("This is taking longer than expected. Please try again in a few minutes.");
      setPhase("error");
    };

    while (mountedRef.current) {
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        await retryOrGiveUp();
        return;
      }

      try {
        const r = await fetch(`${apiBase}/assemblies`);
        if (!r.ok) throw new Error(`/assemblies HTTP ${r.status}`);
        const data = (await r.json()) as AssembliesResponse;
        if (!mountedRef.current) return;

        setAssemblies(data.assemblies);

        // Advance simulated sub-stages each poll, marking previous ones complete
        if (data.overallStatus === "processing") {
          const currentSub = assemblySubStages[Math.min(subStageIdx, assemblySubStages.length - 1)]!;
          setCurrentStage(currentSub);
          if (subStageIdx > 0) {
            setCompletedStages(prev => {
              const updated = new Set(prev);
              for (let i = 0; i < subStageIdx; i++) {
                updated.add(assemblySubStages[i]! as StageId);
              }
              return updated;
            });
          }
          subStageIdx = Math.min(subStageIdx + 1, assemblySubStages.length - 1);
        }

        if (data.overallStatus === "complete") {
          assemblyAutoRetryCountRef.current = 0;
          // Pick the primary selected format first, then any completed assembly
          const primaryAssembly =
            data.assemblies.find(
              a => selectedFormatsRef.current.includes(a.outputFormat as OutputFormat) && a.status === "complete" && a.videoUrl,
            ) ?? data.assemblies.find(a => a.status === "complete" && a.videoUrl);
          const url = primaryAssembly?.videoUrl ?? null;
          setFinalAssemblyId(primaryAssembly?.id ?? null);

          setCompletedStages(prev => {
            const next = new Set(prev);
            STAGES.forEach(s => { if (s.id !== "complete") next.add(s.id); });
            return next;
          });
          setCurrentStage("complete");
          setFinalVideoUrl(url);
          setPhase("complete");
          return;
        }

        // "failed" (a stitching error) or "idle" (no assembly row exists —
        // unexpected after POST /assemble) are both silently retried rather
        // than surfaced to the customer.
        if (data.overallStatus === "failed" || data.overallStatus === "idle") {
          await retryOrGiveUp();
          return;
        }

      } catch {
        // Transient poll error (e.g. a network blip) — not a real assembly
        // failure, so just keep polling quietly.
        if (!mountedRef.current) return;
      }
      await new Promise(r => setTimeout(r, INTERVAL));
    }
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Production start ───────────────────────────────────────────────────────
  const startProduction = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setPhase("blueprint");
    setError(null);
    setElapsedSec(0);

    // Step 1: Blueprint stages (visual warmup)
    await runBlueprintStages();
    if (!mountedRef.current) return;

    // Step 2: Generate scenes via SceneManager
    setCurrentStage("scene_0");
    setPhase("scenes");
    try {
      // Map the selected output format to a Kling aspect ratio so Kling clips
      // are generated natively in the right format (not scaled/letterboxed later).
      const FORMAT_TO_AR: Record<string, string> = {
        landscape: "landscape",
        square: "square",
        vertical: "vertical",
      };
      const selectedFormat = selectedFormatsRef.current[0] ?? "landscape";
      const r = await fetch(`${apiBase}/scenes/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspectRatio: FORMAT_TO_AR[selectedFormat] ?? "landscape" }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `Scene generation failed (${r.status})`);
      }
      // Kick off polling
      await pollScenes();
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "Production failed";
      setError(msg);
      setPhase("error");
      startedRef.current = false;
    }
  }, [apiBase, runBlueprintStages, pollScenes]);

  // ── Progress calculation ───────────────────────────────────────────────────
  const sceneProgressPct = scenes.length > 0
    ? Math.round((scenes.filter(s => s.status === "succeed").length / scenes.length) * 100)
    : 0;

  const assemblyProgressPct = assemblies.length > 0
    ? (assemblies.some(a => a.status === "complete") ? 100
      : assemblies.some(a => a.status === "processing") ? 50 : 10)
    : 0;

  const isComplete = phase === "complete";
  const overallPct = isComplete
    ? 100
    : computeProgress(completedStages, currentStage, sceneProgressPct, assemblyProgressPct);

  // ETA
  const remainingScenes = scenes.filter(s => s.status !== "succeed" && s.status !== "failed").length;
  const assemblyNotStarted = phase !== "assembling" && phase !== "complete";
  const etaMinutes = remainingScenes * SCENE_ETA_MINUTES + (assemblyNotStarted ? ASSEMBLY_ETA_MINUTES : phase === "assembling" ? 3 : 0);

  // Only surface the "needs attention" banner when a scene is truly stuck —
  // We intentionally never surface a "failed"/"needs retry" state to the
  // customer — the system retries silently in the background until each
  // scene succeeds, so the UI always reads as ordinary, ongoing progress.
  const allScenesSucceeded = scenes.length > 0 && scenes.every(s => s.status === "succeed");
  const activeSceneCount = scenes.filter(s => s.status === "submitted" || s.status === "processing").length;

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── Idle: show launch button (or trial gate) ──────────────────────────────
  if (phase === "idle") {
    const hasBlueprint = !!(video.script || video.storyboard || video.cinematicPlan);

    // Trial users see a locked upgrade card instead
    if (isTrial) {
      return (
        <div className="mt-4 pt-4 border-t border-white/8">
          <div className="rounded-xl bg-[#00E676]/5 border border-[#00E676]/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <LockIcon className="w-4 h-4 text-[#00E676]" />
              <span className="text-sm font-bold text-[#00E676]">Commercial Production — Paid Plans Only</span>
            </div>
            <p className="text-xs text-white/50 mb-3">
              Your trial includes full Commercial Blueprints — scripts, storyboards, and scene-by-scene production notes.
              Upgrade to produce broadcast-ready MP4 commercials with AI-generated scenes, narration, and cinematic transitions.
            </p>
            <a
              href="/plans"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-black bg-[#00E676] hover:bg-[#00E676]/90 transition-colors"
            >
              <Sparkles className="w-3 h-3" /> Upgrade to Produce
            </a>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-4 pt-4 border-t border-white/8 space-y-4">
        <div className="rounded-xl bg-gradient-to-br from-[#00E676]/6 to-[#00D4FF]/4 border border-[#00E676]/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-[#00E676]/15 border border-[#00E676]/30 flex items-center justify-center">
              <Film className="w-4 h-4 text-[#00E676]" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">GrowthForge Commercial Studio</p>
              <p className="text-[10px] text-white/40">30-second commercial · 6 cinematic scenes · AI-produced</p>
            </div>
          </div>

          {!hasBlueprint ? (
            <div className="rounded-lg bg-yellow-500/8 border border-yellow-500/20 p-3 mb-3">
              <p className="text-xs text-yellow-400 font-medium">Create a brief first</p>
              <p className="text-[10px] text-white/45 mt-0.5">Generate a Commercial Brief first — we'll use it as the production blueprint for your commercial.</p>
            </div>
          ) : (
            <>
              {/* ── Aspect ratio ──────────────────────────────────────────── */}
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">Aspect Ratio</p>
                <div className="flex gap-1.5">
                  {([
                    { key: "landscape" as const, label: "Landscape", sub: "16:9", w: 16, h: 9 },
                    { key: "square"    as const, label: "Square",    sub: "1:1",  w: 9,  h: 9 },
                    { key: "vertical"  as const, label: "Vertical",  sub: "9:16", w: 9,  h: 16 },
                  ]).map(({ key, label, sub, w, h }) => {
                    const active = selectedFormats.includes(key);
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setSelectedFormats([key]);
                          selectedFormatsRef.current = [key];
                        }}
                        className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-lg border transition-all ${
                          active
                            ? "border-[#00E676]/50 bg-[#00E676]/10 text-[#00E676] ring-1 ring-[#00E676]/30"
                            : "border-white/8 bg-white/2 text-white/25 hover:border-white/18 hover:text-white/45 cursor-pointer"
                        }`}
                      >
                        <div
                          className={`rounded border ${active ? "border-[#00E676]/50 bg-[#00E676]/15" : "border-white/15 bg-white/5"}`}
                          style={{ width: `${w * 2.2}px`, height: `${h * 2.2}px` }}
                        />
                        <span className="text-[9px] font-bold leading-none">{label}</span>
                        <span className={`text-[8px] leading-none ${active ? "text-[#00E676]/60" : "text-white/20"}`}>{sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

            </>
          )}

          {/* ── Music upload ───────────────────────────────────────────────── */}
          <div className="mb-3">
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1.5">Background Music</p>
            <input
              ref={musicInputRef}
              type="file"
              accept="audio/mp3,audio/mpeg,audio/wav,audio/aac,audio/m4a,audio/ogg,.mp3,.wav,.aac,.m4a,.ogg"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleMusicUpload(f); e.target.value = ""; }}
            />
            {musicUrl && musicFileName ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#00E676]/8 border border-[#00E676]/20">
                <Music className="w-3.5 h-3.5 text-[#00E676] shrink-0" />
                <span className="text-xs text-[#00E676] font-medium flex-1 truncate">{musicFileName}</span>
                <button
                  onClick={() => { setMusicUrl(null); setMusicFileName(null); }}
                  className="text-white/30 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => musicInputRef.current?.click()}
                disabled={uploadingMusic}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-white/15 text-[11px] font-semibold text-white/40 hover:border-white/30 hover:text-white/60 transition-colors disabled:opacity-40"
              >
                {uploadingMusic
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
                  : <><Upload className="w-3 h-3" /> Upload your music (MP3 / WAV / AAC) — or we'll use our ambient track</>
                }
              </button>
            )}
          </div>

          <button
            disabled={!hasBlueprint}
            onClick={() => void startProduction()}
            className="w-full py-2.5 rounded-xl font-bold text-sm text-black bg-[#00E676] hover:bg-[#14F195] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Film className="w-4 h-4" />
            Produce Commercial
          </button>
        </div>

        {onBack && (
          <button onClick={onBack} className="text-xs text-white/30 hover:text-white/50 transition-colors">
            ← Back
          </button>
        )}
      </div>
    );
  }

  // ── Complete: show video player + caption editor + export options ──────────
  if (phase === "complete" && finalVideoUrl) {
    return (
      <div className="mt-4 pt-4 border-t border-white/8 space-y-3">

        {/* Video player with live caption overlay */}
        <div className="relative rounded-xl overflow-hidden border border-[#00E676]/30 bg-black">
          <video
            ref={videoRef}
            controls
            className="w-full"
            style={{ maxHeight: "300px", display: "block" }}
            src={finalVideoUrl}
          />
          {captionsVisible && currentCaptionText && (
            <div style={getCaptionOverlayStyle(captionPos, captionPreset)}>
              {currentCaptionText.split("\n").map((line, i) => (
                <span key={i} style={{ display: "block" }}>{line}</span>
              ))}
            </div>
          )}
        </div>

        {/* Caption editor — always shown so users can export with any preset */}
        <div className="rounded-xl bg-white/3 border border-white/8 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Type className="w-3 h-3 text-white/50" />
                <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">Captions</span>
              </div>
              <button
                onClick={() => setCaptionsVisible(v => !v)}
                className={`w-8 h-4 rounded-full transition-all relative ${captionsVisible ? "bg-[#00E676]" : "bg-white/10"}`}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${captionsVisible ? "left-4" : "left-0.5"}`} />
              </button>
            </div>
            {captionsVisible && (
              <>
                <div>
                  <p className="text-[9px] text-white/30 uppercase tracking-wider mb-1.5">Style</p>
                  <div className="flex gap-1">
                    {(["classic", "box", "bold", "neon", "cinematic"] as CaptionPreset[]).map(p => (
                      <button
                        key={p}
                        onClick={() => setCaptionPreset(p)}
                        className={`flex-1 py-1.5 rounded text-[9px] font-bold transition-all capitalize ${
                          captionPreset === p
                            ? "bg-[#00E676]/20 border border-[#00E676]/40 text-[#00E676]"
                            : "bg-white/4 border border-white/8 text-white/40 hover:text-white/60"
                        }`}
                      >{p}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[9px] text-white/30 uppercase tracking-wider mb-1.5">Position</p>
                  <div className="flex gap-1">
                    {(["top", "middle", "bottom"] as CaptionPos[]).map(pos => (
                      <button
                        key={pos}
                        onClick={() => setCaptionPos(pos)}
                        className={`flex-1 py-1.5 rounded text-[9px] font-bold transition-all capitalize ${
                          captionPos === pos
                            ? "bg-[#00D4FF]/20 border border-[#00D4FF]/40 text-[#00D4FF]"
                            : "bg-white/4 border border-white/8 text-white/40 hover:text-white/60"
                        }`}
                      >{pos}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

        {/* Export options */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => void handleShare()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-[#00E676] text-black hover:bg-[#14F195] transition-all"
            >
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
            <button
              onClick={() => void handleCopyLink()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold bg-white/6 border border-white/12 text-white/70 hover:bg-white/10 transition-all"
            >
              {copied
                ? <><Check className="w-3.5 h-3.5 text-[#00E676]" /> Copied!</>
                : <><Copy className="w-3.5 h-3.5" /> Copy Link</>}
            </button>
          </div>

          <button
            onClick={() => void handleDownload()}
            disabled={downloading || !finalAssemblyId}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold bg-white/5 border border-white/10 text-white/55 hover:bg-white/8 transition-all disabled:opacity-40"
          >
            {downloading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading…</>
              : <><Download className="w-3.5 h-3.5" /> Download (no captions)</>}
          </button>

          <button
            onClick={() => void handleExportWithCaptions()}
            disabled={captionExportState === "rendering"}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold bg-[#00D4FF]/10 border border-[#00D4FF]/25 text-[#00D4FF] hover:bg-[#00D4FF]/18 transition-all disabled:opacity-50"
          >
            {captionExportState === "rendering"
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Rendering with captions…</>
              : captionExportState === "done"
                ? <><Check className="w-3.5 h-3.5" /> Done — click to re-download</>
                : <><Film className="w-3.5 h-3.5" /> Export with {captionPreset.charAt(0).toUpperCase() + captionPreset.slice(1)} captions</>}
          </button>
        </div>

        <button
          onClick={() => {
            setFinalVideoUrl(null);
            setError(null);
            setAssemblies([]);
            setCompletedStages(new Set());
            setPhase("assembling");
            assemblyAutoRetryCountRef.current = 0;
            void startAssembly(true);
          }}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-semibold text-white/35 hover:text-white/60 border border-white/8 hover:border-white/15 bg-transparent transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Re-assemble with latest settings
        </button>
      </div>
    );
  }

  // ── Complete but no landscape URL yet (other formats still rendering) ──────
  if (phase === "complete" && !finalVideoUrl) {
    return (
      <div className="mt-4 pt-4 border-t border-white/8 p-4 rounded-xl bg-[#00E676]/6 border border-[#00E676]/20">
        <p className="text-sm font-bold text-[#00E676]">Commercial delivered</p>
        <p className="text-xs text-white/50 mt-1">Refresh the page to view and download your commercial.</p>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (phase === "error") {
    const scenesAllDone = scenes.length > 0 && scenes.every(s => s.status === "succeed");
    return (
      <div className="mt-4 pt-4 border-t border-white/8 space-y-3">
        <div className="rounded-xl bg-red-500/8 border border-red-500/25 p-4">
          <div className="flex items-start gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-red-400">Production couldn't complete</p>
              <p className="text-[10px] text-white/45 mt-0.5 break-words">{error ?? "Something went wrong on our end. Give it another try."}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {scenesAllDone ? (
              <button
                onClick={() => {
                  setError(null);
                  setAssemblies([]);
                  setPhase("assembling");
                  assemblyAutoRetryCountRef.current = 0;
                  void startAssembly(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-[#00D4FF]/15 hover:bg-[#00D4FF]/25 text-[#00D4FF] border border-[#00D4FF]/25 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Retry Assembly
              </button>
            ) : (
              <button
                onClick={() => {
                  startedRef.current = false;
                  assemblyAutoRetryCountRef.current = 0;
                  setPhase("idle");
                  setError(null);
                  setCompletedStages(new Set());
                  setScenes([]);
                  setAssemblies([]);
                  setElapsedSec(0);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/25 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Try Again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Production in progress ─────────────────────────────────────────────────
  const currentStageObj = STAGES.find(s => s.id === currentStage) ?? STAGES[0]!;

  return (
    <div className="mt-4 pt-4 border-t border-white/8 space-y-4">

      {/* Header: progress + ETA */}
      <div className="rounded-xl bg-[#00D4FF]/5 border border-[#00D4FF]/15 px-4 py-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            >
              <Loader2 className="w-3.5 h-3.5 text-[#00D4FF]" />
            </motion.div>
            <span className="text-xs font-bold text-[#00D4FF]">Producing your commercial…</span>
          </div>
          <div className="flex items-center gap-3">
            {etaMinutes > 0 && (
              <div className="flex items-center gap-1 text-[10px] text-white/30">
                <Clock className="w-3 h-3" />
                <span>{formatETA(etaMinutes)} remaining</span>
              </div>
            )}
            <span className="text-[10px] text-white/25 tabular-nums">{formatElapsed(elapsedSec)}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #00E676, #00D4FF)" }}
              initial={{ width: "0%" }}
              animate={{ width: `${overallPct}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-white/25">
            <span>{currentStageObj.label}</span>
            <span>{overallPct}%</span>
          </div>
        </div>
      </div>

      {/* Scene grid — shown once scene generation starts */}
      {scenes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider">
              Scenes in Production · {scenes.filter(s => s.status === "succeed").length}/{scenes.length} filmed
            </p>
            {activeSceneCount > 0 && (
              <span className="text-[9px] text-[#00D4FF]/70">{activeSceneCount} filming in parallel</span>
            )}
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {scenes.map(scene => (
              <SceneTile key={scene.id} scene={scene} />
            ))}
          </div>
        </div>
      )}

      {/* Stage list */}
      <div className="space-y-0.5 max-h-64 overflow-y-auto scrollbar-thin">
        {STAGES.map((stage, i) => {
          const isComplete_ = completedStages.has(stage.id);
          const isActive = stage.id === currentStage && !isComplete_;
          const isPending = !isComplete_ && !isActive;
          const isFinalComplete = stage.id === "complete" && phase === "complete";
          const Icon = stage.icon;

          return (
            <motion.div
              key={stage.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className={`flex items-start gap-3 px-3 py-2 rounded-xl transition-all duration-400 ${
                isComplete_ || isFinalComplete
                  ? "bg-[#00E676]/5 border border-[#00E676]/15"
                  : isActive
                  ? "bg-white/4 border border-white/12"
                  : "bg-transparent border border-transparent"
              }`}
            >
              {/* Icon bubble */}
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                isComplete_ ? "bg-[#00E676] text-black"
                : isActive ? "bg-white/10 border-2 border-[#00D4FF]/50"
                : "bg-white/4 border border-white/8"
              }`}>
                {isComplete_ ? (
                  <Check className="w-3 h-3" />
                ) : isActive ? (
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full bg-[#00D4FF]"
                    animate={{ scale: [1, 1.5, 1] }}
                    transition={{ repeat: Infinity, duration: 1.3 }}
                  />
                ) : (
                  <Icon className="w-3 h-3 text-white/15" />
                )}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium transition-colors leading-tight ${
                  isComplete_ ? "text-[#00E676]"
                  : isActive ? "text-white"
                  : "text-white/20"
                }`}>
                  {stage.label}
                </p>
                <AnimatePresence>
                  {isActive && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-[10px] text-white/35 mt-0.5 leading-snug"
                    >
                      {stage.detail}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>

              {/* Status badge */}
              <div className="shrink-0 mt-0.5">
                {isComplete_ && <span className="text-[9px] text-[#00E676]/50">done</span>}
                {isActive && <span className="text-[9px] text-white/25">running…</span>}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-white/20 text-center">
        AI scene production takes 8–15 min per scene. You can safely leave this page — your commercial keeps running in the background.
      </p>
    </div>
  );
}

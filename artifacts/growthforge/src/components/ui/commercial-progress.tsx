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

import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, AlertCircle, RefreshCw, Download, ExternalLink,
  Loader2, Clock, Film, Music, Sparkles, BarChart2,
  Target, FileText, Clapperboard, MessageSquare, Play,
  RotateCcw, X, Lock as LockIcon,
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
  | "rendering" | "music" | "captions" | "finalizing" | "complete";

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
  { id: "captions",   label: "Adding Captions",               detail: "Burning in clean, bold captions frame-synced to your commercial's timeline…",               icon: MessageSquare, weight: 5 },
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
      else if (["rendering","music","captions","finalizing"].includes(stage.id)) pct += stage.weight * (assemblyProgress / 100) * 0.7;
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

function SceneTile({
  scene,
  onRetry,
  retrying,
}: {
  scene: SceneRecord;
  onRetry: (id: number) => void;
  retrying: number | null;
}) {
  const name = scene.sceneName ?? `Scene ${scene.sceneIndex + 1}`;
  const isActive = scene.status === "submitted" || scene.status === "processing";
  const isSuccess = scene.status === "succeed";
  const isFailed = scene.status === "failed";
  const isPending = scene.status === "pending";
  const isRetrying = retrying === scene.id;
  const isRetryCapped = isFailed && scene.retryCount >= MAX_SCENE_RETRIES;

  return (
    <div className={`relative rounded-xl border p-2.5 transition-all duration-500 ${
      isSuccess  ? "border-[#00E676]/30 bg-[#00E676]/6"
      : isFailed  ? "border-red-500/30 bg-red-500/6"
      : isActive  ? "border-[#00D4FF]/25 bg-[#00D4FF]/5"
      : "border-white/6 bg-white/2"
    }`}>
      {/* Status icon */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center mx-auto mb-1.5 ${
        isSuccess ? "bg-[#00E676] text-black"
        : isFailed ? "bg-red-500/20 border border-red-500/40"
        : isActive ? "bg-[#00D4FF]/15 border border-[#00D4FF]/30"
        : "bg-white/5 border border-white/10"
      }`}>
        {isSuccess ? <Check className="w-3 h-3" />
          : isFailed ? <X className="w-2.5 h-2.5 text-red-400" />
          : isActive ? (
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-[#00D4FF]"
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
              transition={{ repeat: Infinity, duration: 1.4 }}
            />
          ) : <div className="w-1.5 h-1.5 rounded-full bg-white/15" />}
      </div>

      {/* Label */}
      <p className={`text-[9px] font-semibold text-center truncate ${
        isSuccess ? "text-[#00E676]" : isFailed ? "text-red-400" : isActive ? "text-[#00D4FF]" : "text-white/30"
      }`}>
        {name.split(" — ")[1] ?? name}
      </p>

      {/* Retry count badge */}
      {scene.retryCount > 0 && !isFailed && (
        <p className="text-[8px] text-white/25 text-center mt-0.5">retry #{scene.retryCount}</p>
      )}

      {/* Retry button */}
      {isFailed && (
        isRetryCapped ? (
          <p className="mt-1.5 text-[8px] text-red-400/60 text-center">Limit reached</p>
        ) : (
          <button
            onClick={() => onRetry(scene.id)}
            disabled={isRetrying}
            className="mt-1.5 w-full flex items-center justify-center gap-1 px-1.5 py-1 rounded-lg text-[8px] font-bold bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/25 transition-colors disabled:opacity-50"
          >
            {isRetrying
              ? <Loader2 className="w-2 h-2 animate-spin" />
              : <RotateCcw className="w-2 h-2" />}
            {isRetrying ? "…" : `Retry${scene.retryCount > 0 ? ` (${scene.retryCount}/${MAX_SCENE_RETRIES})` : ""}`}
          </button>
        )
      )}
    </div>
  );
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
}

interface Props {
  video: CommercialProgressVideo;
  projectId: number;
  captionsEnabled?: boolean;
  isTrial?: boolean;
  onBack?: () => void;
}

type Phase = "idle" | "blueprint" | "scenes" | "assembling" | "complete" | "error";

export default function CommercialProductionProgress({ video, projectId, captionsEnabled = true, isTrial = false, onBack }: Props) {
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
  const [retryingScene, setRetryingScene] = useState<number | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

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
          await startAssembly();
          return;
        }

        // Any scene failed (but not all — per-scene retry keeps others running)
        // We stay in scenes phase and let the user retry
      } catch (err) {
        if (!mountedRef.current) return;
        // Non-fatal — just keep polling
      }
      await new Promise(r => setTimeout(r, INTERVAL));
    }
  }, [apiBase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Assembly trigger ───────────────────────────────────────────────────────
  const startAssembly = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/assemble`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outputFormats: ["landscape"],
          captionsEnabled,
          transitionType: "fade",
          transitionDuration: 0.5,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Assembly start failed (${r.status})`);
      }
      // Kick off assembly polling
      await pollAssembly();
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "Assembly failed to start";
      setError(msg);
      setPhase("error");
    }
  }, [apiBase, captionsEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Assembly polling with simulated sub-stages ─────────────────────────────
  const pollAssembly = useCallback(async () => {
    const INTERVAL = 6_000;
    const assemblySubStages: StageId[] = ["rendering", "music", "captions", "finalizing"];
    let subStageIdx = 0;

    while (mountedRef.current) {
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
          const landscapeAssembly = data.assemblies.find(
            a => a.outputFormat === "landscape" && a.status === "complete" && a.videoUrl,
          );
          const url = landscapeAssembly?.videoUrl ?? null;

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

        if (data.overallStatus === "failed") {
          const firstError = data.assemblies.find(a => a.errorMessage)?.errorMessage;
          throw new Error(firstError ?? "Assembly failed");
        }
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : "Assembly error";
        setError(msg);
        setPhase("error");
        return;
      }
      await new Promise(r => setTimeout(r, INTERVAL));
    }
  }, [apiBase]);

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
      const r = await fetch(`${apiBase}/scenes/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  // ── Per-scene retry ────────────────────────────────────────────────────────
  const retryScene = useCallback(async (sceneId: number) => {
    setRetryingScene(sceneId);
    try {
      const r = await fetch(`${apiBase}/scenes/${sceneId}/retry`, { method: "POST" });
      if (!r.ok) {
        let msg = `Retry failed (${r.status})`;
        try {
          const body = await r.json() as { error?: string; message?: string };
          msg = body.error ?? body.message ?? msg;
        } catch { /* ignore parse error */ }
        toast({ title: "Scene retry failed", description: msg, variant: "destructive" });
        return;
      }
      // Optimistically update status to pending in local state
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, status: "pending" as const } : s));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error — please try again";
      toast({ title: "Scene retry failed", description: msg, variant: "destructive" });
    } finally {
      setRetryingScene(null);
    }
  }, [apiBase, toast]);

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

  const hasFailedScene = scenes.some(s => s.status === "failed");
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
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(["AI Scene Filming", "Cinematic Transitions", "Scene Captions", "Web-Ready MP4"] as const).map(tag => (
                <span key={tag} className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50">{tag}</span>
              ))}
            </div>
          )}

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

  // ── Complete: show video player ────────────────────────────────────────────
  if (phase === "complete" && finalVideoUrl) {
    return (
      <div className="mt-4 pt-4 border-t border-white/8 space-y-3">
        <div className="rounded-xl overflow-hidden border border-[#00E676]/30 bg-black">
          <video controls className="w-full max-h-52 bg-black" src={finalVideoUrl} />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 rounded-xl bg-[#00E676]/8 border border-[#00E676]/20 px-3 py-2.5">
            <p className="text-xs font-bold text-[#00E676]">Commercial Delivered</p>
            <p className="text-[10px] text-white/40 mt-0.5">30-second commercial · Landscape 1920×1080 · H.264 · Ready to publish</p>
          </div>
          <a
            href={finalVideoUrl}
            download
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/60 border border-white/10 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </a>
          <a
            href={finalVideoUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/60 border border-white/10 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
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
                  void startAssembly();
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-[#00D4FF]/15 hover:bg-[#00D4FF]/25 text-[#00D4FF] border border-[#00D4FF]/25 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Retry Assembly
              </button>
            ) : (
              <button
                onClick={() => {
                  startedRef.current = false;
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
            {hasFailedScene && !allScenesSucceeded && (
              <span className="text-[9px] text-red-400/70">Some scenes need attention — retry individually</span>
            )}
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {scenes.map(scene => (
              <SceneTile
                key={scene.id}
                scene={scene}
                onRetry={retryScene}
                retrying={retryingScene}
              />
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

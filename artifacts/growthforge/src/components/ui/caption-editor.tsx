/**
 * CaptionEditor - the full Veo-era caption editor, ported out of the orphaned
 * commercial-progress.tsx so it persists in the Grok Commercial Studio.
 *
 * Everything the caption setup had then, unchanged:
 *   - Edit / Play modes (paused = selected transcript segment as a real sample;
 *     playing = frame-accurate time-synced captions via requestAnimationFrame)
 *   - Transcript segment selector
 *   - Drag-to-move + drag-to-resize handles (pointer capture, safe-area clamps)
 *   - Karaoke word-level live preview
 *   - Unclear-speech review + correction (PUT /transcript)
 *   - Theater mode (CSS-only fullscreen overlay - never native video fullscreen)
 *   - 8 curated styles mirroring ffmpegAssembler CAPTION_STYLES
 *   - localStorage persistence of style/position/scale
 *
 * The only deliberate change vs. the old component: export goes through the
 * post-render FFmpeg caption endpoint (zero AI), instead of the legacy
 * assembly-time /assemble burn-in.
 */

import { useState, useEffect, useCallback, useRef, useMemo, forwardRef, useImperativeHandle, type CSSProperties } from "react";
import {
  AlertCircle, Download, Loader2, Play, Type,
  Maximize, Minimize, X as CloseIcon,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CaptionTranscriptSegment {
  text?: string;
  startSec?: number;
  endSec?: number;
  confidence?: number;
  timingSource?: "estimated" | "manual";
  reviewed?: boolean;
}

export type CaptionPreset =
  | "clean" | "boldPop" | "karaoke" | "neonGlow" | "cinematic"
  | "gradientChip" | "retroVHS" | "socialBubble";

const CAPTION_PRESET_ORDER: CaptionPreset[] = [
  "clean", "boldPop", "karaoke", "neonGlow", "cinematic", "gradientChip", "retroVHS", "socialBubble",
];

const CAPTION_PRESET_LABELS: Record<CaptionPreset, string> = {
  clean: "Clean", boldPop: "Bold Pop", karaoke: "Karaoke", neonGlow: "Neon Glow",
  cinematic: "Cinematic", gradientChip: "Gradient Chip", retroVHS: "Retro VHS", socialBubble: "Social Bubble",
};

const KARAOKE_HIGHLIGHT_COLOR = "#00E676";

/** Mirrors ffmpegAssembler CAPTION_STYLES.sizeMul so the preview font matches export. */
const CAPTION_SIZE_MUL: Record<CaptionPreset, number> = {
  clean: 1.0, boldPop: 1.15, karaoke: 1.05, neonGlow: 1.05,
  cinematic: 0.9, gradientChip: 0.95, retroVHS: 1.05, socialBubble: 1.0,
};

/** Base text styling for each preset (position/size are applied separately). */
const CAPTION_PRESET_STYLES: Record<CaptionPreset, CSSProperties> = {
  clean: {
    color: "#FFFFFF", fontWeight: 600,
    textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, -2px 0 0 #000, 2px 0 0 #000",
  },
  boldPop: {
    color: "#FFEA00", fontWeight: 900,
    textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000",
  },
  karaoke: {
    color: "#FFFFFF", fontWeight: 800,
    textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",
  },
  neonGlow: {
    color: "#00FFFF", fontWeight: 800,
    textShadow: "0 0 8px rgba(0,255,255,0.85), -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff",
  },
  cinematic: {
    color: "rgba(255,255,255,0.92)", fontStyle: "italic", fontWeight: 400,
    textShadow: "0 2px 10px rgba(0,0,0,0.95), 0 0 30px rgba(0,0,0,0.6)",
  },
  gradientChip: {
    color: "#FFFFFF", fontWeight: 700,
    background: "linear-gradient(135deg, #e9479b, #7c3aed)",
    padding: "4px 12px", borderRadius: "8px", boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
  },
  retroVHS: {
    color: "#FFEA00", fontWeight: 800, fontStyle: "italic", textTransform: "uppercase",
    textShadow: "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000",
  },
  socialBubble: {
    color: "#FFFFFF", fontWeight: 700, background: "#1f3d99",
    padding: "4px 12px", borderRadius: "14px", boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
  },
};

// ── Caption layout (responsive safe-area) ─────────────────────────────────────
// Shared between the browser preview and the FFmpeg export so captions wrap and
// stay inside the frame identically everywhere. KEEP IN SYNC with
// artifacts/api-server/src/lib/dialogue.ts.
const CAPTION_SAFE_MARGIN_X = 0.02;
const CAPTION_SAFE_MARGIN_TOP = 0.02;
const CAPTION_SAFE_MARGIN_BOTTOM = 0.02;
const CAPTION_NOMINAL_HALF_WIDTH = 0.10;
const CAPTION_NOMINAL_HALF_HEIGHT = 0.02;
const CAPTION_SCALE_MIN = 0.25;
const CAPTION_SCALE_MAX = 3.0;

function captionMaxCharsPerLine(aspect: number): number {
  if (aspect >= 1.3) return 34;   // 16:9 landscape
  if (aspect >= 0.85) return 30;  // 1:1 / 4:5
  return 26;                      // 9:16 vertical
}

function captionMaxWidthRatio(aspect: number): number {
  if (aspect >= 1.3) return 0.88;
  if (aspect >= 0.85) return 0.84;
  return 0.80;
}

function clampCaptionX(x: number, scale: number = 1): number {
  const halfW = CAPTION_NOMINAL_HALF_WIDTH * Math.max(0.25, scale);
  const lo = CAPTION_SAFE_MARGIN_X + halfW;
  const hi = 1 - CAPTION_SAFE_MARGIN_X - halfW;
  if (lo > hi) return 0.5;
  return Math.min(hi, Math.max(lo, x));
}

function clampCaptionY(y: number, scale: number = 1): number {
  const halfH = CAPTION_NOMINAL_HALF_HEIGHT * Math.max(0.25, scale);
  const lo = CAPTION_SAFE_MARGIN_TOP + halfH;
  const hi = 1 - CAPTION_SAFE_MARGIN_BOTTOM - halfH;
  if (lo > hi) return 0.5;
  return Math.min(hi, Math.max(lo, y));
}

/** Hard clamp matching the FFmpeg export (buildAssDocument): keep the caption
 * CENTRE inside the safe half-width/height so an 80%-wide line (or a 3-line
 * block) can never hang off a frame edge, even when dragged to a corner. */
function hardClampCaptionCenter(x: number, y: number, scale: number, aspect: number): { x: number; y: number } {
  const maxWidthRatio = captionMaxWidthRatio(aspect);
  const halfW = maxWidthRatio / 2;
  const cx = Math.min(1 - halfW, Math.max(halfW, clampCaptionX(x, scale)));
  const halfH = 3 * 0.0198 * scale * aspect;
  const cy = Math.min(1 - halfH, Math.max(halfH, clampCaptionY(y, scale)));
  return { x: cx, y: cy };
}

const CAPTION_X_MIN = 0;
const CAPTION_X_MAX = 1;
const CAPTION_Y_MIN = 0;
const CAPTION_Y_MAX = 1;

function getCaptionOverlayStyle(x: number, y: number, scale: number, preset: CaptionPreset, aspect: number): CSSProperties {
  const { x: cx, y: cy } = hardClampCaptionCenter(x, y, scale, aspect);
  const maxWidthPct = (captionMaxWidthRatio(aspect) * 100).toFixed(1);
  return {
    position: "absolute",
    left: `${cx * 100}%`,
    top: `${cy * 100}%`,
    transform: `translate(-50%, -50%) scale(${scale})`,
    width: `${maxWidthPct}%`,
    maxWidth: `${maxWidthPct}%`,
    textAlign: "center",
    lineHeight: 1.45,
    letterSpacing: "0.01em",
    fontSize: `${(3.5 * (CAPTION_SIZE_MUL[preset] ?? 1)).toFixed(2)}cqw`,
    whiteSpace: "pre-wrap",
    ...CAPTION_PRESET_STYLES[preset],
  };
}

function clampNum(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

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

/** Wraps karaoke words into display lines so the highlighted-word caption can
 *  never render as one long line spilling past the frame edges (the bug where
 *  the green "current word" caption overflowed the 9:16 video). */
function wrapKaraokeWords(
  words: Array<{ word: string; active: boolean }>,
  maxChars: number,
): Array<Array<{ word: string; active: boolean }>> {
  const lines: Array<Array<{ word: string; active: boolean }>> = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1]!;
    const curLen = cur.reduce((n, x) => n + x.word.length + 1, 0);
    if (curLen + w.word.length > maxChars && cur.length > 0) lines.push([w]);
    else cur.push(w);
  }
  return lines;
}

interface TimedPhrase {
  text: string;
  startSec: number;
  endSec: number;
  words: string[];
}

interface KaraokeSentenceTiming { words: string[]; startSec: number; endSec: number }

/**
 * Global caption lead (seconds). Captions are shifted EARLIER by this amount so
 * the text anticipates the spoken phrase. Single calibration knob for
 * audio/caption sync - tune VITE_CAPTION_LEAD_SEC (frontend build) without
 * regenerating any transcript. Default 0.25s. Applied identically in the
 * browser preview and the FFmpeg export so the two never drift apart.
 * KEEP IN SYNC with the server (CAPTION_LEAD_SEC).
 */
function parseCaptionLead(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0.25;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0.25;
}
const CAPTION_LEAD_SEC = parseCaptionLead((import.meta as { env?: Record<string, string> }).env?.VITE_CAPTION_LEAD_SEC);
const MIN_CAPTION_START_SEC = 0.05;

/**
 * Splits a transcript segment into concise, readable phrase-level captions
 * (max ~32 characters / ~5-7 words) and distributes the segment's start/end
 * window proportionally by word count.
 */
function segmentTextToPhrases(
  text: string,
  startSec: number,
  endSec: number,
  maxChars = 32,
  leadSec = CAPTION_LEAD_SEC,
): TimedPhrase[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  // Shift the whole phrase window earlier by the caption lead so the text leads
  // the audio instead of trailing it. Clamp to a small positive floor so a lead
  // never emits a negative timestamp.
  const effStart = Math.max(MIN_CAPTION_START_SEC, startSec - leadSec);
  const effEnd = Math.max(effStart + 0.1, endSec - leadSec);

  const rawSentences = trimmed.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const phraseList: string[] = [];

  for (const sent of rawSentences) {
    if (sent.length <= maxChars) {
      phraseList.push(sent);
    } else {
      const clauseParts = sent.split(/(?<=[,;:])\s+/).map(c => c.trim()).filter(Boolean);
      for (const cp of clauseParts) {
        if (cp.length <= maxChars) {
          phraseList.push(cp);
        } else {
          const words = cp.split(/\s+/);
          const mid = Math.ceil(words.length / 2);
          const p1 = words.slice(0, mid).join(" ");
          const p2 = words.slice(mid).join(" ");
          if (p1) phraseList.push(p1);
          if (p2) phraseList.push(p2);
        }
      }
    }
  }

  if (phraseList.length === 0) return [];

  const wordsPerPhrase = phraseList.map(p => Math.max(1, p.split(/\s+/).length));
  const totalWords = wordsPerPhrase.reduce((a, b) => a + b, 0);
  const totalDuration = Math.max(0.5, effEnd - effStart);

  const phrases: TimedPhrase[] = [];
  let currStart = effStart;

  for (let i = 0; i < phraseList.length; i++) {
    const pText = phraseList[i]!;
    const wCount = wordsPerPhrase[i]!;
    const dur = (wCount / totalWords) * totalDuration;
    const currEnd = i < phraseList.length - 1 ? currStart + dur : effEnd;

    phrases.push({
      text: pText,
      startSec: Math.round(currStart * 1000) / 1000,
      endSec: Math.round(currEnd * 1000) / 1000,
      words: pText.split(/\s+/).filter(Boolean),
    });
    currStart = currEnd;
  }

  return phrases;
}

/** Builds preview timings from the REVIEWED actual-audio transcript segments
 *  (real timing windows), so the browser preview matches the FFmpeg export -
 *  both are sourced from the transcript, never the voiceover/script. */
function buildTranscriptTimings(
  transcript: CaptionTranscriptSegment[] | null | undefined,
  aspect: number = 0.5625,
): { subtitle: Array<{ text: string; startSec: number; endSec: number }>; karaoke: KaraokeSentenceTiming[] } {
  const segs = (transcript ?? [])
    .filter(x => (x.text ?? "").trim() && typeof x.startSec === "number" && typeof x.endSec === "number");

  const subtitle: Array<{ text: string; startSec: number; endSec: number }> = [];
  const karaoke: KaraokeSentenceTiming[] = [];
  const maxChars = captionMaxCharsPerLine(aspect);

  for (const seg of segs) {
    const rawText = seg.text!.trim();
    const phrases = segmentTextToPhrases(rawText, seg.startSec!, seg.endSec!, 32);
    for (const p of phrases) {
      subtitle.push({
        text: wrapCaptionText(p.text, maxChars),
        startSec: p.startSec,
        endSec: p.endSec,
      });
      karaoke.push({
        words: p.words,
        startSec: p.startSec,
        endSec: p.endSec,
      });
    }
  }

  return { subtitle, karaoke };
}

/** Which word within an active karaoke sentence is "live" right now. */
function activeKaraokeWordIndex(entry: KaraokeSentenceTiming, t: number): number {
  const span = entry.endSec - entry.startSec;
  const totalChars = entry.words.reduce((sum, w) => sum + w.length, 0) || 1;
  let wt = entry.startSec;
  for (let i = 0; i < entry.words.length; i++) {
    const isLast = i === entry.words.length - 1;
    const share = Math.max(0.12, (entry.words[i]!.length / totalChars) * span);
    const wEnd = isLast ? entry.endSec : wt + share;
    if (t < wEnd || isLast) return i;
    wt = wEnd;
  }
  return entry.words.length - 1;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  projectId: number;
  videoId: number;
  /** URL of the completed render to preview + composite onto. */
  videoUrl: string;
  /** Reviewed actual-audio transcript (falls back to fetching /script if absent). */
  dialogueTranscript?: CaptionTranscriptSegment[] | null;
  script?: string | null;
  voiceover?: string | null;
  title?: string | null;
  /** Latest post-render assembly id (logo or caption), so passes chain. */
  baseAssemblyId?: number | null;
  /** Called after a successful caption export with the new assembly id + url. */
  onExported?: (info: { assemblyId: number; videoUrl: string; baseAssemblyId: number | null }) => void;
  /** Reports the live caption toggle + applied assembly upward, so the parent
   * page can offer ONE download button that honours whichever overlays (logo
   * and/or captions) are currently switched on. */
  onStateChange?: (state: { captionsEnabled: boolean; exportAssemblyId: number | null }) => void;
}

/** Imperative handle so the parent can burn captions as part of a single
 * "download with everything the toggles ask for" action. */
export interface CaptionEditorHandle {
  applyCaptions: (opts?: { baseOverride?: number | null }) => Promise<number | null>;
}

const CaptionEditor = forwardRef<CaptionEditorHandle, Props>(function CaptionEditor({
  projectId, videoId, videoUrl, dialogueTranscript, script, voiceover, title,
  baseAssemblyId = null, onExported, onStateChange,
}: Props, ref) {
  const apiBase = `/api/projects/${projectId}/videos/${videoId}`;

  // ── Caption editor state (post-render, browser-side) ───────────────────────
  // Default OFF ("leave blank") - captions are entirely opt-in.
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>("clean");
  // Normalized to the full video frame, 0..1 - (0.5, 0.85) = centered, near the bottom.
  const [captionX, setCaptionX] = useState(0.5);
  const [captionY, setCaptionY] = useState(0.85);
  const [captionScale, setCaptionScale] = useState(1.0);

  // Edit vs Play caption modes: PAUSED = editing (shows the SELECTED transcript
  // segment as a real sample); PLAYING = live time-synced captions (hidden
  // outside speech intervals). Never a generic placeholder.
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [editSegmentIndex, setEditSegmentIndex] = useState(0);
  // Intrinsic aspect ratio (videoWidth/videoHeight) - used to size the stage so
  // the caption overlay anchors to the VISIBLE video rect, not pillarbox/letterbox.
  const [videoAspect, setVideoAspect] = useState<number | null>(null);

  const derivedSegments = useMemo(() => {
    const { subtitle } = buildTranscriptTimings(dialogueTranscript, videoAspect ?? 0.5625);
    // Never turn screenplay/stage directions into a caption. No timed transcript
    // means no overlay; the editor below explains how to enable real captions.
    return subtitle;
  }, [dialogueTranscript, script, voiceover, videoAspect]);

  // Track state for transcript corrections
  const [localTranscript, setLocalTranscript] = useState<CaptionTranscriptSegment[] | null>(dialogueTranscript ?? null);
  useEffect(() => {
    setLocalTranscript(dialogueTranscript ?? null);
    if (!dialogueTranscript && videoId && projectId) {
      fetch(`${apiBase}/script`, { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (Array.isArray(d?.transcript) && d.transcript.length > 0) {
            setLocalTranscript(d.transcript);
          }
        })
        .catch(() => {});
    }
  }, [dialogueTranscript, videoId, projectId, apiBase]);

  const activeSegments = useMemo(() => {
    const { subtitle } = buildTranscriptTimings(localTranscript, videoAspect ?? 0.5625);
    if (subtitle.length > 0) return subtitle;
    return [];
  }, [localTranscript, derivedSegments, videoAspect]);

  const [currentCaptionText, setCurrentCaptionText] = useState<string | null>(null);
  const [currentKaraokeWords, setCurrentKaraokeWords] = useState<Array<{ word: string; active: boolean }> | null>(null);

  // Unclear speech review state
  const unclearSegmentIndex = useMemo(() => {
    return (localTranscript ?? []).findIndex(s => /\[(?:unclear|inaudible|mumbled|\?)\]/i.test(s.text ?? ""));
  }, [localTranscript]);
  const unclearSegment = unclearSegmentIndex >= 0 ? localTranscript![unclearSegmentIndex] : null;
  const [correctionText, setCorrectionText] = useState("");
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);

  useEffect(() => {
    if (unclearSegment) {
      setCorrectionText(unclearSegment.text?.replace(/\[(?:unclear|inaudible|mumbled|\?)\]/gi, "").replace(/\s+/g, " ").trim() ?? "");
    }
  }, [unclearSegment]);

  // Export state
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportAssemblyId, setExportAssemblyId] = useState<number | null>(null);
  // Cached captioned render - reused across clicks while settings are unchanged.
  const exportFingerprintRef = useRef<string | null>(null);
  const lastBaseAssemblyRef = useRef<number | null>(baseAssemblyId);

  // Custom "theater mode" fullscreen - a CSS-only, full-viewport overlay used
  // INSTEAD of the browser's native Fullscreen API. Mobile browsers commonly
  // force native video fullscreen into landscape orientation regardless of the
  // video's own aspect ratio, which pillarboxes (and visually rotates) portrait
  // 9:16 videos. Theater mode sidesteps that entirely: it never calls
  // requestFullscreen(), so there's no OS/browser orientation lock - the video
  // simply fills the current viewport at its own aspect ratio via
  // object-fit: contain, correctly edge-to-edge for 9:16 on a portrait phone.
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStageRef = useRef<HTMLDivElement>(null);
  const subtitleTimingsRef = useRef<Array<{ text: string; startSec: number; endSec: number }>>([]);
  const karaokeTimingsRef = useRef<KaraokeSentenceTiming[]>([]);
  // Mirrors of drag-related state so pointer-move handlers always read the
  // latest values without needing to be re-created (and re-attached) every render.
  const captionXRef = useRef(0.5);
  const captionYRef = useRef(0.85);
  const captionScaleRef = useRef(1.0);
  const videoAspectRef = useRef<number>(0.5625);
  useEffect(() => { videoAspectRef.current = videoAspect ?? 0.5625; }, [videoAspect]);
  useEffect(() => { captionXRef.current = captionX; }, [captionX]);
  useEffect(() => { captionYRef.current = captionY; }, [captionY]);
  useEffect(() => { captionScaleRef.current = captionScale; }, [captionScale]);

  // Persist caption settings across refresh.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gf-caption-settings");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.captionPreset) setCaptionPreset(saved.captionPreset);
        if (typeof saved.captionX === "number") setCaptionX(saved.captionX);
        if (typeof saved.captionY === "number") setCaptionY(saved.captionY);
        if (typeof saved.captionScale === "number") setCaptionScale(saved.captionScale);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("gf-caption-settings", JSON.stringify({ captionPreset, captionX, captionY, captionScale }));
    } catch { /* ignore */ }
  }, [captionPreset, captionX, captionY, captionScale]);

  // Lock page scroll while theater mode is open, and allow Escape to close it.
  useEffect(() => {
    if (!isTheaterMode) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setIsTheaterMode(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [isTheaterMode]);

  // Any settings change invalidates the cached captioned render so the next
  // Apply re-renders with the latest position/size/style.
  const invalidateExportCache = useCallback(() => {
    exportFingerprintRef.current = null;
  }, []);

  // A new upstream pass (e.g. logo applied after captions) changes the base
  // assembly - our previous captioned render no longer reflects it.
  useEffect(() => {
    if (lastBaseAssemblyRef.current !== baseAssemblyId) {
      lastBaseAssemblyRef.current = baseAssemblyId;
      invalidateExportCache();
      setExportUrl(null);
      setExportAssemblyId(null);
    }
  }, [baseAssemblyId, invalidateExportCache]);

  // ── Replay a transcript segment (for unclear-speech review) ────────────────
  const handleReplaySegment = useCallback((startSec?: number, endSec?: number, speed = 1.0) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = startSec ?? 0;
    v.playbackRate = speed;
    void v.play();
    if (typeof endSec === "number") {
      const checkEnd = () => {
        if (v.currentTime >= endSec) {
          v.pause();
          v.playbackRate = 1.0;
          v.removeEventListener("timeupdate", checkEnd);
        }
      };
      v.addEventListener("timeupdate", checkEnd);
    }
  }, []);

  // ── Caption overlay timing ─────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const buildTimings = () => {
      const aspect = (v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : 0.5625;
      const { subtitle, karaoke } = buildTranscriptTimings(localTranscript ?? dialogueTranscript, aspect);
      subtitleTimingsRef.current = subtitle;
      karaokeTimingsRef.current = karaoke;
      if (v.videoWidth && v.videoHeight) setVideoAspect(aspect);
    };

    // Frame-accurate caption sync. The browser's `timeupdate` event fires only
    // ~4x/sec, so a caption could appear up to ~250ms after the audio it belongs
    // to. A requestAnimationFrame loop while playing reads `currentTime` every
    // frame so captions flip exactly as the spoken phrase begins. State is only
    // touched when the caption text or the karaoke active word actually changes,
    // so this never re-renders React once per frame.
    let lastCaptionText: string | null = null;
    let lastKaraokeKey: string | null = null;
    const syncCaption = (t: number) => {
      const entry = subtitleTimingsRef.current.find(e => t >= e.startSec && t < e.endSec) ?? null;
      const text = entry?.text ?? null;
      if (text !== lastCaptionText) {
        lastCaptionText = text;
        setCurrentCaptionText(text);
      }

      const kEntry = karaokeTimingsRef.current.find(e => t >= e.startSec && t < e.endSec) ?? null;
      if (!kEntry) {
        if (lastKaraokeKey !== null) {
          lastKaraokeKey = null;
          setCurrentKaraokeWords(null);
        }
        return;
      }
      const activeIdx = activeKaraokeWordIndex(kEntry, t);
      const key = `${kEntry.startSec}:${activeIdx}`;
      if (key !== lastKaraokeKey) {
        lastKaraokeKey = key;
        setCurrentKaraokeWords(kEntry.words.map((word, i) => ({ word, active: i === activeIdx })));
      }
    };

    const onPlay = () => setIsVideoPlaying(true);
    const onPause = () => setIsVideoPlaying(false);
    const onTimeUpdate = () => {
      setIsVideoPlaying(!v.paused);
      syncCaption(v.currentTime);
    };

    let rafId = 0;
    const tick = () => {
      if (v.paused) { rafId = 0; return; }
      syncCaption(v.currentTime);
      rafId = requestAnimationFrame(tick);
    };
    const startRaf = () => { if (!rafId) rafId = requestAnimationFrame(tick); };
    const stopRaf = () => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } };
    const onPlayWithRaf = () => { onPlay(); startRaf(); };
    const onPauseWithRaf = () => { onPause(); stopRaf(); };

    v.addEventListener("loadedmetadata", buildTimings);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("seeked", onTimeUpdate);
    v.addEventListener("play", onPlayWithRaf);
    v.addEventListener("pause", onPauseWithRaf);
    buildTimings();
    onTimeUpdate(); // seed from the current position so paused/scrubbed preview is correct

    return () => {
      stopRaf();
      v.removeEventListener("loadedmetadata", buildTimings);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("seeked", onTimeUpdate);
      v.removeEventListener("play", onPlayWithRaf);
      v.removeEventListener("pause", onPauseWithRaf);
    };
  }, [videoUrl, dialogueTranscript, localTranscript, isTheaterMode]);

  // ── Caption drag / resize ───────────────────────────────────────────────────
  const handleCaptionDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const stage = videoStageRef.current;
    if (!stage) return;
    // Pointer capture is the key fix for the "jumps all over the place" touch
    // behavior: without it, a fast finger drag can slide off the tiny handle
    // element, at which point the browser hands the gesture to whatever's
    // now underneath (often triggering a native scroll/zoom) instead of
    // keeping it locked to this handle for the rest of the drag.
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = stage.getBoundingClientRect();
    const startPointerX = e.clientX;
    const startPointerY = e.clientY;
    const startX = captionXRef.current;
    const startY = captionYRef.current;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startPointerX) / rect.width;
      const dy = (ev.clientY - startPointerY) / rect.height;
      const { x: nx, y: ny } = hardClampCaptionCenter(startX + dx, startY + dy, captionScaleRef.current, videoAspectRef.current);
      setCaptionX(nx);
      setCaptionY(ny);
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      invalidateExportCache();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [invalidateExportCache]);

  const handleCaptionResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Same pointer-capture fix as the drag handle above - locks the entire
    // drag gesture to this handle so it can't be hijacked by a native
    // scroll/zoom gesture mid-drag on touch devices.
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startPointerY = e.clientY;
    const startScale = captionScaleRef.current;

    const onMove = (ev: PointerEvent) => {
      const dy = startPointerY - ev.clientY; // drag the handle up to grow, down to shrink
      setCaptionScale(clampNum(startScale + dy / 140, CAPTION_SCALE_MIN, CAPTION_SCALE_MAX));
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      invalidateExportCache();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [invalidateExportCache]);

  /** Fully resets the caption editor - position, size, AND style - back to
   * the default "clean" look, so a client who's been experimenting can get
   * back to a plain, regular caption in one click. */
  const handleResetCaptionPosition = useCallback(() => {
    setCaptionX(0.5);
    setCaptionY(0.85);
    setCaptionScale(1.0);
    setCaptionPreset("clean");
    invalidateExportCache();
  }, [invalidateExportCache]);

  // ── Unclear-speech correction (persists via PUT /transcript) ───────────────
  const handleSaveCorrection = useCallback(async (index: number, newText: string) => {
    if (!localTranscript) return;
    setIsSavingCorrection(true);
    try {
      const updated = localTranscript.map((seg, i) => {
        if (i !== index) return seg;
        return { ...seg, text: newText, reviewed: true };
      });
      const res = await fetch(`${apiBase}/transcript`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segments: updated }),
      });
      if (res.ok) {
        const data = await res.json();
        setLocalTranscript(data.transcript ?? updated);
        invalidateExportCache();
      }
    } catch { /* non-fatal */ }
    finally { setIsSavingCorrection(false); }
  }, [apiBase, localTranscript, invalidateExportCache]);

  // ── Post-render FFmpeg caption burn (no AI) ────────────────────────────────
  const handleApplyCaptions = useCallback(async (opts?: { baseOverride?: number | null }): Promise<number | null> => {
    if (exportBusy) return exportAssemblyId;
    // baseOverride lets the parent chain captions onto an assembly it applied
    // moments ago (e.g. a just-burned logo) without waiting for this component
    // to re-render with the new baseAssemblyId prop.
    const base: number | null = opts && "baseOverride" in opts ? (opts.baseOverride ?? null) : baseAssemblyId;
    const fingerprint = `${base ?? "render"}|${captionPreset}|${captionX.toFixed(3)}|${captionY.toFixed(3)}|${captionScale.toFixed(3)}`;
    if (exportUrl && exportAssemblyId && exportFingerprintRef.current === fingerprint) return exportAssemblyId;
    setExportBusy(true);
    setExportError(null);
    try {
      const endpoint = base
        ? `${apiBase}/assemblies/${base}/captions`
        : `${apiBase}/captions`;
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captionPreset, captionX, captionY, captionScale }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.url || !payload.assemblyId) {
        throw new Error(payload.message || payload.error || "Caption export failed");
      }
      exportFingerprintRef.current = fingerprint;
      setExportUrl(payload.url);
      setExportAssemblyId(payload.assemblyId);
      // Reporting the base lets the parent record exactly what this file
      // contains: a burn onto null starts from the untouched render, so it can
      // never carry a logo even if an earlier chain did.
      onExported?.({ assemblyId: payload.assemblyId, videoUrl: payload.url, baseAssemblyId: base });
      return payload.assemblyId as number;
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Caption export failed. Please try again.");
      return null;
    } finally {
      setExportBusy(false);
    }
  }, [apiBase, baseAssemblyId, captionPreset, captionX, captionY, captionScale, exportBusy, exportUrl, exportAssemblyId, onExported]);

  const handleDownload = useCallback(() => {
    if (!exportAssemblyId) return;
    const anchor = document.createElement("a");
    anchor.href = `${apiBase}/assemblies/${exportAssemblyId}/download`;
    anchor.download = `${title ?? "growthforge-video"}-captioned.mp4`;
    anchor.click();
  }, [apiBase, exportAssemblyId, title]);

  useImperativeHandle(ref, () => ({ applyCaptions: handleApplyCaptions }), [handleApplyCaptions]);

  // Keep the parent page informed of the toggle + what has actually been burned,
  // so its single download button can match the toggles exactly.
  useEffect(() => {
    onStateChange?.({ captionsEnabled, exportAssemblyId });
  }, [captionsEnabled, exportAssemblyId, onStateChange]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Show a caption box the moment captions are turned on / a style is picked -
  // never gated on the video actually being mid-playback. While playing, the
  // live time-synced line/word takes over; while paused (or before Play is
  // first pressed) it falls back to the selected segment so clients can
  // position, resize, and preview a style immediately.
  // EDITING (paused): show the SELECTED transcript segment - real text,
  // no placeholder. PLAYING: follow live time-sync, hide outside speech.
  const editingSegment = activeSegments[editSegmentIndex] ?? activeSegments[0] ?? null;
  const activeText = isVideoPlaying ? currentCaptionText : editingSegment?.text ?? null;
  const captionWrapChars = captionMaxCharsPerLine(videoAspect ?? 0.5625);
  const displayCaptionText = captionPreset !== "karaoke" ? activeText : null;
  const displayKaraokeWords = captionPreset === "karaoke"
    ? (isVideoPlaying && currentKaraokeWords?.length
        ? currentKaraokeWords
        : (activeText ? activeText.split(/\s+/).filter(Boolean).map((w, i) => ({ word: w, active: i === 0 })) : null))
    : null;

  return (
    <div className="rounded-xl border border-[#00D4FF]/25 bg-[#06121b] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Type className="h-4 w-4 text-[#00D4FF]" />
        <div>
          <p className="text-sm font-bold text-white">Post-render captions</p>
          <p className="text-[11px] text-white/45">Burn your reviewed transcript onto this finished render - FFmpeg only, no AI re-render.</p>
        </div>
      </div>

      {/* Video player with live, draggable caption preview - exactly what will be exported.
          Theater mode (the outer backdrop below) is a CSS-only full-viewport overlay, used INSTEAD
          of the browser's native Fullscreen API - native video fullscreen on mobile commonly forces
          landscape orientation regardless of the video's own aspect ratio, which is exactly what
          pillarboxed/rotated the 9:16 video in testing. This approach never touches orientation,
          so a 9:16 video fills a portrait phone screen edge-to-edge, exactly as expected. */}
      <div className={isTheaterMode ? "fixed inset-0 z-[999] bg-black flex items-center justify-center" : ""}>
        <div
          ref={videoStageRef}
          className={isTheaterMode ? "relative select-none" : "relative mx-auto rounded-xl overflow-hidden border border-[#00D4FF]/30 bg-black select-none"}
          style={{
            containerType: "inline-size",
            // Always aspect-lock the stage to the video (falling back to 9:16
            // before loadedmetadata reports the real dims) so the caption overlay
            // and video share one rect - never a wider canvas that pillarboxes the
            // 9:16 video and lets the caption spill into the black bars.
            aspectRatio: String(videoAspect ?? 0.5625),
            ...(isTheaterMode
              ? { height: videoAspect ? `min(90vh, ${(90 / videoAspect).toFixed(2)}vw)` : undefined, maxWidth: "90vw", maxHeight: "90vh" }
              : { height: "320px", maxWidth: "100%" }),
          }}
        >
          <video
            ref={videoRef}
            controls
            controlsList="nofullscreen"
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            src={videoUrl}
          />
          <button
            type="button"
            onClick={() => setIsTheaterMode(v => !v)}
            title={isTheaterMode ? "Exit full screen" : "Full screen"}
            className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white border border-white/20 transition-colors"
          >
            {isTheaterMode ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
          {isTheaterMode && (
            <button
              type="button"
              onClick={() => setIsTheaterMode(false)}
              title="Close full screen"
              className="absolute top-2 left-2 z-10 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white border border-white/20 transition-colors"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          )}
          {captionsEnabled && (
            // Outer wrapper is pointerEvents:none so it never blocks the native
            // video controls underneath - only the small drag/resize handles
            // (explicitly pointerEvents:auto below) are actually interactive.
            <div style={{ ...getCaptionOverlayStyle(captionX, captionY, captionScale, captionPreset, videoAspect ?? 0.5625), pointerEvents: "none" }}>
              {/* inline-block so the wrapper shrinks to the actual caption box size -
                  otherwise the drag/resize handles below would anchor to the full
                  (much wider) text-centering column instead of the visible box. */}
              <div style={{ position: "relative", display: "inline-block" }}>
                <div
                  onPointerDown={handleCaptionDragStart}
                  title="Drag to move"
                  style={{
                    position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)",
                    width: 24, height: 16, borderRadius: 4, background: "rgba(0,0,0,0.6)",
                    border: "1px solid rgba(255,255,255,0.45)", cursor: "grab", pointerEvents: "auto",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#fff",
                    touchAction: "none",
                  }}
                >
                  ⠿
                </div>
                <div style={{ border: "1px dashed rgba(255,255,255,0.35)", borderRadius: "6px", padding: "4px 6px" }}>
                  {displayKaraokeWords ? (
                    <span>
                      {wrapKaraokeWords(displayKaraokeWords, captionWrapChars).map((line, li) => (
                        <span key={li} style={{ display: "block" }}>
                          {line.map((w, i) => (
                            <span key={i} style={{ color: w.active ? KARAOKE_HIGHLIGHT_COLOR : undefined }}>
                              {w.word}{i < line.length - 1 ? " " : ""}
                            </span>
                          ))}
                        </span>
                      ))}
                    </span>
                  ) : (
                    displayCaptionText?.split("\n").map((line, i) => (
                      <span key={i} style={{ display: "block" }}>{line}</span>
                    ))
                  )}
                </div>
                {/* Resize handle - drag to grow/shrink the caption. Always
                    rendered (not conditional on any live text) so it's never
                    missing while captions are on. */}
                <div
                  onPointerDown={handleCaptionResizeStart}
                  title="Drag to resize"
                  style={{
                    position: "absolute", right: -14, bottom: -14, width: 28, height: 28,
                    borderRadius: "50%", background: "rgba(0,0,0,0.35)",
                    pointerEvents: "auto", zIndex: 2, touchAction: "none",
                    display: "flex", alignItems: "center", justifyContent: "center", cursor: "nwse-resize",
                  }}
                >
                  {/* Larger invisible touch target (28px) wrapping a visible 14px green
                      dot - keeps the handle easy to grab on mobile without looking oversized. */}
                  <div style={{
                    width: 14, height: 14, borderRadius: "50%",
                    background: "#00E676", border: "2px solid #051",
                  }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unclear-speech review - blocks export until corrected/accepted. */}
      {unclearSegment && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[10px] font-bold text-amber-300 uppercase tracking-wider">Unclear Actor Speech Detected</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">Review Needed</span>
          </div>
          <p className="text-[10px] text-white/80 leading-snug">
            Segment {unclearSegmentIndex + 1}: <span className="font-mono text-amber-200 bg-black/40 px-1.5 py-0.5 rounded border border-amber-500/20">"{unclearSegment.text}"</span>
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => handleReplaySegment(unclearSegment.startSec, unclearSegment.endSec, 1.0)}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-white text-[10px] font-semibold border border-white/10 transition-all flex items-center gap-1"
            >
              <Play className="w-2.5 h-2.5 text-[#00E676]" /> Replay
            </button>
            <button
              type="button"
              onClick={() => handleReplaySegment(unclearSegment.startSec, unclearSegment.endSec, 0.75)}
              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px] font-semibold border border-amber-500/30 transition-all"
            >
              🐢 0.75x Slow
            </button>
            <button
              type="button"
              onClick={() => handleReplaySegment(unclearSegment.startSec, unclearSegment.endSec, 0.5)}
              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px] font-semibold border border-amber-500/30 transition-all"
            >
              🐢 0.5x Slow
            </button>
          </div>
          <div className="space-y-1.5 pt-1 border-t border-amber-500/20">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={correctionText}
                onChange={e => setCorrectionText(e.target.value)}
                className="flex-1 bg-black/50 border border-white/20 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-[#00E676]"
              />
              <button
                type="button"
                onClick={() => void handleSaveCorrection(unclearSegmentIndex, correctionText)}
                disabled={isSavingCorrection || !correctionText.trim()}
                className="px-2.5 py-1 rounded bg-[#00E676] text-black font-bold text-[10px] hover:bg-[#14F195] transition-all disabled:opacity-40"
              >
                {isSavingCorrection ? "Saving..." : "Save Correction"}
              </button>
            </div>
            <p className="text-[9px] text-amber-300/80 italic leading-snug">
              💡 Note: Editing captions updates subtitles on screen. It does not alter the actor's spoken audio in the clip.
            </p>
          </div>
        </div>
      )}

      {/* Caption editor - post-render, before export. Default is OFF ("leave blank"). */}
      <div className="rounded-xl bg-white/3 border border-white/8 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Type className="w-3 h-3 text-white/50" />
            <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">Captions</span>
          </div>
          <button
            aria-label="Toggle captions"
            onClick={() => setCaptionsEnabled(v => !v)}
            className={`w-8 h-4 rounded-full transition-all relative ${captionsEnabled ? "bg-[#00E676]" : "bg-white/10"}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${captionsEnabled ? "left-4" : "left-0.5"}`} />
          </button>
        </div>
        {captionsEnabled && activeSegments.length === 0 && (
          <p role="status" className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-2 text-[11px] leading-relaxed text-amber-100/80">No timed transcript is available yet. Captions stay blank rather than displaying the screenplay or stage directions. Transcribe and review the actual audio to enable editable captions.</p>
        )}
        {captionsEnabled && (
          <>
            <div>
              <p className="text-[9px] text-white/30 uppercase tracking-wider mb-1.5">Style</p>
              <div className="grid grid-cols-4 gap-1">
                {CAPTION_PRESET_ORDER.map(p => (
                  <button
                    key={p}
                    onClick={() => setCaptionPreset(p)}
                    className={`py-2 rounded text-[9px] font-bold transition-all overflow-hidden ${
                      captionPreset === p
                        ? "bg-[#00E676]/15 border border-[#00E676]/50"
                        : "bg-black/30 border border-white/8 hover:border-white/25"
                    }`}
                  >
                    <span style={{ ...CAPTION_PRESET_STYLES[p], fontSize: "9px", display: "inline-block" }}>
                      {p === "karaoke" ? (
                        <>Kara<span style={{ color: KARAOKE_HIGHLIGHT_COLOR }}>oke</span></>
                      ) : (
                        CAPTION_PRESET_LABELS[p]
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              {activeSegments.length > 0 && <>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[9px] text-white/30 uppercase tracking-wider">Preview segment (paused)</p>
                  <p className="text-[9px] font-semibold text-white/50">{isVideoPlaying ? "Following playback" : `Editing segment ${editSegmentIndex + 1}`}</p>
                </div>
                <div className="flex gap-1 flex-wrap mb-2">
                  {activeSegments.map((seg, i) => (
                    <button
                      key={i}
                      onClick={() => setEditSegmentIndex(i)}
                      title={seg.text}
                      className={`px-2 py-1 rounded text-[9px] font-bold border transition-all ${
                        editSegmentIndex === i ? "bg-[#00E676]/15 border-[#00E676]/50" : "bg-black/30 border-white/8 hover:border-white/25"
                      }`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </>}
              <div className="space-y-1.5">
                <label className="block">
                  <span className="flex justify-between text-[9px] text-white/40"><span>Size</span><span>{Math.round(captionScale * 100)}%</span></span>
                  <input type="range" aria-label="Caption size" min={CAPTION_SCALE_MIN} max={CAPTION_SCALE_MAX} step={0.05} value={captionScale} onChange={e => { setCaptionScale(Number(e.target.value)); invalidateExportCache(); }} className="w-full accent-[#00E676]" />
                </label>
                <label className="block">
                  <span className="flex justify-between text-[9px] text-white/40"><span>Vertical position</span><span>{Math.round(captionY * 100)}%</span></span>
                  <input type="range" aria-label="Caption vertical position" min={CAPTION_Y_MIN} max={CAPTION_Y_MAX} step={0.01} value={captionY} onChange={e => { setCaptionY(Number(e.target.value)); invalidateExportCache(); }} className="w-full accent-[#00E676]" />
                </label>
                <label className="block">
                  <span className="flex justify-between text-[9px] text-white/40"><span>Horizontal position</span><span>{Math.round(captionX * 100)}%</span></span>
                  <input type="range" aria-label="Caption horizontal position" min={CAPTION_X_MIN} max={CAPTION_X_MAX} step={0.01} value={captionX} onChange={e => { setCaptionX(Number(e.target.value)); invalidateExportCache(); }} className="w-full accent-[#00E676]" />
                </label>
              </div>
            </div>
            <div className="flex items-center justify-between pt-0.5">
              <p className="text-[9px] text-white/30">Drag the ⠿ handle above the caption to move it, or the green dot to resize it.</p>
              <button
                onClick={handleResetCaptionPosition}
                className="shrink-0 ml-2 text-[9px] font-semibold text-white/40 hover:text-white/70 transition-colors underline"
              >
                Reset to Clean
              </button>
            </div>
          </>
        )}
      </div>

      {/* Export - post-render FFmpeg burn, no AI charges. */}
      {captionsEnabled && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={exportBusy || !!unclearSegment || activeSegments.length === 0}
            onClick={() => void handleApplyCaptions()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#00D4FF] px-4 py-2 text-xs font-bold text-[#041018] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exportBusy
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Burning captions...</>
              : exportUrl ? "Re-apply captions to updated position" : "Apply captions to render"}
          </button>
          {exportUrl && exportAssemblyId && (
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#00E676]/30 bg-[#00E676]/10 px-3 py-2 text-xs font-semibold text-[#00E676]"
            >
              <Download className="h-3.5 h-3.5" /> Download captioned video
            </button>
          )}
        </div>
      )}
      {captionsEnabled && unclearSegment && (
        <p role="alert" className="text-[10px] text-amber-300">Resolve the unclear segment above before exporting captions.</p>
      )}
      {exportError && <p role="alert" className="text-xs text-red-300">{exportError}</p>}
      {exportUrl && <p role="status" className="text-[10px] text-[#00E676]/80">Captioned render ready. Your original render remains unchanged - apply a logo next to combine both.</p>}
    </div>
  );
});

export default CaptionEditor;

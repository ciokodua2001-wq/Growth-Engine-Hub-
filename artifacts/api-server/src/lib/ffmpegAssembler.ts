/**
 * FFmpeg Commercial Assembly Pipeline
 *
 * Takes completed Kling scene videos from SceneManager and assembles them into
 * a polished, web-optimised MP4 commercial with:
 *   - Frame-rate & resolution normalisation (30fps, yuv420p)
 *   - xfade transitions between scenes
 *   - Brand logo overlay (PNG, corner-positioned)
 *   - ASS scene-name captions timed to the output timeline
 *   - Background music (ducked under narration)
 *   - Optional narration audio sync
 *   - Multi-format output: landscape (16:9), square (1:1), vertical (9:16)
 *   - Web optimisation: H.264 High, CRF 18, `+faststart`
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

// Bundled royalty-free ambient background track (CC0, generated via FFmpeg synthesis).
// Resolved relative to the compiled bundle so it works in both dev and production.
const DEFAULT_MUSIC_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/music/ambient-corporate.mp3",
);

import { db } from "@workspace/db";
import {
  commercialAssembliesTable,
  klingSceneJobsTable,
  videosTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import pino from "pino";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";
import { prepareScript } from "./elevenLabsNarrator.js";

const FFMPEG_BIN = "ffmpeg";
const logger = pino({ name: "ffmpegAssembler" });

// Kling generates 5-second clips; trim them so the assembled commercial hits exactly this target.
const TARGET_OUTPUT_DURATION_SEC = 15;

// ── Output format dimensions ──────────────────────────────────────────────────

export type OutputFormat = "landscape" | "square" | "vertical";
export type TransitionType =
  | "fade"
  | "dissolve"
  | "wipeleft"
  | "wiperight"
  | "slideup"
  | "slidedown";

/** Visual style preset for burned-in captions. */
export type CaptionPreset = "classic" | "box" | "bold" | "neon" | "cinematic";
/** Vertical anchor for burned-in captions. */
export type CaptionPosition = "bottom" | "middle" | "top";

const FORMAT_DIMS: Record<OutputFormat, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  square:    { width: 1080, height: 1080 },
  vertical:  { width: 1080, height: 1920 },
};

// ── Assembly options ──────────────────────────────────────────────────────────

export interface AssemblyOptions {
  /** Formats to produce (default: ["landscape"]). */
  outputFormats?: OutputFormat[];
  /** Transition type between scenes (default: "fade"). */
  transitionType?: TransitionType;
  /** Transition duration in seconds (default: 0.5). */
  transitionDuration?: number;
  /** Signed URL for a brand logo PNG with transparency. */
  logoUrl?: string;
  /** Logo corner position (default: "br" = bottom-right). */
  logoPosition?: "br" | "bl" | "tr" | "tl";
  /** Logo opacity 0–1 (default: 0.85). */
  logoOpacity?: number;
  /** Signed URL for background music audio (MP3/AAC) — mixed at low volume under clip audio. */
  backgroundMusicUrl?: string;
  /**
   * Burn captions into the video pixels (default: false).
   * When false (default) the assembler produces a clean MP4; captions are
   * rendered as a browser overlay in the UI and never baked into the file.
   * Set to true only for explicit "Export with captions" renders.
   */
  captionsEnabled?: boolean;
  /** Caption visual style preset (only used when captionsEnabled=true). */
  captionPreset?: CaptionPreset;
  /** Caption vertical position (only used when captionsEnabled=true). */
  captionPosition?: CaptionPosition;
}

// ── CommercialAssembler ───────────────────────────────────────────────────────

export class CommercialAssembler {
  /**
   * Assembles completed scene videos into one or more final MP4 files.
   * Each requested output format gets its own assembly row in the DB.
   * All formats run sequentially (one FFmpeg process at a time) to avoid
   * exhausting disk / CPU on the host.
   *
   * @param videoId   The video whose scenes to assemble
   * @param assemblyIds  Pre-created assembly row IDs (one per output format)
   * @param options   Assembly configuration
   */
  async assemble(
    videoId: number,
    assemblyIds: number[],
    outputFormats: OutputFormat[],
    options: AssemblyOptions,
  ): Promise<void> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "assembly-"));
    logger.info({ videoId, tmpDir, outputFormats }, "[Assembler] Starting assembly pipeline");

    try {
      // ── 1. Load & validate completed scenes ───────────────────────────────
      const scenes = await db
        .select()
        .from(klingSceneJobsTable)
        .where(eq(klingSceneJobsTable.videoId, videoId))
        .orderBy(klingSceneJobsTable.sceneIndex);

      if (scenes.length === 0) throw new Error("No scene records found for this video");

      const incomplete = scenes.filter(s => s.status !== "succeed");
      if (incomplete.length > 0) {
        throw new Error(
          `${incomplete.length} scene(s) not yet complete: ` +
            incomplete.map(s => `scene #${s.sceneIndex} (${s.status})`).join(", "),
        );
      }

      // ── 1b. Load video record for duration + voiceover text ───────────────
      const [video] = await db
        .select()
        .from(videosTable)
        .where(eq(videosTable.id, videoId));

      // Respect the commercial duration the user selected (15 / 30 / 45 / 60s).
      const targetDuration = Number(video?.duration) || TARGET_OUTPUT_DURATION_SEC;
      // Voiceover/script is used for auto-narration and script-based captions.
      const rawVoiceover =
        (video?.voiceover as string | null) ||
        (video?.script as string | null) ||
        null;

      const sceneCount = scenes.length;
      const rawSceneDuration = scenes[0]?.durationSec ?? 5;
      const transitionDuration = Math.min(options.transitionDuration ?? 0.5, rawSceneDuration * 0.3);
      const transitionType = options.transitionType ?? "fade";
      // Use the full Kling clip duration — trimming clips shorter cuts baked-in
      // narration mid-sentence (Kling v2.6 native audio fills the entire clip).
      // Natural output: n*d - (n-1)*t  e.g. 6×5 - 5×0.5 = 27.5s
      const sceneDuration = rawSceneDuration;
      const totalOutputDuration =
        sceneCount * sceneDuration - (sceneCount - 1) * transitionDuration;

      logger.info(
        { sceneCount, sceneDuration, transitionDuration, totalOutputDuration, targetDuration },
        "[Assembler] Scene timing calculated",
      );

      // ── 2. Download all scene videos to tmp ───────────────────────────────
      const sceneFiles: string[] = [];
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i]!;
        if (!scene.videoUrl) throw new Error(`Scene #${scene.sceneIndex} has no video URL`);

        const filePath = path.join(tmpDir, `scene${i}.mp4`);
        // Always re-sign the stored GCS URL — it may have expired (4-hour TTL).
        const freshSceneUrl = await refreshSignedUrl(scene.videoUrl);
        logger.info(
          { sceneIndex: scene.sceneIndex, url: freshSceneUrl.slice(0, 80) },
          "[Assembler] Downloading scene video",
        );
        await downloadFile(freshSceneUrl, filePath);
        sceneFiles.push(filePath);
      }

      // ── 3. Download optional assets ───────────────────────────────────────
      // Probe the first clip to detect whether Kling generated an audio stream.
      // v2.6 Native Audio clips always have audio; v2.5 clips are silent.
      const clipsHaveAudio = sceneFiles.length > 0
        ? await probeHasAudio(sceneFiles[0]!)
        : false;
      logger.info({ clipsHaveAudio }, "[Assembler] Clip audio probe complete");

      // Detect stored rotation metadata so we can physically transpose pixels in
      // the filter_complex (filter_complex bypasses FFmpeg's auto-rotate).
      const clipRotation = sceneFiles.length > 0
        ? await probeRotation(sceneFiles[0]!)
        : 0;
      logger.info({ clipRotation }, "[Assembler] Clip rotation probe complete");

      let logoFile: string | null = null;
      if (options.logoUrl) {
        logoFile = path.join(tmpDir, "logo.png");
        logger.info("[Assembler] Downloading logo");
        await downloadFile(options.logoUrl, logoFile);
      }

      let musicFile: string | null = null;
      if (options.backgroundMusicUrl) {
        musicFile = path.join(tmpDir, "music.mp3");
        logger.info("[Assembler] Downloading background music");
        await downloadFile(options.backgroundMusicUrl, musicFile);
      } else if (fs.existsSync(DEFAULT_MUSIC_FILE)) {
        // Fall back to bundled ambient track — always add subtle background music
        musicFile = DEFAULT_MUSIC_FILE;
        logger.info("[Assembler] Using default ambient background music");
      }

      // ── 4. Prepare captions (only when explicitly requested for "Export with captions" renders) ──
      // Default behaviour is clean MP4 — captions are shown as a browser overlay in the UI.
      const captionsEnabled = options.captionsEnabled === true;
      const captionPreset: CaptionPreset = options.captionPreset ?? "classic";
      const captionPosition: CaptionPosition = options.captionPosition ?? "bottom";
      // Script text is prepared once; captions are written per-format below.
      const captionsScript = (captionsEnabled && rawVoiceover)
        ? prepareScript(rawVoiceover)
        : null;

      // ── 5. Encode each requested output format ────────────────────────────
      for (let fi = 0; fi < outputFormats.length; fi++) {
        const format = outputFormats[fi]!;
        const assemblyId = assemblyIds[fi]!;
        const { width, height } = FORMAT_DIMS[format];

        // Build script-based subtitle ASS file at this format's resolution.
        // Compute pillarbox/letterbox margins so captions stay within the actual
        // content area when the source clip AR differs from the output AR.
        let formatAssFile: string | null = null;
        if (captionsScript) {
          formatAssFile = path.join(tmpDir, `captions_${format}.ass`);
          const subtitleEntries = buildScriptSubtitles(captionsScript, totalOutputDuration);

          // Parse clip AR ("9:16", "16:9", "1:1") into ratio numbers for margin calc.
          const clipARStr = scenes[0]?.aspectRatio ?? "16:9";
          const [clipARW, clipARH] = clipARStr.split(":").map(Number);
          const { marginX: pillarboxPx } = computePillarboxMargins(
            clipARW ?? 16, clipARH ?? 9, width, height,
          );
          // Add a small inset (3% of output width) beyond the pillarbox boundary
          // so text never bumps right against the content edge.
          const captionMarginLR = Math.max(30, pillarboxPx + Math.round(width * 0.03));

          fs.writeFileSync(formatAssFile, buildSubtitleASS(subtitleEntries, width, height, captionMarginLR, captionPreset, captionPosition));
        }

        const outputPath = path.join(tmpDir, `output_${format}.mp4`);

        logger.info(
          { format, width, height, assemblyId },
          "[Assembler] Starting FFmpeg encode",
        );

        // Mark as processing
        await db
          .update(commercialAssembliesTable)
          .set({ status: "processing", startedAt: new Date(), updatedAt: new Date() })
          .where(eq(commercialAssembliesTable.id, assemblyId));

        try {
          await encodeFormat({
            sceneFiles,
            logoFile,
            clipsHaveAudio,
            clipRotation,
            musicFile,
            assFile: formatAssFile,
            outputPath,
            width,
            height,
            sceneCount,
            sceneDuration,
            transitionDuration,
            transitionType,
            totalOutputDuration,
            logoPosition: options.logoPosition ?? "br",
            logoOpacity: options.logoOpacity ?? 0.85,
          });

          // Upload to object storage
          const outputBuf = fs.readFileSync(outputPath);
          const fileSize = outputBuf.length;
          const videoUrl = await uploadAssembly(outputBuf, videoId, format);

          logger.info(
            { format, assemblyId, fileSize, url: videoUrl.slice(0, 80) },
            "[Assembler] Format complete — uploaded to storage",
          );

          await db
            .update(commercialAssembliesTable)
            .set({
              status: "complete",
              videoUrl,
              durationSec: String(totalOutputDuration.toFixed(2)),
              fileSizeBytes: fileSize,
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(commercialAssembliesTable.id, assemblyId));

          // Update video.videoUrl for the landscape (primary) format
          if (format === "landscape") {
            await db
              .update(videosTable)
              .set({
                videoUrl,
                renderStatus: "complete",
                renderCompletedAt: new Date(),
              })
              .where(eq(videosTable.id, videoId));
          }

          // Clean up per-format output to save disk
          fs.rmSync(outputPath, { force: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ err, format, assemblyId }, "[Assembler] Format encode failed");

          await db
            .update(commercialAssembliesTable)
            .set({
              status: "failed",
              errorMessage: msg.slice(0, 1000),
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(commercialAssembliesTable.id, assemblyId));
        }
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      logger.info({ videoId }, "[Assembler] Temp directory cleaned up");
    }
  }
}

// ── FFmpeg encode per format ──────────────────────────────────────────────────

interface EncodeOptions {
  sceneFiles: string[];
  logoFile: string | null;
  clipsHaveAudio: boolean;
  clipRotation: number;
  musicFile: string | null;
  assFile: string | null;
  outputPath: string;
  width: number;
  height: number;
  sceneCount: number;
  sceneDuration: number;
  transitionDuration: number;
  transitionType: TransitionType;
  totalOutputDuration: number;
  logoPosition: "br" | "bl" | "tr" | "tl";
  logoOpacity: number;
}

async function encodeFormat(opts: EncodeOptions): Promise<void> {
  const {
    sceneFiles,
    logoFile,
    clipsHaveAudio,
    musicFile,
    assFile,
    outputPath,
    width,
    height,
    sceneCount,
    sceneDuration,
    transitionDuration,
    transitionType,
    totalOutputDuration,
    logoPosition,
    logoOpacity,
    clipRotation,
  } = opts;

  const args: string[] = ["-y"];

  // ── Inputs ────────────────────────────────────────────────────────────────
  // Scene video inputs — duration is trimmed inside filter_complex via the
  // trim filter (more reliable than -t before -i when using filter_complex).
  for (const f of sceneFiles) {
    args.push("-i", f);
  }

  // Optional: logo image
  if (logoFile) {
    args.push("-loop", "1", "-i", logoFile);
  }

  // Optional: background music (looped forever, trimmed in filter)
  if (musicFile) {
    args.push("-stream_loop", "-1", "-i", musicFile);
  }

  // ── Input index mapping ───────────────────────────────────────────────────
  let nextInputIdx = sceneCount;
  const logoIdx = logoFile ? nextInputIdx++ : null;
  const musicIdx = musicFile ? nextInputIdx++ : null;

  // ── Build filter_complex ──────────────────────────────────────────────────
  const filters: string[] = [];

  // Step 1: Normalize each scene to target resolution + 30fps.
  // trim+setpts here (not -t before -i) guarantees the filter graph sees
  // exactly sceneDuration seconds of video per clip.
  //
  // filter_complex bypasses FFmpeg's built-in auto-rotate, so we must handle
  // rotation metadata manually.  If the source clips carry a rotation tag
  // (e.g. Kling stores 9:16 as 1920×1080 + rotate=90), we prepend a physical
  // transpose so pixels are correctly oriented before any scaling.
  const trimStr = sceneDuration.toFixed(3);
  const transposePrefix =
    clipRotation === 90  ? "transpose=1," :   // 90° clockwise
    clipRotation === 270 ? "transpose=2," :   // 90° counter-clockwise
    clipRotation === 180 ? "transpose=1,transpose=1," : // 180°
    "";                                        // 0° — no correction needed
  const scaleFilter =
    `trim=duration=${trimStr},setpts=PTS-STARTPTS,${transposePrefix}` +
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,` +
    `fps=30,setsar=1,format=yuv420p`;

  for (let i = 0; i < sceneCount; i++) {
    filters.push(`[${i}:v]${scaleFilter}[v${i}]`);
  }

  // Step 2: xfade transition chain
  // xfade offset for scene pair i→i+1: i * (sceneDuration - transitionDuration)
  let prevLabel = "v0";
  for (let i = 0; i < sceneCount - 1; i++) {
    const offset = (i + 1) * (sceneDuration - transitionDuration);
    const outLabel = i === sceneCount - 2 ? "vcat" : `x${i}${i + 1}`;
    filters.push(
      `[${prevLabel}][v${i + 1}]` +
        `xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${offset.toFixed(3)}` +
        `[${outLabel}]`,
    );
    prevLabel = outLabel;
  }

  // If only one scene, no xfade needed — just rename
  if (sceneCount === 1) {
    filters.push(`[v0]copy[vcat]`);
  }

  // Step 3: Logo overlay (if provided)
  let videoLabel = "vcat";
  if (logoIdx !== null) {
    const logoW = Math.round(width * 0.12);
    const posMap: Record<string, string> = {
      br: `${width - logoW - 20}:${height}-oh-20`,
      bl: `20:${height}-oh-20`,
      tr: `${width - logoW - 20}:20`,
      tl: `20:20`,
    };
    const overlayXY = posMap[logoPosition] ?? posMap.br;

    // Scale logo, apply opacity, then overlay
    const alphaVal = Math.max(0, Math.min(1, logoOpacity)).toFixed(2);
    filters.push(
      `[${logoIdx}:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=${alphaVal}[logo_scaled]`,
    );
    filters.push(`[${videoLabel}][logo_scaled]overlay=${overlayXY}:format=auto:eval=init[vlogo]`);
    videoLabel = "vlogo";
  }

  // Step 4: ASS captions overlay
  if (assFile) {
    const assEscaped = assFile
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    filters.push(`[${videoLabel}]ass='${assEscaped}'[vcap]`);
    videoLabel = "vcap";
  }

  // Final video label (rename to [vout])
  if (videoLabel !== "vout") {
    filters.push(`[${videoLabel}]copy[vout]`);
  }

  // Step 5: Audio mixing (Kling v2.6 Native Audio)
  //
  // Primary path (clipsHaveAudio=true): extract audio from each Kling clip,
  // crossfade between scenes using acrossfade (mirrors video xfade timing),
  // then mix the optional music bed underneath at low volume.
  //
  // Fallback path (clipsHaveAudio=false, e.g. legacy v2.5 clips): use music only.
  const durStr = totalOutputDuration.toFixed(3);
  const trimStr2 = sceneDuration.toFixed(3);

  if (clipsHaveAudio) {
    // Extract + resample audio from each clip
    for (let i = 0; i < sceneCount; i++) {
      filters.push(
        `[${i}:a]aresample=44100,atrim=0:${trimStr2},asetpts=PTS-STARTPTS[a${i}]`,
      );
    }

    // Acrossfade chain — transitions match video xfade duration
    if (sceneCount === 1) {
      filters.push(`[a0]copy[acat]`);
    } else {
      let prevLabel = "a0";
      for (let i = 1; i < sceneCount; i++) {
        const outLabel = i === sceneCount - 1 ? "acat" : `ac${i}`;
        filters.push(
          `[${prevLabel}][a${i}]acrossfade=d=${transitionDuration.toFixed(3)}:c1=tri:c2=tri[${outLabel}]`,
        );
        prevLabel = outLabel;
      }
    }

    // Mix with music bed (low volume) if available, otherwise use clip audio directly
    if (musicIdx !== null) {
      filters.push(`[acat]volume=0.88[aklng]`);
      filters.push(`[${musicIdx}:a]aresample=44100,volume=0.12,apad=whole_dur=${durStr}[mus]`);
      filters.push(
        `[aklng][mus]amix=inputs=2:duration=first:normalize=0,atrim=0:${durStr},asetpts=PTS-STARTPTS[aout]`,
      );
    } else {
      filters.push(`[acat]volume=0.88,atrim=0:${durStr},asetpts=PTS-STARTPTS[aout]`);
    }
  } else if (musicIdx !== null) {
    // Fallback: no clip audio — music only
    filters.push(
      `[${musicIdx}:a]aresample=44100,volume=0.85,atrim=0:${durStr},asetpts=PTS-STARTPTS[aout]`,
    );
  } else {
    // No audio at all — generate silence so FFmpeg doesn't fail the -map [aout]
    filters.push(
      `anullsrc=r=44100:cl=stereo,atrim=0:${durStr},asetpts=PTS-STARTPTS[aout]`,
    );
  }

  // ── Final FFmpeg command ───────────────────────────────────────────────────
  args.push("-filter_complex", filters.join(";\n"));
  args.push("-map", "[vout]");
  args.push("-map", "[aout]");

  // Video codec — H.264, CRF 18 quality, ultrafast preset + zerolatency tune
  // ultrafast disables all compression analysis; zerolatency removes buffering overhead.
  // Together they give maximum encode speed at the cost of ~20% larger file — fine for web delivery.
  // NOTE: ultrafast forces baseline profile so we drop -profile:v high and -level here.
  args.push("-c:v", "libx264");
  args.push("-preset", "ultrafast");
  args.push("-tune", "zerolatency");
  args.push("-crf", "18");
  args.push("-pix_fmt", "yuv420p");

  // Audio codec — AAC 128kbps stereo
  args.push("-c:a", "aac");
  args.push("-b:a", "128k");
  args.push("-ar", "44100");
  args.push("-ac", "2");

  // Web optimisation — moov atom at front (progressive download / streaming)
  args.push("-movflags", "+faststart");

  // Stop encoding when the shortest stream (video) ends — prevents audio overrun
  args.push("-shortest");

  // Explicitly clear rotation metadata on the output so mobile browsers
  // (Chrome Android) don't apply a second rotation on top of the physical
  // pixel correction we already performed via the transpose filter above.
  args.push("-metadata:s:v:0", "rotate=0");

  // No extra duration flag — let the filter_complex determine duration
  args.push(outputPath);

  logger.info(
    { filterCount: filters.length, inputCount: sceneCount + (logoFile ? 1 : 0) + (musicFile ? 1 : 0), clipsHaveAudio },
    "[Assembler] Launching FFmpeg",
  );

  await runFFmpeg(args);
}

// ── ASS caption file builder ──────────────────────────────────────────────────

interface CaptionEntry {
  name: string;  // Scene name, e.g. "HOOK"
  startSec: number;
}

function buildASSCaptions(
  entries: CaptionEntry[],
  videoWidth: number,
  videoHeight: number,
): string {
  const CAPTION_DURATION_S = 2.0;
  const fontSize = Math.max(32, Math.round(videoWidth * 0.028));
  const marginV = Math.max(40, Math.round(videoHeight * 0.06));
  const outline = Math.max(2, Math.round(fontSize * 0.06));
  const shadow = Math.max(1, Math.round(fontSize * 0.03));

  function toAssTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const cs = Math.round((s % 1) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${videoWidth}`,
    `PlayResY: ${videoHeight}`,
    "Collisions: Normal",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Alignment 2 = center-bottom; PrimaryColour = white, BackColour = semi-transparent black
    `Style: Label,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,2,0,3,${outline},${shadow},2,20,20,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = entries
    .map(e => {
      const start = toAssTime(e.startSec);
      const end = toAssTime(e.startSec + CAPTION_DURATION_S);
      // Bold + letter-spaced scene label
      return `Dialogue: 0,${start},${end},Label,,0,0,0,,{\\b1\\fsp3}${e.name}`;
    })
    .join("\n");

  return `${header}\n${events}\n`;
}

// ── Script-based subtitle builder ─────────────────────────────────────────────

interface SubtitleEntry {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Splits a prepared narration script into timed subtitle entries.
 * Timing is estimated proportionally by character count across totalDuration.
 * Lines are word-wrapped at ~40 chars for comfortable mobile reading.
 */
function buildScriptSubtitles(script: string, totalDuration: number): SubtitleEntry[] {
  // Split on sentence boundaries
  const raw = script.replace(/([.!?])\s+/g, "$1\n").split(/\n/).map(s => s.trim()).filter(Boolean);
  if (raw.length === 0) return [];

  const totalChars = raw.reduce((sum, s) => sum + s.length, 0);
  const entries: SubtitleEntry[] = [];
  let currentTime = 0.1;

  for (const sentence of raw) {
    if (currentTime >= totalDuration - 0.3) break;
    // Duration proportional to character count; minimum 1.0s, capped at remaining time
    const estimated = Math.max(1.0, (sentence.length / totalChars) * totalDuration * 0.95);
    const endSec = Math.min(currentTime + estimated, totalDuration - 0.1);
    entries.push({ text: wrapSubtitleLine(sentence, 40), startSec: currentTime, endSec });
    currentTime = endSec + 0.08; // brief gap between subtitle entries
  }

  return entries;
}

function wrapSubtitleLine(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  // ASS uses \N for hard line breaks
  return lines.join("\\N");
}

/**
 * Computes how much of the output frame is actually content (vs. pillarbox/letterbox black)
 * when a source clip with ratio srcW:srcH is scaled to fill outW×outH using
 * force_original_aspect_ratio=decrease + pad (which is what our FFmpeg scale filter does).
 * Returns the pixel margin on each horizontal side (marginX) and vertical side (marginY).
 */
function computePillarboxMargins(
  srcW: number, srcH: number,
  outW: number, outH: number,
): { marginX: number; marginY: number } {
  const scale = Math.min(outW / srcW, outH / srcH);
  const contentW = Math.round(srcW * scale);
  const contentH = Math.round(srcH * scale);
  return {
    marginX: Math.floor((outW - contentW) / 2),
    marginY: Math.floor((outH - contentH) / 2),
  };
}

function buildSubtitleASS(
  entries: SubtitleEntry[],
  videoWidth: number,
  videoHeight: number,
  marginLR: number,
  preset: CaptionPreset = "classic",
  position: CaptionPosition = "bottom",
): string {
  // Base font size; preset multipliers allow relative sizing.
  const baseFontSize = Math.max(38, Math.round(videoWidth * 0.033));
  const sizeMultiplier = preset === "cinematic" ? 0.85 : preset === "bold" ? 1.1 : 1.0;
  const fontSize = Math.round(baseFontSize * sizeMultiplier);
  const baseOutline = Math.max(2, Math.round(fontSize * 0.07));

  // ASS colour format: &HAABBGGRR  (AA=00 → opaque, FF → transparent; colour is BGR)
  // Preset-specific style parameters.
  const STYLES: Record<CaptionPreset, {
    primaryColour: string; outlineColour: string; backColour: string;
    bold: 0 | 1; italic: 0 | 1; borderStyle: 1 | 4;
    outline: number; shadow: number;
  }> = {
    classic:   { primaryColour: "&H00FFFFFF", outlineColour: "&H00000000", backColour: "&H00000000", bold: 0, italic: 0, borderStyle: 1, outline: baseOutline,                                       shadow: 0 },
    box:       { primaryColour: "&H00FFFFFF", outlineColour: "&H00000000", backColour: "&H80000000", bold: 1, italic: 0, borderStyle: 4, outline: 0,                                                   shadow: 0 },
    bold:      { primaryColour: "&H0000FFFF", outlineColour: "&H00000000", backColour: "&H00000000", bold: 1, italic: 0, borderStyle: 1, outline: Math.max(3, baseOutline + 1),                       shadow: 0 },
    neon:      { primaryColour: "&H0076E600", outlineColour: "&H00FFFFFF", backColour: "&H00000000", bold: 1, italic: 0, borderStyle: 1, outline: baseOutline,                                        shadow: 0 },
    cinematic: { primaryColour: "&H00FFFFFF", outlineColour: "&H00000000", backColour: "&H00000000", bold: 0, italic: 1, borderStyle: 1, outline: Math.max(1, Math.round(baseOutline * 0.6)), shadow: Math.max(3, Math.round(fontSize * 0.1)) },
  };
  const s = STYLES[preset];

  // ASS Alignment: bottom=2 (centre-bottom), middle=5 (centre), top=8 (centre-top).
  const alignment = position === "top" ? 8 : position === "middle" ? 5 : 2;
  // marginV: distance from the anchor edge (top or bottom). Ignored for middle (Alignment=5).
  const marginV = position === "middle" ? 0 : Math.max(60, Math.round(videoHeight * 0.07));

  function toAssTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const sv = sec % 60;
    const cs = Math.round((sv % 1) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(sv)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${videoWidth}`,
    `PlayResY: ${videoHeight}`,
    "Collisions: Normal",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},${s.primaryColour},&H000000FF,${s.outlineColour},${s.backColour},${s.bold},${s.italic},0,0,100,100,0,0,${s.borderStyle},${s.outline},${s.shadow},${alignment},${marginLR},${marginLR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = entries
    .map(e => `Dialogue: 0,${toAssTime(e.startSec)},${toAssTime(e.endSec)},Default,,0,0,0,,${e.text}`)
    .join("\n");

  return `${header}\n${events}\n`;
}

// ── Object storage upload ─────────────────────────────────────────────────────

async function uploadAssembly(
  buffer: Buffer,
  videoId: number,
  format: OutputFormat,
): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const objectName = `renders/assembled/video-${videoId}-${format}-${Date.now()}.mp4`;
  const bucket = objectStorageClient.bucket(bucketId);
  await bucket.file(objectName).save(buffer, {
    metadata: { contentType: "video/mp4" },
  });

  logger.info(
    { objectName, bytes: buffer.length },
    "[Assembler] Uploaded assembled video to storage",
  );

  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 86_400 });
}

// ── FFmpeg runner ─────────────────────────────────────────────────────────────

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info({ args: args.slice(0, 8) }, "[Assembler] FFmpeg starting");

    const proc = spawn(FFMPEG_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg assembly timed out after 15 minutes"));
    }, 900_000);

    proc.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        // Last 2000 chars of stderr = most useful FFmpeg error
        const tail = stderr.slice(-2000);
        logger.error({ code, tail }, "[Assembler] FFmpeg exited with non-zero code");
        reject(new Error(`FFmpeg exited ${code}: ${tail}`));
      } else {
        // Log stderr even on success — reveals silent audio/stream warnings
        const stderrTail = stderr.slice(-3000);
        logger.info({ stderrTail }, "[Assembler] FFmpeg completed successfully");
        resolve();
      }
    });

    proc.on("error", err => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

// ── Audio stream probe ────────────────────────────────────────────────────────
// Runs ffprobe to read the stored rotation tag (in degrees: 0, 90, 180, 270).
// Kling sometimes stores portrait clips as 1920×1080 + rotate=90 rather than
// native 1080×1920.  filter_complex bypasses FFmpeg's auto-rotate, so we detect
// this and apply a transpose filter in the normalisation step to physically
// correct the pixel orientation before any scaling.
//
// Two encoding styles exist in the wild:
//   1. Legacy stream tag  — `tags.rotate = "90"` (older Kling / FFmpeg builds)
//   2. displaymatrix      — `side_data_list[*].rotation = -90` (newer builds)
// We probe with -show_streams -of json and check both.

function probeRotation(filePath: string): Promise<number> {
  return new Promise(resolve => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_streams",
      "-of", "json",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => {
      try {
        const parsed = JSON.parse(out) as {
          streams?: Array<{
            tags?: { rotate?: string };
            side_data_list?: Array<{ rotation?: number }>;
          }>;
        };
        const stream = parsed.streams?.[0];
        // 1. Legacy stream tag (most common in Kling v2.5)
        const tagRot = parseInt(stream?.tags?.rotate ?? "", 10);
        if (Number.isFinite(tagRot) && tagRot !== 0) { resolve(tagRot); return; }
        // 2. displaymatrix side data (Kling v2.6+). rotation is stored as negative
        //    of the clockwise angle, e.g. -90 means 90° clockwise → transpose=1.
        const sideRot = stream?.side_data_list?.find(sd => sd.rotation !== undefined)?.rotation;
        if (typeof sideRot === "number" && sideRot !== 0) { resolve(Math.abs(sideRot)); return; }
        resolve(0);
      } catch {
        resolve(0);
      }
    });
    proc.on("error", () => resolve(0));
  });
}

// Runs ffprobe on a file and returns true if it contains at least one audio stream.
// Used to detect whether Kling v2.6 Native Audio generated audio in each clip.

function probeHasAudio(filePath: string): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(out.trim().startsWith("audio")));
    proc.on("error", () => resolve(false));
  });
}

// ── Signed URL refresh ────────────────────────────────────────────────────────
// Kling scene videos are stored in GCS with a short-lived signed URL (4 h TTL).
// By the time the user triggers assembly (especially after a failed first attempt)
// the URL may have expired → HTTP 400.  We re-sign it from the embedded GCS path
// so the assembler always has a fresh URL regardless of when it runs.

async function refreshSignedUrl(storedUrl: string): Promise<string> {
  if (!storedUrl.startsWith("https://storage.googleapis.com/")) return storedUrl;
  try {
    const u = new URL(storedUrl);
    // pathname = "/{bucketName}/{objectName...}"
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return storedUrl;
    const bucketName = parts[0]!;
    const objectName = parts.slice(1).join("/");
    const fresh = await signObjectURL({ bucketName, objectName, method: "GET", ttlSec: 86_400 });
    logger.debug({ objectName }, "[Assembler] Re-signed expired GCS URL");
    return fresh;
  } catch (err) {
    logger.warn({ err }, "[Assembler] Failed to re-sign GCS URL — falling back to stored URL");
    return storedUrl;
  }
}

// ── File download helper ──────────────────────────────────────────────────────

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Download failed HTTP ${res.status}: ${url.slice(0, 80)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  logger.debug({ destPath, bytes: buf.length }, "[Assembler] File downloaded");
}

async function fetchWithRetry(
  url: string,
  maxAttempts = 4,
  baseMs = 2_000,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      const delay = baseMs * 2 ** (attempt - 1) + Math.random() * 500;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ── Availability check ────────────────────────────────────────────────────────

export function checkAssemblerRequirements(): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) missing.push("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  return { ready: missing.length === 0, missing };
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: CommercialAssembler | null = null;
export function getAssembler(): CommercialAssembler {
  if (!_instance) _instance = new CommercialAssembler();
  return _instance;
}

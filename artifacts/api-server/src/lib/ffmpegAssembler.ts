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

import { db } from "@workspace/db";
import {
  commercialAssembliesTable,
  klingSceneJobsTable,
  videosTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import pino from "pino";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";
import { generateNarration, prepareScript } from "./elevenLabsNarrator.js";
import type { VoiceStyle } from "./elevenLabsNarrator.js";

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
  /** Signed URL for background music audio (MP3/AAC). */
  backgroundMusicUrl?: string;
  /** Signed URL for narration audio (MP3/AAC/WAV). */
  narrationUrl?: string;
  /** Show captions burned from the narration script (default: true). */
  captionsEnabled?: boolean;
  /** Voice style for auto-generated narration (default: "corporate"). */
  voiceStyle?: string;
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
      // Trim each clip so the total output hits targetDuration.
      // Formula: total = n*d - (n-1)*t  →  d = (target + (n-1)*t) / n
      const sceneDuration = Math.min(
        rawSceneDuration,
        (targetDuration + (sceneCount - 1) * transitionDuration) / sceneCount,
      );
      const totalOutputDuration =
        sceneCount * sceneDuration - (sceneCount - 1) * transitionDuration;

      logger.info(
        { sceneCount, sceneDuration, transitionDuration, totalOutputDuration, targetDuration },
        "[Assembler] Scene timing calculated",
      );

      // ── Auto-generate narration from script if no URL was provided ─────────
      const voiceStyle = ((options.voiceStyle ?? "corporate") as VoiceStyle);
      let resolvedNarrationUrl = options.narrationUrl;

      if (!resolvedNarrationUrl && rawVoiceover) {
        logger.info({ videoId, voiceStyle }, "[Assembler] Auto-generating narration from script");
        try {
          const narResult = await generateNarration({ script: rawVoiceover, voiceStyle, videoId });
          resolvedNarrationUrl = narResult.narrationUrl;
          logger.info(
            { videoId, provider: narResult.voiceProvider, chars: narResult.scriptChars },
            "[Assembler] Narration generated ✓",
          );
        } catch (err) {
          logger.error({ err, videoId }, "[Assembler] Narration generation failed — assembling without audio");
        }
      }

      // ── 2. Download all scene videos to tmp ───────────────────────────────
      const sceneFiles: string[] = [];
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i]!;
        if (!scene.videoUrl) throw new Error(`Scene #${scene.sceneIndex} has no video URL`);

        const filePath = path.join(tmpDir, `scene${i}.mp4`);
        logger.info(
          { sceneIndex: scene.sceneIndex, url: scene.videoUrl.slice(0, 80) },
          "[Assembler] Downloading scene video",
        );
        await downloadFile(scene.videoUrl, filePath);
        sceneFiles.push(filePath);
      }

      // ── 3. Download optional assets ───────────────────────────────────────
      let logoFile: string | null = null;
      if (options.logoUrl) {
        logoFile = path.join(tmpDir, "logo.png");
        logger.info("[Assembler] Downloading logo");
        await downloadFile(options.logoUrl, logoFile);
      }

      let narrationFile: string | null = null;
      if (resolvedNarrationUrl) {
        narrationFile = path.join(tmpDir, "narration.mp3");
        logger.info("[Assembler] Downloading narration");
        await downloadFile(resolvedNarrationUrl, narrationFile);
      }

      let musicFile: string | null = null;
      if (options.backgroundMusicUrl) {
        musicFile = path.join(tmpDir, "music.mp3");
        logger.info("[Assembler] Downloading background music");
        await downloadFile(options.backgroundMusicUrl, musicFile);
      }

      // ── 4. Prepare captions (generated per-format at the right resolution) ──
      const captionsEnabled = options.captionsEnabled !== false;
      // Script text is prepared once; captions are written per-format below.
      const captionsScript = (captionsEnabled && rawVoiceover)
        ? prepareScript(rawVoiceover)
        : null;

      // ── 5. Encode each requested output format ────────────────────────────
      for (let fi = 0; fi < outputFormats.length; fi++) {
        const format = outputFormats[fi]!;
        const assemblyId = assemblyIds[fi]!;
        const { width, height } = FORMAT_DIMS[format];

        // Build script-based subtitle ASS file at this format's resolution
        let formatAssFile: string | null = null;
        if (captionsScript) {
          formatAssFile = path.join(tmpDir, `captions_${format}.ass`);
          const subtitleEntries = buildScriptSubtitles(captionsScript, totalOutputDuration);
          fs.writeFileSync(formatAssFile, buildSubtitleASS(subtitleEntries, width, height));
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
            narrationFile,
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
  narrationFile: string | null;
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
    narrationFile,
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
  } = opts;

  const args: string[] = ["-y"];

  // ── Inputs ────────────────────────────────────────────────────────────────
  // Scene video inputs — trimmed to sceneDuration so the assembly hits TARGET_OUTPUT_DURATION_SEC
  for (const f of sceneFiles) {
    args.push("-t", sceneDuration.toFixed(3), "-i", f);
  }

  // Optional: logo image
  if (logoFile) {
    args.push("-loop", "1", "-i", logoFile);
  }

  // Optional: narration audio (no loop)
  if (narrationFile) {
    args.push("-i", narrationFile);
  }

  // Optional: background music (looped forever, trimmed in filter)
  if (musicFile) {
    args.push("-stream_loop", "-1", "-i", musicFile);
  }

  // ── Input index mapping ───────────────────────────────────────────────────
  let nextInputIdx = sceneCount;
  const logoIdx = logoFile ? nextInputIdx++ : null;
  const narrationIdx = narrationFile ? nextInputIdx++ : null;
  const musicIdx = musicFile ? nextInputIdx++ : null;

  // ── Build filter_complex ──────────────────────────────────────────────────
  const filters: string[] = [];

  // Step 1: Normalize each scene to target resolution + 30fps
  const scaleFilter =
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

  // Step 5: Audio mixing
  const durStr = totalOutputDuration.toFixed(3);
  if (narrationIdx !== null && musicIdx !== null) {
    // Narration (full volume) + music (ducked to 15%)
    filters.push(
      `[${narrationIdx}:a]volume=1.0,atrim=0:${durStr},asetpts=PTS-STARTPTS[narr]`,
    );
    filters.push(
      `[${musicIdx}:a]volume=0.15,atrim=0:${durStr},asetpts=PTS-STARTPTS[mus]`,
    );
    filters.push(`[narr][mus]amix=inputs=2:duration=first:normalize=0[aout]`);
  } else if (narrationIdx !== null) {
    filters.push(
      `[${narrationIdx}:a]volume=1.0,atrim=0:${durStr},asetpts=PTS-STARTPTS[aout]`,
    );
  } else if (musicIdx !== null) {
    filters.push(
      `[${musicIdx}:a]volume=0.85,atrim=0:${durStr},asetpts=PTS-STARTPTS[aout]`,
    );
  } else {
    // No external audio — use original audio from each Kling scene clip.
    // Each scene clip is trimmed to sceneDuration seconds before aconcat.
    for (let i = 0; i < sceneCount; i++) {
      filters.push(
        `[${i}:a]atrim=0:${sceneDuration.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
      );
    }
    const audioLabels = Array.from({ length: sceneCount }, (_, i) => `[a${i}]`).join("");
    filters.push(
      `${audioLabels}aconcat=n=${sceneCount}:v=0:a=1,` +
      `volume=0.9,atrim=end=${durStr},asetpts=PTS-STARTPTS[aout]`,
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

  // No extra duration flag — let the filter_complex determine duration
  args.push(outputPath);

  logger.info(
    { filterCount: filters.length, inputCount: sceneCount + (logoFile ? 1 : 0) + (narrationFile ? 1 : 0) + (musicFile ? 1 : 0) },
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

function buildSubtitleASS(entries: SubtitleEntry[], videoWidth: number, videoHeight: number): string {
  const fontSize = Math.max(38, Math.round(videoWidth * 0.033));
  const marginV = Math.max(60, Math.round(videoHeight * 0.07));
  const outline = Math.max(2, Math.round(fontSize * 0.07));

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
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Alignment=2: center-bottom. White text, solid black outline for maximum contrast on any background.
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,${outline},0,2,20,20,${marginV},1`,
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
        // Last 1500 chars of stderr = most useful FFmpeg error
        const tail = stderr.slice(-1500);
        logger.error({ code, tail }, "[Assembler] FFmpeg exited with non-zero code");
        reject(new Error(`FFmpeg exited ${code}: ${tail}`));
      } else {
        logger.info("[Assembler] FFmpeg completed successfully");
        resolve();
      }
    });

    proc.on("error", err => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
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

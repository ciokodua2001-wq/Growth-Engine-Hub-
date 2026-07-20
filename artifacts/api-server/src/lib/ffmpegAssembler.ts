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

const FFMPEG_BIN = "ffmpeg";
const logger = pino({ name: "ffmpegAssembler" });

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
  /** Show scene-name captions at the start of each scene (default: true). */
  captionsEnabled?: boolean;
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

      const sceneCount = scenes.length;
      const sceneDuration = scenes[0]?.durationSec ?? 5;
      const transitionDuration = Math.min(options.transitionDuration ?? 0.5, sceneDuration * 0.3);
      const transitionType = options.transitionType ?? "fade";
      const totalOutputDuration =
        sceneCount * sceneDuration - (sceneCount - 1) * transitionDuration;

      logger.info(
        { sceneCount, sceneDuration, transitionDuration, totalOutputDuration },
        "[Assembler] Scene timing calculated",
      );

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
      if (options.narrationUrl) {
        narrationFile = path.join(tmpDir, "narration.mp3");
        logger.info("[Assembler] Downloading narration");
        await downloadFile(options.narrationUrl, narrationFile);
      }

      let musicFile: string | null = null;
      if (options.backgroundMusicUrl) {
        musicFile = path.join(tmpDir, "music.mp3");
        logger.info("[Assembler] Downloading background music");
        await downloadFile(options.backgroundMusicUrl, musicFile);
      }

      // ── 4. Generate ASS captions file (shared across formats) ─────────────
      const captionsEnabled = options.captionsEnabled !== false;
      let assFile: string | null = null;
      if (captionsEnabled && scenes.some(s => s.sceneName)) {
        assFile = path.join(tmpDir, "captions.ass");
        const captionData = scenes.map((s, i) => ({
          name: (s.sceneName ?? `Scene ${i + 1}`).toUpperCase(),
          startSec: i === 0 ? 0.3 : i * (sceneDuration - transitionDuration) + 0.5,
        }));
        fs.writeFileSync(assFile, buildASSCaptions(captionData, 1920, 1080));
      }

      // ── 5. Encode each requested output format ────────────────────────────
      for (let fi = 0; fi < outputFormats.length; fi++) {
        const format = outputFormats[fi]!;
        const assemblyId = assemblyIds[fi]!;
        const { width, height } = FORMAT_DIMS[format];

        // Re-generate the ASS file at the correct resolution for this format
        let formatAssFile: string | null = null;
        if (captionsEnabled && scenes.some(s => s.sceneName)) {
          formatAssFile = path.join(tmpDir, `captions_${format}.ass`);
          const captionData = scenes.map((s, i) => ({
            name: (s.sceneName ?? `Scene ${i + 1}`).toUpperCase(),
            startSec: i === 0 ? 0.3 : i * (sceneDuration - transitionDuration) + 0.5,
          }));
          fs.writeFileSync(formatAssFile, buildASSCaptions(captionData, width, height));
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
  // Scene video inputs
  for (const f of sceneFiles) {
    args.push("-i", f);
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
    // Silent — generate a clean silence track
    filters.push(`anullsrc=r=44100:cl=stereo,atrim=end=${durStr},asetpts=PTS-STARTPTS[aout]`);
  }

  // ── Final FFmpeg command ───────────────────────────────────────────────────
  args.push("-filter_complex", filters.join(";\n"));
  args.push("-map", "[vout]");
  args.push("-map", "[aout]");

  // Video codec — H.264 High profile, CRF 18 (very high quality), yuv420p
  args.push("-c:v", "libx264");
  args.push("-preset", "slow");
  args.push("-crf", "18");
  args.push("-profile:v", "high");
  args.push("-level", "4.0");
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
    // Alignment 7 = top-left; PrimaryColour = white (&H00FFFFFF), BackColour = semi-transparent black (&H80000000)
    `Style: Label,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&HA0000000,-1,0,0,0,100,100,2,0,3,${outline},${shadow},7,30,30,${marginV},1`,
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

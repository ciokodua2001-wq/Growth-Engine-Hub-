import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "@workspace/db";
import { videosTable, projectsTable, assetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { synthesizeSpeech, type NarrationLocale } from "@workspace/integrations-google-tts-server";
import { deductPlatformCredits } from "./platformCredits.js";
import { deductVideoSeconds, refundReservedVideoSeconds, refundRefineVideoSeconds } from "./videoWallet.js";
import { GrokCommercialRenderer, GROK_STORAGE_REFERENCE_PREFIX, assembleVideo } from "./grokRenderer.js";
import { grokBillableSeconds, GROK_EDIT_MAX_SOURCE_SECONDS } from "./grokRequest.js";
import { compositeLogoOnVideo } from "./ffmpegAssembler.js";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";
import type { CommercialAspectRatio, CommercialRenderJob } from "./commercialRenderer.js";

function blueprintLogoAssetId(cinematicPlan: string | null | undefined): number | null {
  if (!cinematicPlan) return null;
  try {
    const plan = JSON.parse(cinematicPlan) as { branding?: { logoAssetId?: unknown } };
    const id = plan.branding?.logoAssetId;
    return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export interface LogoMeta {
  assetId: number | null;
  x: number;
  y: number;
  scale: number;
  /** Stable reference to the render BEFORE any logo was burned in. Refinement
   * edits this logo-free clip so the AI never re-renders (and distorts) the
   * customer's badge, and the logo is re-applied deterministically afterwards. */
  preLogoUrl: string | null;
}

const LOGO_DEFAULTS = { x: 0.82, y: 0.82, scale: 0.2 };

function blueprintLogoMeta(cinematicPlan: string | null | undefined): LogoMeta {
  if (!cinematicPlan) return { assetId: null, ...LOGO_DEFAULTS, preLogoUrl: null };
  try {
    const plan = JSON.parse(cinematicPlan) as {
      branding?: {
        logoAssetId?: unknown;
        logoPlacement?: { x?: unknown; y?: unknown; scale?: unknown };
        preLogoVideoUrl?: unknown;
      };
    };
    const b = plan.branding ?? {};
    const finite = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
    const id = typeof b.logoAssetId === "number" && Number.isInteger(b.logoAssetId) && b.logoAssetId > 0
      ? b.logoAssetId : null;
    return {
      assetId: id,
      x: finite(b.logoPlacement?.x, LOGO_DEFAULTS.x),
      y: finite(b.logoPlacement?.y, LOGO_DEFAULTS.y),
      scale: typeof b.logoPlacement?.scale === "number" && Number.isFinite(b.logoPlacement.scale)
        ? Math.min(1, Math.max(0.02, b.logoPlacement.scale)) : LOGO_DEFAULTS.scale,
      preLogoUrl: typeof b.preLogoVideoUrl === "string" && b.preLogoVideoUrl ? b.preLogoVideoUrl : null,
    };
  } catch {
    return { assetId: null, ...LOGO_DEFAULTS, preLogoUrl: null };
  }
}

/** Merge logo placement / pristine-source pointers into cinematic_plan without
 * disturbing the shot list stored alongside them. */
async function persistLogoMeta(
  videoId: number,
  planRaw: string | null | undefined,
  patch: { preLogoUrl?: string; placement?: { x: number; y: number; scale: number } },
): Promise<void> {
  let plan: Record<string, unknown> = {};
  if (planRaw) {
    try { plan = JSON.parse(planRaw) as Record<string, unknown>; } catch { plan = {}; }
  }
  const branding = (plan.branding && typeof plan.branding === "object")
    ? plan.branding as Record<string, unknown> : {};
  if (patch.preLogoUrl) branding.preLogoVideoUrl = patch.preLogoUrl;
  if (patch.placement) branding.logoPlacement = patch.placement;
  plan.branding = branding;
  await db.update(videosTable).set({ cinematicPlan: JSON.stringify(plan) }).where(eq(videosTable.id, videoId));
}

const FFMPEG_BIN = "ffmpeg";

const logger = pino({ name: "videoRenderPipeline" });

// ── Render constants ──────────────────────────────────────────────────────────
const KLING_CLIP_DURATION_S = 5;
const CLIP_BATCH_SIZE = 5;

// ── API constants ─────────────────────────────────────────────────────────────
const KLING_BASE_URL = "https://api-singapore.klingai.com";
const KLING_DEFAULT_MODEL = "kling-v2-5-turbo";
const KLING_MODE = "std";
const KLING_NEGATIVE_PROMPT =
  "blurry, low quality, distorted, ugly, pixelated, amateur, watermark, text overlay, " +
  // Gibberish-text-on-screens mitigation (kept identical to klingRenderer.ts).
  "gibberish text, random letters, scrambled characters, corrupted typography, fake writing, " +
  "readable computer screen, readable phone screen, readable dashboard, legible software interface, " +
  "subtitles, captions, letterboxed words, extra limbs, extra arms, extra hands, missing limbs, deformed hands, fused fingers, more than five fingers, wrong number of limbs, detached hands";

const SCREEN_SAFE_SUFFIX =
  "Any computer monitors, laptop screens, phones, dashboards, or software interfaces visible in frame must be rendered out of focus with only soft light and color gradients, or shown at a steep angle where no content is readable. Never render legible or invented text, letters, numbers, or UI labels on any screen surface.";

// ── Google Cloud TTS voice resolution ─────────────────────────────────────────
// Chirp 3: HD speaker names - shared across locales (en-CA / fr-CA), so the
// same "character" can narrate in either language.
const VOICE_SPEAKER_MALE   = "Charon";
const VOICE_SPEAKER_FEMALE = "Kore";
const NARRATION_LOCALE: NarrationLocale = "en-CA";

function resolveVoiceName(characterDescription?: string | null): string {
  const envOverride = process.env.GOOGLE_TTS_VOICE_NAME;
  if (envOverride) return envOverride;

  let genderHint: "male" | "female" | null = null;
  if (characterDescription) {
    const desc = characterDescription.toLowerCase();
    const femaleScore = ["female", "woman", "girl", "she/her", " she ", " her ", "latina", "asian"].filter(s => desc.includes(s)).length;
    const maleScore   = ["male", "man", " guy ", "he/him", " he ", " his ", "gentleman", "father"].filter(s => desc.includes(s)).length;
    if (femaleScore > maleScore) genderHint = "female";
    else if (maleScore > femaleScore) genderHint = "male";
  }

  const speaker = genderHint === "female" ? VOICE_SPEAKER_FEMALE : VOICE_SPEAKER_MALE;
  return `${NARRATION_LOCALE}-Chirp3-HD-${speaker}`;
}

// ── Public types ──────────────────────────────────────────────────────────────

export type RenderResolution = "1080p" | "4k";
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export interface RenderRequirementsResult {
  ready: boolean;
  missing: string[];
}

export function checkGrokRenderRequirements(): RenderRequirementsResult {
  const missing: string[] = [];
  if (process.env.GROK_VIDEO_ENABLED !== "true") missing.push("GROK_VIDEO_ENABLED=true (Grok remains disabled by default)");
  if (!process.env.GROWTHFORGE_GROK_API_KEY) missing.push("GROWTHFORGE_GROK_API_KEY");
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) missing.push("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  if (!process.env.OBJECT_STORAGE_ENDPOINT) missing.push("OBJECT_STORAGE_ENDPOINT");
  if (!process.env.OBJECT_STORAGE_REGION) missing.push("OBJECT_STORAGE_REGION");
  if (!process.env.OBJECT_STORAGE_ACCESS_KEY_ID) missing.push("OBJECT_STORAGE_ACCESS_KEY_ID");
  if (!process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY) missing.push("OBJECT_STORAGE_SECRET_ACCESS_KEY");
  if (!(Number(process.env.GROK_VIDEO_COST_PER_SECOND_USD) > 0)) missing.push("GROK_VIDEO_COST_PER_SECOND_USD (required for explicit cost estimate)");
  return { ready: missing.length === 0, missing };
}

export function checkRenderRequirements(): RenderRequirementsResult {
  // Compatibility shim: legacy readiness callers must never enable Kling.
  return checkGrokRenderRequirements();
}

// ── Public entry point ────────────────────────────────────────────────────────

export function startVideoRender(
  videoId: number,
  resolution: RenderResolution,
  aspectRatio: AspectRatio = "16:9",
  captionsEnabled = false,
  provider: "kling" | "grok" = "kling",
): void {
  const operation = provider === "grok"
    ? runGrokRender(videoId, resolution, aspectRatio)
    : runRenderPipeline(videoId, resolution, aspectRatio, captionsEnabled);
  operation.catch((err) => {
    logger.error({ err, videoId }, "Render pipeline unhandled error");
    void markFailed(videoId, "An unexpected error occurred. Please try again - your credits were not charged.");
  });
}

async function runGrokRender(videoId: number, resolution: RenderResolution, aspectRatio: AspectRatio): Promise<void> {
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) throw new Error(`Video ${videoId} not found`);
  const [project] = await db.select({ ownerId: projectsTable.ownerId }).from(projectsTable).where(eq(projectsTable.id, video.projectId));
  const ownerUserId = project?.ownerId ?? null;
  await db.update(videosTable).set({ renderStatus: "processing", renderResolution: resolution, renderStartedAt: new Date(), renderError: null }).where(eq(videosTable.id, videoId));
  let chargedDuration = grokBillableSeconds(video.duration);
  try {
    // The editable full script is authoritative. Do not append per-shot
    // dialogue from the original blueprint, which can be stale after an edit.
    const script = [video.script, video.approvedScript, video.voiceover, video.title].find(value => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
    const renderJob: CommercialRenderJob = {
      videoId, resolution, aspectRatio: aspectRatio as CommercialAspectRatio, captionsEnabled: false,
      script,
      storyboard: video.storyboard, cinematicPlan: video.cinematicPlan,
      durationSec: Math.min(60, Math.max(1, video.duration ?? 15)),
    };
    const result = await new GrokCommercialRenderer().render(renderJob);
    if (result.durationSec && Number.isFinite(result.durationSec)) chargedDuration = grokBillableSeconds(video.duration, result.durationSec);
    let finalVideoUrl = result.videoUrl;
    const blueprintLogoId = blueprintLogoAssetId(video.cinematicPlan);
    if (blueprintLogoId) {
      const composited = await applyBlueprintLogo(videoId, video.projectId, blueprintLogoId, result.videoUrl);
      if (composited) finalVideoUrl = composited;
    }
    await db.update(videosTable).set({ renderStatus: "complete", videoUrl: finalVideoUrl, duration: chargedDuration, renderCompletedAt: new Date(), captionsEnabled: false, fidelityStatus: "unverified" }).where(eq(videosTable.id, videoId));
  } catch (error) {
    logger.error({ err: error, videoId }, "Grok render failed");
    await markFailed(videoId, "Grok generation failed. No automatic retry was attempted; reserved video seconds were returned.");
    if (ownerUserId) {
      try {
        await refundReservedVideoSeconds(ownerUserId, Number.MAX_SAFE_INTEGER, videoId, video.projectId, "Grok generation failed; reservation returned");
      } catch (refundError) {
        logger.error({ err: refundError, ownerUserId, videoId }, "Failed to return Grok reservation; reconciliation required");
      }
    }
    return;
  }

  // The wallet was reserved before provider submission; refund any unused
  // seconds when the completed video is shorter than the estimate.
  if (ownerUserId && chargedDuration < grokBillableSeconds(video.duration)) {
    try {
      await refundReservedVideoSeconds(ownerUserId, grokBillableSeconds(video.duration) - chargedDuration, videoId, video.projectId, "Unused Grok reservation returned after shorter completed clip");
    } catch (error) {
      logger.error({ err: error, ownerUserId, videoId }, "Grok clip completed but unused reservation refund failed; reconciliation required");
    }
  }
}

async function markFailed(videoId: number, error: string): Promise<void> {
  await db.update(videosTable).set({
    renderStatus: "failed",
    renderError: error,
    renderCompletedAt: new Date(),
  }).where(eq(videosTable.id, videoId));
}

async function grokRefToSignedUrl(ref: string): Promise<string> {
  if (!ref.startsWith(GROK_STORAGE_REFERENCE_PREFIX)) return ref;
  const storedRef = ref.slice(GROK_STORAGE_REFERENCE_PREFIX.length);
  const slash = storedRef.indexOf("/");
  if (slash <= 0) throw new Error("Invalid Grok storage reference");
  const bucket = decodeURIComponent(storedRef.slice(0, slash));
  const key = storedRef.slice(slash + 1).split("/").map(decodeURIComponent).join("/");
  return signObjectURL({ bucketName: bucket, objectName: key, method: "GET", ttlSec: 300 });
}

function refreshSignedObjectUrl(storedUrl: string): Promise<string> {
  if (!storedUrl || !storedUrl.startsWith("http")) return Promise.resolve(storedUrl);
  try {
    const u = new URL(storedUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return Promise.resolve(storedUrl);
    return signObjectURL({ bucketName: parts[0]!, objectName: parts.slice(1).map(decodeURIComponent).join("/"), method: "GET", ttlSec: 86_400 });
  } catch {
    return Promise.resolve(storedUrl);
  }
}

/** Best-effort post composite of a blueprint-attached transparent logo. Returns
 * the new stable grok-object:// reference, or null (never fails the render). */
async function applyBlueprintLogo(videoId: number, projectId: number, logoAssetId: number, videoUrl: string): Promise<string | null> {
  try {
    const [current] = await db.select({ cinematicPlan: videosTable.cinematicPlan }).from(videosTable).where(eq(videosTable.id, videoId));
    const meta = blueprintLogoMeta(current?.cinematicPlan);
    const [asset] = await db.select().from(assetsTable).where(eq(assetsTable.id, logoAssetId));
    if (!asset?.url || asset.mimeType?.toLowerCase() !== "image/png") return null;
    const logoUrl = await refreshSignedObjectUrl(asset.url);
    const logoRes = await fetch(logoUrl, { signal: AbortSignal.timeout(20_000) });
    if (!logoRes.ok) throw new Error(`Logo asset unavailable (${logoRes.status})`);
    const logo = Buffer.from(await logoRes.arrayBuffer());
    const inputUrl = await grokRefToSignedUrl(videoUrl);
    const composite = await compositeLogoOnVideo(inputUrl, logo, { projectId, videoId, x: meta.x, y: meta.y, scale: meta.scale });
    const compositeRes = await fetch(composite.url, { signal: AbortSignal.timeout(120_000) });
    if (!compositeRes.ok) throw new Error(`Composited video download failed (${compositeRes.status})`);
    const compositeBuffer = Buffer.from(await compositeRes.arrayBuffer());
    const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucket) throw new Error("Object storage is not configured");
    const key = `commercial/grok/${videoId}/logo/${Date.now()}.mp4`;
    await objectStorageClient.bucket(bucket).file(key).save(compositeBuffer, { metadata: { contentType: "video/mp4" } });
    const ref = `grok-object://${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
    // Remember the logo-free render and the exact placement, so a later refine
    // edits the pristine clip and the badge is re-applied by ffmpeg (never by AI).
    await persistLogoMeta(videoId, current?.cinematicPlan, {
      preLogoUrl: videoUrl,
      placement: { x: meta.x, y: meta.y, scale: meta.scale },
    });
    logger.info({ videoId, logoAssetId, x: meta.x, y: meta.y, scale: meta.scale }, "Blueprint logo composited onto completed render");
    return ref;
  } catch (error) {
    logger.error({ err: error, videoId, logoAssetId }, "Blueprint logo composite failed; keeping render without logo");
    return null;
  }
}

// ── Core render pipeline ──────────────────────────────────────────────────────

async function runRenderPipeline(
  videoId: number,
  resolution: RenderResolution,
  aspectRatio: AspectRatio = "16:9",
  captionsEnabled = false,
): Promise<void> {
  // Retired multi-provider pipeline: fail before any legacy vendor call.
  throw new Error("Legacy video pipeline is decommissioned; use the Grok-only Commercial Studio route");
}

// ── Google Cloud TTS ──────────────────────────────────────────────────────────

async function generateGoogleVoiceover(text: string, voiceName: string): Promise<string> {
  const cappedText = text.length > 800 ? text.slice(0, 800) + "..." : text;

  const audioBuffer = await withRetry(() =>
    synthesizeSpeech({ text: cappedText, voiceName, locale: NARRATION_LOCALE, format: "mp3" }),
  );

  return await uploadAudioToStorage(audioBuffer, "mp3");
}

// ── Kling AI Direct API (api-singapore.klingai.com) ───────────────────────────

interface KlingTaskData {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg?: string;
  task_result?: { videos?: Array<{ id: string; url: string; duration: string }> };
}

interface KlingApiResponse {
  code: number;
  message: string;
  request_id?: string;
  data: KlingTaskData;
}

function klingAspectRatio(ar: AspectRatio): string {
  if (ar === "4:5") return "9:16";
  return ar;
}

async function submitKlingT2V(prompt: string, aspectRatio: AspectRatio): Promise<string> {
  const apiKey = process.env.KLING_API_KEY;
  if (!apiKey) throw new Error("KLING_API_KEY not configured");

  const res = await fetch(`${KLING_BASE_URL}/v1/videos/text2video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: KLING_DEFAULT_MODEL,
      prompt,
      negative_prompt: KLING_NEGATIVE_PROMPT,
      duration: "5",
      mode: KLING_MODE,
      aspect_ratio: klingAspectRatio(aspectRatio),
      sound: "off",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kling submit HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as KlingApiResponse;
  if (json.code !== 0) throw new Error(`Kling submit error (code=${json.code}): ${json.message}`);
  return json.data.task_id;
}

async function pollKlingTask(taskId: string): Promise<string> {
  const apiKey = process.env.KLING_API_KEY!;
  const MAX_POLLS = 90;
  const POLL_INTERVAL_MS = 10_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const taskData = await withRetry(async () => {
      const res = await fetch(`${KLING_BASE_URL}/v1/videos/text2video/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Kling poll HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = (await res.json()) as KlingApiResponse;
      if (json.code !== 0) throw new Error(`Kling poll error (code=${json.code}): ${json.message}`);
      return json.data;
    });

    if (taskData.task_status === "succeed") {
      const videoUrl = taskData.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error(`Kling returned succeed but no video URL (task=${taskId})`);
      const videoRes = await withRetry(() => fetch(videoUrl, { signal: AbortSignal.timeout(120_000) }));
      if (!videoRes.ok) throw new Error(`Kling video download HTTP ${videoRes.status}`);
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      return await uploadVideoToStorage(buffer);
    }
    if (taskData.task_status === "failed") {
      throw new Error(`Kling generation failed: ${taskData.task_status_msg ?? "unknown"}`);
    }
  }

  throw new Error("Kling video generation timed out after 15 minutes");
}

async function generateKlingT2V(prompt: string, aspectRatio: AspectRatio = "16:9"): Promise<string> {
  const taskId = await withRetry(() => submitKlingT2V(prompt, aspectRatio));
  return await pollKlingTask(taskId);
}

// ── FFmpeg Composition ────────────────────────────────────────────────────────

interface FFmpegComposeOptions {
  voiceoverUrl: string;
  footageUrls: string[];
  duration: number;
  resolution: RenderResolution;
  aspectRatio: AspectRatio;
  captionsEnabled: boolean;
  script?: string;
}

async function composeWithFFmpeg(opts: FFmpegComposeOptions): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  try {
    const numSlots = Math.max(1, Math.ceil(opts.duration / KLING_CLIP_DURATION_S));
    const orderedClipUrls: string[] = Array.from({ length: numSlots }, (_, i) =>
      opts.footageUrls[i % opts.footageUrls.length]!
    );

    const clipPaths: string[] = [];
    for (let i = 0; i < orderedClipUrls.length; i++) {
      const res = await fetch(orderedClipUrls[i]!);
      if (!res.ok) throw new Error(`Download clip ${i}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const p = path.join(tmpDir, `clip${i}.mp4`);
      fs.writeFileSync(p, buf);
      clipPaths.push(p);
    }

    const audioRes = await fetch(opts.voiceoverUrl);
    if (!audioRes.ok) throw new Error(`Download voiceover: HTTP ${audioRes.status}`);
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    const audioPath = path.join(tmpDir, "voiceover.mp3");
    fs.writeFileSync(audioPath, audioBuf);

    const concatPath = path.join(tmpDir, "concat.txt");
    fs.writeFileSync(
      concatPath,
      clipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
    );

    const { width, height } = getOutputDimensions(opts.resolution, opts.aspectRatio);
    const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
    const crf = opts.resolution === "4k" ? "18" : "23";
    const outputPath = path.join(tmpDir, "output.mp4");

    let filterComplex: string;
    if (opts.captionsEnabled && opts.script) {
      const assPath = path.join(tmpDir, "captions.ass");
      fs.writeFileSync(assPath, generateASS(opts.script, opts.duration, width, height));
      const assEscaped = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
      filterComplex = `[0:v]${scaleFilter},ass='${assEscaped}'[vout]`;
    } else {
      filterComplex = `[0:v]${scaleFilter}[vout]`;
    }

    await runFFmpeg([
      "-y",
      "-f", "concat", "-safe", "0", "-i", concatPath,
      "-i", audioPath,
      "-filter_complex", filterComplex,
      "-map", "[vout]",
      "-map", "1:a",
      "-c:v", "libx264", "-preset", "fast", "-crf", crf,
      "-c:a", "aac", "-b:a", "192k",
      "-shortest", "-movflags", "+faststart",
      outputPath,
    ]);

    const outBuf = fs.readFileSync(outputPath);
    return await uploadVideoToStorage(outBuf);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── FFmpeg runner ──────────────────────────────────────────────────────────────

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info({ args: args.slice(0, 6) }, "Starting FFmpeg");
    const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg timed out after 10 minutes"));
    }, 600_000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-1000)}`));
      } else {
        resolve();
      }
    });
    proc.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}

// ── Aspect ratio helpers ───────────────────────────────────────────────────────

function getOutputDimensions(resolution: RenderResolution, aspectRatio: AspectRatio): { width: number; height: number } {
  const is4k = resolution === "4k";
  const base: Record<AspectRatio, [number, number]> = {
    "16:9": [1920, 1080],
    "9:16": [1080, 1920],
    "1:1":  [1080, 1080],
    "4:5":  [1080, 1350],
  };
  const [w, h] = base[aspectRatio] ?? [1920, 1080];
  return is4k ? { width: w * 2, height: h * 2 } : { width: w, height: h };
}

// ── ASS Caption generator ──────────────────────────────────────────────────────

function generateASS(script: string, durationSec: number, width: number, height: number): string {
  const clean = script.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(/\s+/).filter(Boolean);

  const WORDS_PER_SEC = 2.5;
  const WORDS_PER_CHUNK = 6;

  const chunks: Array<{ text: string; start: number; end: number }> = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
    const chunk = words.slice(i, i + WORDS_PER_CHUNK).join(" ");
    const startSec = i / WORDS_PER_SEC;
    const endSec = Math.min((i + WORDS_PER_CHUNK) / WORDS_PER_SEC, durationSec);
    if (startSec < durationSec) {
      chunks.push({ text: chunk, start: startSec, end: endSec });
    }
  }

  function toAssTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const cs = Math.round((s % 1) * 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }

  const fontSize = Math.max(36, Math.round(width * 0.042));
  const marginV = Math.max(30, Math.round(height * 0.075));
  const outline = Math.max(2, Math.round(fontSize * 0.05));
  const shadow = Math.max(1, Math.round(fontSize * 0.025));

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "Collisions: Normal",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,20,20,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const events = chunks
    .map(c => `Dialogue: 0,${toAssTime(c.start)},${toAssTime(c.end)},Default,,0,0,0,,{\\b1}${c.text}`)
    .join("\n");

  return `${header}\n${events}\n`;
}

// ── Cinematic plan types ───────────────────────────────────────────────────────

interface CinematicShot {
  shotNumber: number;
  duration: number;
  environment: string;
  subjectAction: string;
  facialExpression: string;
  bodyMovement: string;
  cameraMovement: string;
  lensStyle: string;
  lighting: string;
  visualEffects: string;
  transition: string;
  dialogue?: string;
}

interface CinematicPlan {
  visualStyle: string;
  characterDescription: string;
  environment: string;
  lighting: string;
  cameraLanguage: string;
  performanceDirection: string;
  shots: CinematicShot[];
}

function parseCinematicPlan(json: string | null | undefined): CinematicPlan | null {
  if (!json) return null;
  try { return JSON.parse(json) as CinematicPlan; } catch { return null; }
}

// ── Scene-based clip generation ───────────────────────────────────────────────

function buildScenePrompts(title: string, storyboard: string, count: number, cinematicPlan?: string | null): string[] {
  const plan = parseCinematicPlan(cinematicPlan);

  if (plan?.shots?.length) {
    const stylePrefix = plan.visualStyle
      ? `${plan.visualStyle}. Photorealistic, cinema-grade, Hollywood-quality. `
      : "Photorealistic, cinema-grade, Hollywood-quality. ";
    return Array.from({ length: count }, (_, i) => {
      const shot = plan.shots[i % plan.shots.length]!;
      const parts = [
        stylePrefix,
        shot.environment ? `Location: ${shot.environment}.` : "",
        shot.subjectAction ? `Action: ${shot.subjectAction}.` : "",
        shot.cameraMovement ? `Camera: ${shot.cameraMovement}.` : "",
        shot.lensStyle ? `Lens: ${shot.lensStyle}.` : "",
        shot.lighting ? `Lighting: ${shot.lighting}.` : "",
        shot.visualEffects && !["none", "n/a"].includes(shot.visualEffects.toLowerCase())
          ? `Effects: ${shot.visualEffects}.` : "",
        "Natural motion, shallow depth of field, professional color grading.",
        SCREEN_SAFE_SUFFIX,
      ].filter(Boolean).join(" ");
      // slice() on a string (not the array) was silently capping every scene
      // prompt at 500 chars - long enough to drop the screen-safety suffix.
      return parts;
    });
  }

  const scenes = storyboard
    .split("\n")
    .map(l => l.replace(/^scene\s*\d+[:.]\s*/i, "").trim())
    .filter(l => l.length > 5);
  const base = scenes.length > 0 ? scenes : [`Marketing video for: ${title}`];
  return Array.from({ length: count }, (_, i) => {
    const scene = base[i % base.length] ?? title;
    return `Cinematic marketing footage, professional grade, 4K quality. ${scene.slice(0, 400)} ${SCREEN_SAFE_SUFFIX}`;
  });
}

async function generateFootageClipsT2V(prompts: string[], videoId: number, aspectRatio: AspectRatio = "16:9"): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < prompts.length; i += CLIP_BATCH_SIZE) {
    const batch = prompts.slice(i, i + CLIP_BATCH_SIZE);
    logger.info({ videoId, batchStart: i, batchSize: batch.length, totalClips: prompts.length }, "Generating footage batch (Kling direct)");
    const batchUrls = await Promise.all(batch.map(prompt => generateKlingT2V(prompt, aspectRatio)));
    results.push(...batchUrls);
  }
  return results;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

async function uploadAudioToStorage(buffer: Buffer, format: string): Promise<string> {
  const { objectStorageClient, signObjectURL } = await import("./objectStorage.js");
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const bucket = objectStorageClient.bucket(bucketId);
  const objectName = `renders/voiceover-${Date.now()}.${format}`;
  const file = bucket.file(objectName);

  await file.save(buffer, { metadata: { contentType: `audio/${format}` } });

  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 14400 });
}

async function uploadVideoToStorage(buffer: Buffer): Promise<string> {
  const { objectStorageClient, signObjectURL } = await import("./objectStorage.js");
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const bucket = objectStorageClient.bucket(bucketId);
  const objectName = `renders/footage-${Date.now()}.mp4`;
  const file = bucket.file(objectName);

  await file.save(buffer, { metadata: { contentType: "video/mp4" } });

  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 14400 });
}

// ── Generic helpers ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 2000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500;
      logger.warn({ attempt, nextRetryMs: Math.round(delay) }, "Transient error - retrying");
      await sleep(delay);
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|502|503|504|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(msg);
}

// ── Segment refinement (xAI video editing) ─────────────────────────────────────

function resolveRenderVideoUrl(videoUrl: string): Promise<string> {
  if (videoUrl.startsWith(GROK_STORAGE_REFERENCE_PREFIX)) return grokRefToSignedUrl(videoUrl);
  if (videoUrl.startsWith("http")) return refreshSignedObjectUrl(videoUrl);
  return Promise.reject(new Error("Video has an unsupported URL scheme"));
}

function runFfmpegLocal(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4000); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${stderr}`)));
  });
}

function extractClip(inputPath: string, startSec: number, durSec: number, outputPath: string): Promise<void> {
  return runFfmpegLocal(["-y", "-i", inputPath, "-ss", String(startSec), "-t", String(durSec),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath]);
}

function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout.trim().length > 0) : reject(new Error("ffprobe audio check failed")));
  });
}

async function normalizeEditedClip(inputPath: string, outputPath: string, durSec: number): Promise<void> {
  const hasAudio = await hasAudioStream(inputPath);
  const args = hasAudio
    ? ["-y", "-i", inputPath, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath]
    : ["-y", "-i", inputPath, "-f", "lavfi", "-t", String(durSec), "-i", "anullsrc=r=44100:cl=stereo", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", outputPath];
  await runFfmpegLocal(args);
}

export function startVideoRefine(videoId: number, startSec: number, endSec: number, instruction: string): void {
  void runVideoRefine(videoId, startSec, endSec, instruction).catch((err) => {
    logger.error({ err, videoId }, "Video refine unhandled error");
    void markFailed(videoId, "Refinement failed unexpectedly; reserved seconds were returned.");
  });
}

async function runVideoRefine(videoId: number, startSec: number, endSec: number, instruction: string): Promise<void> {
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) throw new Error(`Video ${videoId} not found`);
  if (!video.videoUrl) throw new Error("Video has no rendered content to refine");
  const [project] = await db.select({ ownerId: projectsTable.ownerId }).from(projectsTable).where(eq(projectsTable.id, video.projectId));
  const ownerUserId = project?.ownerId ?? null;
  const fullDuration = Math.max(1, video.duration ?? 15);
  const segStart = Math.max(0, Math.min(startSec, fullDuration));
  const segEnd = Math.max(segStart, Math.min(endSec, fullDuration));
  const segDur = segEnd - segStart;

  if (segDur <= 0 || segDur > GROK_EDIT_MAX_SOURCE_SECONDS + 0.01) {
    await markFailed(videoId, `Refinement window must be 0-${GROK_EDIT_MAX_SOURCE_SECONDS} seconds`);
    if (ownerUserId) await refundRefineVideoSeconds(ownerUserId, Number.MAX_SAFE_INTEGER, videoId, video.projectId, "Refinement window invalid; reservation returned").catch(() => {});
    return;
  }

  let tmpDir = "";
  try {
    await db.update(videosTable).set({ renderStatus: "processing", renderStartedAt: new Date(), renderError: null }).where(eq(videosTable.id, videoId));
    const renderer = new GrokCommercialRenderer();

    const logoMeta = blueprintLogoMeta(video.cinematicPlan);
    // Refine the logo-free clip whenever one is on record, so the AI edit can
    // never re-render (and distort) the customer's burned-in badge.
    const refineSource = logoMeta.preLogoUrl ?? video.videoUrl;
    const fullUrl = await resolveRenderVideoUrl(refineSource);
    const fullRes = await fetch(fullUrl, { signal: AbortSignal.timeout(180_000) });
    if (!fullRes.ok) throw new Error(`Rendered video download failed (HTTP ${fullRes.status})`);
    const fullBuffer = Buffer.from(await fullRes.arrayBuffer());

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gf-refine-"));
    const fullPath = path.join(tmpDir, "full.mp4");
    const headPath = path.join(tmpDir, "head.mp4");
    const midPath = path.join(tmpDir, "middle.mp4");
    const tailPath = path.join(tmpDir, "tail.mp4");
    const editedPath = path.join(tmpDir, "edited.mp4");
    const normPath = path.join(tmpDir, "edited-norm.mp4");
    fs.writeFileSync(fullPath, fullBuffer);

    if (segStart > 0) await extractClip(fullPath, 0, segStart, headPath);
    await extractClip(fullPath, segStart, segDur, midPath);
    if (segEnd < fullDuration) await extractClip(fullPath, segEnd, fullDuration - segEnd, tailPath);

    const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucket) throw new Error("Object storage is not configured");
    const midKey = `commercial/grok/${videoId}/refine-source/${Date.now()}.mp4`;
    await objectStorageClient.bucket(bucket).file(midKey).save(fs.readFileSync(midPath), { metadata: { contentType: "video/mp4" } });
    const midUrl = await signObjectURL({ bucketName: bucket, objectName: midKey, method: "GET", ttlSec: 604800 });

    const edited = await renderer.refineClip(midUrl, instruction);
    fs.writeFileSync(editedPath, edited);
    await normalizeEditedClip(editedPath, normPath, segDur);

    const parts: Buffer[] = [];
    if (segStart > 0) parts.push(fs.readFileSync(headPath));
    parts.push(fs.readFileSync(normPath));
    if (segEnd < fullDuration) parts.push(fs.readFileSync(tailPath));
    const spliced = await assembleVideo(parts, fullDuration);

    const outKey = `commercial/grok/${videoId}/refined/${Date.now()}.mp4`;
    await objectStorageClient.bucket(bucket).file(outKey).save(spliced, { metadata: { contentType: "video/mp4" } });
    const ref = `grok-object://${encodeURIComponent(bucket)}/${outKey.split("/").map(encodeURIComponent).join("/")}`;
    // The refined clip is logo-free; put the badge back with ffmpeg so it keeps
    // its exact dimensions, position and look instead of being AI-redrawn.
    let finalUrl = ref;
    if (logoMeta.assetId) {
      const recomposited = await applyBlueprintLogo(videoId, video.projectId, logoMeta.assetId, ref);
      if (recomposited) finalUrl = recomposited;
    }
    await db.update(videosTable).set({ renderStatus: "complete", videoUrl: finalUrl, renderCompletedAt: new Date(), renderError: null, fidelityStatus: "unverified" }).where(eq(videosTable.id, videoId));
    logger.info({ videoId, segStart, segDur, logoReapplied: Boolean(logoMeta.assetId) }, "Video segment refined and spliced back");
  } catch (error) {
    logger.error({ err: error, videoId }, "Video refine failed");
    await markFailed(videoId, "Refinement failed; reserved video seconds were returned.");
    if (ownerUserId) {
      try { await refundRefineVideoSeconds(ownerUserId, Number.MAX_SAFE_INTEGER, videoId, video.projectId, "Refinement failed; reservation returned"); }
      catch (refundError) { logger.error({ err: refundError, videoId }, "Refine refund reconciliation required"); }
    }
    return;
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

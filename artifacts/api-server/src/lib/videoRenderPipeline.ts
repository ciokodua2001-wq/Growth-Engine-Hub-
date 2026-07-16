import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { deductPlatformCredits } from "./platformCredits.js";

const logger = pino({ name: "videoRenderPipeline" });

// ── API key constants ─────────────────────────────────────────────────────────
const ELEVENLABS_API_URL = "https://api.elevenlabs.io";
const MINIMAX_API_URL = "https://api.minimax.io";
const SHOTSTACK_API_URL = "https://api.shotstack.io/edit/v1";
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB"; // Adam

export type RenderMode = "footage" | "avatar" | "combined";
export type RenderResolution = "1080p" | "4k";

export interface RenderRequirementsResult {
  ready: boolean;
  missing: string[];
}

export function checkRenderRequirements(): RenderRequirementsResult {
  const missing: string[] = [];
  if (!process.env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
  if (!process.env.MINIMAX_API_KEY) missing.push("MINIMAX_API_KEY");
  if (!process.env.SHOTSTACK_API_KEY) missing.push("SHOTSTACK_API_KEY");
  return { ready: missing.length === 0, missing };
}

export function startVideoRender(
  videoId: number,
  mode: RenderMode,
  resolution: RenderResolution,
  avatarPhotoPath?: string | null,
): void {
  runRenderPipeline(videoId, mode, resolution, avatarPhotoPath).catch((err) => {
    logger.error({ err, videoId }, "Render pipeline unhandled error");
    void markFailed(videoId, "An unexpected error occurred. Please try again — your credits were not charged.");
  });
}

async function markFailed(videoId: number, error: string): Promise<void> {
  await db.update(videosTable).set({
    renderStatus: "failed",
    renderError: error,
    renderCompletedAt: new Date(),
  }).where(eq(videosTable.id, videoId));
}

async function runRenderPipeline(
  videoId: number,
  mode: RenderMode,
  resolution: RenderResolution,
  avatarPhotoPath?: string | null,
): Promise<void> {
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) throw new Error(`Video ${videoId} not found`);

  await db.update(videosTable).set({
    renderStatus: "processing",
    renderMode: mode,
    renderResolution: resolution,
    renderStartedAt: new Date(),
    renderError: null,
  }).where(eq(videosTable.id, videoId));

  // Step 1: ElevenLabs TTS
  const scriptText = video.voiceover ?? video.script ?? video.title;
  let voiceoverUrl: string;
  try {
    voiceoverUrl = await generateElevenLabsVoiceover(scriptText ?? "");
  } catch (err) {
    logger.error({ err, videoId }, "ElevenLabs TTS failed");
    await markFailed(videoId, "Voiceover generation hit a temporary issue. Please try again — your credits were not charged.");
    return;
  }
  const ttsChars = Math.min((scriptText ?? "").length, 800);
  deductPlatformCredits("elevenlabs", ttsChars, `TTS voiceover — video #${videoId}`).catch(() => {});

  await db.update(videosTable).set({ voiceoverUrl }).where(eq(videosTable.id, videoId));

  // Step 2: MiniMax AI footage / avatar clip
  const footagePrompt = buildMiniMaxPrompt(video.title, video.storyboard ?? "");
  let footageUrl: string | null = null;
  let avatarClipUrl: string | null = null;

  // MiniMax credit costs: $5 = 5,000 credits → 1 credit = $0.001; ~6-second clip ≈ 140 credits
  const MINIMAX_CREDITS_PER_CLIP = 140;
  const MINIMAX_SECONDS_PER_CLIP = 6;
  const MINIMAX_MINUTES_PER_CLIP = MINIMAX_SECONDS_PER_CLIP / 60;

  if (mode === "footage" || mode === "combined") {
    try {
      footageUrl = await generateMiniMaxT2V(footagePrompt);
    } catch (err) {
      logger.error({ err, videoId }, "MiniMax T2V failed");
      const msg = err instanceof Error && err.message.includes("timed out")
        ? "AI footage generation is taking longer than expected. Please try again in a few minutes."
        : "AI footage generation hit a temporary issue. Please try again — your credits were not charged.";
      await markFailed(videoId, msg);
      return;
    }
    deductPlatformCredits("minimax", MINIMAX_CREDITS_PER_CLIP, `Text-to-video — video #${videoId}`, {
      minutesGenerated: MINIMAX_MINUTES_PER_CLIP,
      videosCount: 1,
      projectId: video.projectId,
      videoId: String(videoId),
    }).catch(() => {});
  }

  if (mode === "avatar" || mode === "combined") {
    const photoPath = avatarPhotoPath ?? video.avatarPhotoPath;
    if (!photoPath) {
      await markFailed(videoId, "No avatar photo was found. Please re-upload your photo and try again.");
      return;
    }
    try {
      avatarClipUrl = await generateMiniMaxI2V(photoPath, footagePrompt);
    } catch (err) {
      logger.error({ err, videoId }, "MiniMax I2V failed");
      const msg = err instanceof Error && err.message.includes("timed out")
        ? "Avatar video generation is taking longer than expected. Please try again in a few minutes."
        : "Avatar video generation hit a temporary issue. Please try again — your credits were not charged.";
      await markFailed(videoId, msg);
      return;
    }
    deductPlatformCredits("minimax", MINIMAX_CREDITS_PER_CLIP, `Image-to-video — video #${videoId}`, {
      minutesGenerated: MINIMAX_MINUTES_PER_CLIP,
      videosCount: 1,
      projectId: video.projectId,
      videoId: String(videoId),
    }).catch(() => {});
  }

  // Step 3: Shotstack composition
  const duration = video.duration ?? 30;
  let finalUrl: string;
  try {
    finalUrl = await composeShotstack({
      voiceoverUrl,
      footageUrl,
      avatarClipUrl,
      duration,
      resolution,
    });
  } catch (err) {
    logger.error({ err, videoId }, "Shotstack composition failed");
    const msg = err instanceof Error && err.message.includes("timed out")
      ? "Video assembly is taking longer than expected. Please try again in a few minutes."
      : "Final video assembly hit a temporary issue. Please try again — your credits were not charged.";
    await markFailed(videoId, msg);
    return;
  }
  deductPlatformCredits("shotstack", 1, `Render — video #${videoId}`, {
    minutesGenerated: duration / 60,
    videosCount: 1,
    projectId: video.projectId,
    videoId: String(videoId),
  }).catch(() => {});

  // Update DB with completed render
  await db.update(videosTable).set({
    renderStatus: "complete",
    videoUrl: finalUrl,
    renderCompletedAt: new Date(),
  }).where(eq(videosTable.id, videoId));
}

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────

async function generateElevenLabsVoiceover(text: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const cappedText = text.length > 800 ? text.slice(0, 800) + "..." : text;

  const audioBuffer = await withRetry(async () => {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/v1/text-to-speech/${DEFAULT_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: cappedText,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          output_format: "mp3_44100_128",
        }),
      }
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ElevenLabs: ${response.status} ${body.slice(0, 200)}`);
    }
    return Buffer.from(await response.arrayBuffer());
  });

  return await uploadAudioToStorage(audioBuffer, "mp3");
}

// ── MiniMax Text-to-Video ─────────────────────────────────────────────────────

async function generateMiniMaxT2V(prompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY not configured");

  const { task_id } = await withRetry(async () => {
    const submitResponse = await fetch(`${MINIMAX_API_URL}/v1/video_generation`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "video-01", prompt }),
    });
    if (!submitResponse.ok) {
      const body = await submitResponse.text();
      throw new Error(`MiniMax T2V: ${submitResponse.status} ${body.slice(0, 200)}`);
    }
    return submitResponse.json() as Promise<{ task_id: string }>;
  });

  return await pollMiniMaxVideo(task_id, apiKey);
}

// ── MiniMax Image-to-Video ────────────────────────────────────────────────────

async function generateMiniMaxI2V(avatarImageUrl: string, prompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY not configured");

  const { task_id } = await withRetry(async () => {
    const submitResponse = await fetch(`${MINIMAX_API_URL}/v1/image_to_video`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "video-01-live2d", first_frame_image: avatarImageUrl, prompt }),
    });
    if (!submitResponse.ok) {
      const body = await submitResponse.text();
      throw new Error(`MiniMax I2V: ${submitResponse.status} ${body.slice(0, 200)}`);
    }
    return submitResponse.json() as Promise<{ task_id: string }>;
  });

  return await pollMiniMaxVideo(task_id, apiKey);
}

// ── MiniMax polling ───────────────────────────────────────────────────────────

async function pollMiniMaxVideo(taskId: string, apiKey: string): Promise<string> {
  const MAX_POLLS = 90; // up to 15 minutes
  const POLL_INTERVAL_MS = 10_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const data = await withRetry(async () => {
      const res = await fetch(
        `${MINIMAX_API_URL}/v1/query/video_generation?task_id=${taskId}`,
        { headers: { "Authorization": `Bearer ${apiKey}` } }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`MiniMax poll: ${res.status} ${body.slice(0, 200)}`);
      }
      return res.json() as Promise<{ task: { status: string; file_id?: string } }>;
    });

    if (data.task.status === "Success" && data.task.file_id) {
      return await retrieveMiniMaxFile(data.task.file_id, apiKey);
    }
    if (data.task.status === "Fail") {
      throw new Error("MiniMax video generation failed");
    }
    // status === "Queueing" or "Processing" — keep polling
  }

  throw new Error("MiniMax video generation timed out after 15 minutes");
}

async function retrieveMiniMaxFile(fileId: string, apiKey: string): Promise<string> {
  const { download_url } = await withRetry(async () => {
    const res = await fetch(`${MINIMAX_API_URL}/v1/files/retrieve`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_id: fileId }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MiniMax file retrieve: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json() as { file: { download_url: string } };
    return { download_url: data.file.download_url };
  });

  // Download and re-host to our stable storage so Shotstack gets a reliable URL
  // (MiniMax download_urls are temporary signed URLs that can expire)
  const videoRes = await withRetry(() => fetch(download_url));
  if (!videoRes.ok) throw new Error(`MiniMax download failed: ${videoRes.status}`);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  return await uploadVideoToStorage(videoBuffer);
}

// ── Shotstack composition ─────────────────────────────────────────────────────

interface ShotstackOptions {
  voiceoverUrl: string;
  footageUrl: string | null;
  avatarClipUrl: string | null;
  duration: number;
  resolution: RenderResolution;
}

async function composeShotstack(opts: ShotstackOptions): Promise<string> {
  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) throw new Error("SHOTSTACK_API_KEY not configured");

  const shotstackResolution = opts.resolution === "4k" ? "2160" : "1080";

  // Build video tracks — avatar on top, footage underneath
  const tracks: ShotstackTrack[] = [];

  if (opts.avatarClipUrl) {
    tracks.push({
      clips: [{
        asset: { type: "video", src: opts.avatarClipUrl, trim: 0 },
        start: 0,
        length: opts.duration,
        position: opts.footageUrl ? "bottomRight" : "center",
        scale: opts.footageUrl ? 0.35 : 1.0,
      }],
    });
  }

  if (opts.footageUrl) {
    tracks.push({
      clips: [{
        asset: { type: "video", src: opts.footageUrl, trim: 0, volume: 0 },
        start: 0,
        length: opts.duration,
      }],
    });
  }

  // Fallback: black background if no video tracks at all
  if (tracks.length === 0) {
    tracks.push({
      clips: [{
        asset: { type: "html", html: "<p></p>", css: "p { background: #000; width: 1920px; height: 1080px; }" },
        start: 0,
        length: opts.duration,
      }],
    });
  }

  const edit = {
    timeline: {
      soundtrack: {
        src: opts.voiceoverUrl,
        effect: "fadeInFadeOut",
      },
      tracks,
    },
    output: {
      format: "mp4",
      resolution: shotstackResolution,
    },
  };

  const { data: submitData } = await withRetry(async () => {
    const submitRes = await fetch(`${SHOTSTACK_API_URL}/render`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(edit),
    });
    if (!submitRes.ok) {
      const body = await submitRes.text();
      throw new Error(`Shotstack submit: ${submitRes.status} ${body.slice(0, 200)}`);
    }
    return submitRes.json() as Promise<{ data: { id: string } }>;
  });

  return await pollShotstack(submitData.id, apiKey);
}

async function pollShotstack(renderId: string, apiKey: string): Promise<string> {
  const MAX_POLLS = 120; // up to 16 minutes
  const POLL_INTERVAL_MS = 8_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const { data } = await withRetry(async () => {
      const res = await fetch(`${SHOTSTACK_API_URL}/render/${renderId}`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Shotstack poll: ${res.status} ${body.slice(0, 200)}`);
      }
      return res.json() as Promise<{ data: { status: string; url?: string } }>;
    });

    if (data.status === "done" && data.url) return data.url;
    if (data.status === "failed") throw new Error("Shotstack render failed");
    // status is "queued" or "rendering" — keep polling
  }

  throw new Error("Shotstack render timed out after 16 minutes");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMiniMaxPrompt(title: string, storyboard: string): string {
  const base = storyboard
    ? `${title}. ${storyboard.slice(0, 300)}`
    : `Marketing video for: ${title}`;
  return `Cinematic marketing footage, professional grade, 4K quality. ${base}`;
}

async function uploadAudioToStorage(buffer: Buffer, format: string): Promise<string> {
  // Store audio in object storage and return a publicly accessible URL
  const { Storage } = await import("@google-cloud/storage");
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const storage = new Storage();
  const bucket = storage.bucket(bucketId);
  const filename = `renders/voiceover-${Date.now()}.${format}`;
  const file = bucket.file(filename);

  await file.save(buffer, { metadata: { contentType: `audio/${format}` } });
  await file.makePublic();

  const [metadata] = await file.getMetadata();
  return metadata.mediaLink as string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Retry with exponential backoff ────────────────────────────────────────────

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
      logger.warn({ attempt, nextRetryMs: Math.round(delay) }, "Transient error — retrying");
      await sleep(delay);
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|502|503|504|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(msg);
}

async function uploadVideoToStorage(buffer: Buffer): Promise<string> {
  const { Storage } = await import("@google-cloud/storage");
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const storage = new Storage();
  const bucket = storage.bucket(bucketId);
  const filename = `renders/footage-${Date.now()}.mp4`;
  const file = bucket.file(filename);

  await file.save(buffer, { metadata: { contentType: "video/mp4" } });
  await file.makePublic();

  const [metadata] = await file.getMetadata();
  return metadata.mediaLink as string;
}

// Shotstack type helpers (not exported — internal to pipeline)
interface ShotstackClipAsset {
  type: string;
  src?: string;
  html?: string;
  css?: string;
  trim?: number;
  volume?: number;
}

interface ShotstackClip {
  asset: ShotstackClipAsset;
  start: number;
  length: number;
  position?: string;
  scale?: number;
}

interface ShotstackTrack {
  clips: ShotstackClip[];
}

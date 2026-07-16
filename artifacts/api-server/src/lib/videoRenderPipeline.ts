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
    void markFailed(videoId, "Internal pipeline error");
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
  const voiceoverUrl = await generateElevenLabsVoiceover(scriptText ?? "");
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
    footageUrl = await generateMiniMaxT2V(footagePrompt);
    deductPlatformCredits("minimax", MINIMAX_CREDITS_PER_CLIP, `Text-to-video — video #${videoId}`, {
      minutesGenerated: MINIMAX_MINUTES_PER_CLIP,
      videosCount: 1,
      projectId: video.projectId,
      videoId: String(videoId),
    }).catch(() => {});
  }

  if (mode === "avatar" || mode === "combined") {
    const photoPath = avatarPhotoPath ?? video.avatarPhotoPath;
    if (!photoPath) throw new Error("Avatar mode requires an uploaded avatar photo");
    avatarClipUrl = await generateMiniMaxI2V(photoPath, footagePrompt);
    deductPlatformCredits("minimax", MINIMAX_CREDITS_PER_CLIP, `Image-to-video — video #${videoId}`, {
      minutesGenerated: MINIMAX_MINUTES_PER_CLIP,
      videosCount: 1,
      projectId: video.projectId,
      videoId: String(videoId),
    }).catch(() => {});
  }

  // Step 3: Shotstack composition
  const duration = video.duration ?? 30;
  const finalUrl = await composeShotstack({
    voiceoverUrl,
    footageUrl,
    avatarClipUrl,
    duration,
    resolution,
  });
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

  // Truncate to keep the audio clip short (≤ 30 seconds)
  const cappedText = text.length > 800 ? text.slice(0, 800) + "..." : text;

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
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${body}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  // Upload to object storage and return public URL
  return await uploadAudioToStorage(audioBuffer, "mp3");
}

// ── MiniMax Text-to-Video ─────────────────────────────────────────────────────

async function generateMiniMaxT2V(prompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY not configured");

  const submitResponse = await fetch(`${MINIMAX_API_URL}/v1/video_generation`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "video-01",
      prompt,
    }),
  });

  if (!submitResponse.ok) {
    const body = await submitResponse.text();
    throw new Error(`MiniMax T2V submit failed: ${submitResponse.status} ${body}`);
  }

  const { task_id } = await submitResponse.json() as { task_id: string };
  return await pollMiniMaxVideo(task_id, apiKey);
}

// ── MiniMax Image-to-Video ────────────────────────────────────────────────────

async function generateMiniMaxI2V(avatarImageUrl: string, prompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY not configured");

  const submitResponse = await fetch(`${MINIMAX_API_URL}/v1/image_to_video`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "video-01-live2d",
      first_frame_image: avatarImageUrl,
      prompt,
    }),
  });

  if (!submitResponse.ok) {
    const body = await submitResponse.text();
    throw new Error(`MiniMax I2V submit failed: ${submitResponse.status} ${body}`);
  }

  const { task_id } = await submitResponse.json() as { task_id: string };
  return await pollMiniMaxVideo(task_id, apiKey);
}

// ── MiniMax polling ───────────────────────────────────────────────────────────

async function pollMiniMaxVideo(taskId: string, apiKey: string): Promise<string> {
  const MAX_POLLS = 60;
  const POLL_INTERVAL_MS = 10_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(
      `${MINIMAX_API_URL}/v1/query/video_generation?task_id=${taskId}`,
      { headers: { "Authorization": `Bearer ${apiKey}` } }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`MiniMax poll failed: ${res.status} ${body}`);
    }

    const data = await res.json() as {
      task: { status: string; file_id?: string };
    };

    if (data.task.status === "Success" && data.task.file_id) {
      return await retrieveMiniMaxFile(data.task.file_id, apiKey);
    }
    if (data.task.status === "Fail") {
      throw new Error("MiniMax video generation failed");
    }
    // status === "Queueing" or "Processing" — keep polling
  }

  throw new Error("MiniMax video generation timed out after 10 minutes");
}

async function retrieveMiniMaxFile(fileId: string, apiKey: string): Promise<string> {
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
    throw new Error(`MiniMax file retrieve failed: ${res.status} ${body}`);
  }

  const data = await res.json() as { file: { download_url: string } };
  return data.file.download_url;
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
    throw new Error(`Shotstack render submit failed: ${submitRes.status} ${body}`);
  }

  const { data: submitData } = await submitRes.json() as { data: { id: string } };
  return await pollShotstack(submitData.id, apiKey);
}

async function pollShotstack(renderId: string, apiKey: string): Promise<string> {
  const MAX_POLLS = 90;
  const POLL_INTERVAL_MS = 8_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${SHOTSTACK_API_URL}/render/${renderId}`, {
      headers: { "x-api-key": apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shotstack poll failed: ${res.status} ${body}`);
    }

    const { data } = await res.json() as {
      data: { status: string; url?: string };
    };

    if (data.status === "done" && data.url) return data.url;
    if (data.status === "failed") throw new Error("Shotstack render failed");
    // status is "queued" or "rendering" — keep polling
  }

  throw new Error("Shotstack render timed out after 12 minutes");
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

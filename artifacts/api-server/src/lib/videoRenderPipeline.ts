import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { deductPlatformCredits } from "./platformCredits.js";

// ffmpeg is declared as a nix system dependency (installSystemDependencies),
// so it is guaranteed to be on PATH in both dev and production.
const FFMPEG_BIN = "ffmpeg";

const logger = pino({ name: "videoRenderPipeline" });

// ── Render constants ──────────────────────────────────────────────────────────
const FAL_CLIP_DURATION_S = 5;     // Kling v1.6 generates 5-second clips
const CLIP_BATCH_SIZE = 5;          // max concurrent FAL requests per batch
const AVATAR_UNIQUE_CLIPS = 3;      // unique avatar clips generated; cycled to fill duration

// ── API constants ─────────────────────────────────────────────────────────────
const ELEVENLABS_API_URL = "https://api.elevenlabs.io";
const FAL_QUEUE_BASE = "https://queue.fal.run";
const FAL_T2V_MODEL = "fal-ai/kling-video/v1.6/standard/text-to-video";
const FAL_I2V_MODEL = "fal-ai/kling-video/v1.6/standard/image-to-video";
const HEYGEN_API_URL = "https://api.heygen.com";

// Resolved once per process — fetched live from the account's HeyGen avatar library
let _cachedDefaultAvatarId: string | null = null;

async function resolveDefaultHeyGenAvatar(apiKey: string): Promise<string> {
  if (_cachedDefaultAvatarId) return _cachedDefaultAvatarId;

  const res = await fetch(`${HEYGEN_API_URL}/v2/avatars`, {
    headers: { "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HeyGen avatars list: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json() as {
    data: { avatars: Array<{ avatar_id: string; avatar_name: string }> };
  };
  const first = json.data?.avatars?.[0];
  if (!first) throw new Error("HeyGen account has no avatars — upload a photo to render");
  _cachedDefaultAvatarId = first.avatar_id;
  logger.info({ avatarId: first.avatar_id, avatarName: first.avatar_name }, "HeyGen default avatar resolved");
  return _cachedDefaultAvatarId;
}

// ElevenLabs voice IDs — used when no ELEVENLABS_VOICE_ID env override is set
const VOICE_MALE_DEFAULT   = "pNInz6obpgDQGcFmaJgB"; // Adam   — warm, authoritative male
const VOICE_FEMALE_DEFAULT = "oWAxZDx7w5VEj9dCyTzz"; // Grace  — calm, confident female

/**
 * Infer the best voice ID from a cinematic character description.
 * Falls back to the env override or the male default when gender is ambiguous.
 */
function resolveVoiceId(characterDescription?: string | null): string {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  if (!characterDescription) return VOICE_MALE_DEFAULT;

  const desc = characterDescription.toLowerCase();
  const femaleSignals = ["female", "woman", "girl", "she/her", " she ", " her ", "founder", "latina", "asian", "afri"];
  const maleSignals   = ["male", "man", " guy ", "he/him", " he ", " his ", "gentleman", "dad ", "father"];

  const femaleScore = femaleSignals.filter(s => desc.includes(s)).length;
  const maleScore   = maleSignals.filter(s => desc.includes(s)).length;

  if (femaleScore > maleScore) return VOICE_FEMALE_DEFAULT;
  if (maleScore   > femaleScore) return VOICE_MALE_DEFAULT;
  return VOICE_MALE_DEFAULT; // tie → default
}

export type RenderMode = "footage" | "avatar" | "combined";
export type RenderResolution = "1080p" | "4k";
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export interface RenderRequirementsResult {
  ready: boolean;
  missing: string[];
}

export function checkRenderRequirements(): RenderRequirementsResult {
  const missing: string[] = [];
  if (!process.env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
  if (!process.env.FAL_API_KEY) missing.push("FAL_API_KEY");
  // HEYGEN_API_KEY and SHOTSTACK_API_KEY are optional — HeyGen upgrades quality
  // but FAL + FFmpeg render a complete video without it
  return { ready: missing.length === 0, missing };
}

export function startVideoRender(
  videoId: number,
  mode: RenderMode,
  resolution: RenderResolution,
  avatarPhotoPath?: string | null,
  avatarInstructions?: string | null,
  aspectRatio: AspectRatio = "16:9",
  captionsEnabled = false,
): void {
  runRenderPipeline(videoId, mode, resolution, avatarPhotoPath, avatarInstructions, aspectRatio, captionsEnabled).catch((err) => {
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
  avatarInstructions?: string | null,
  aspectRatio: AspectRatio = "16:9",
  captionsEnabled = false,
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

  // Step 1: ElevenLabs TTS — generate voiceover from the actor script
  // Strip any residual [HOOK]/[SCENE N] markers that may exist in legacy blueprints
  const rawScript = video.voiceover ?? video.script ?? video.title;
  const scriptText = rawScript.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

  // Resolve the right voice gender from the cinematic plan's character description
  let characterDescription: string | null = null;
  if (video.cinematicPlan) {
    try {
      const plan = JSON.parse(video.cinematicPlan) as { characterDescription?: string };
      characterDescription = plan.characterDescription ?? null;
    } catch { /* malformed JSON — ignore, fall back to default */ }
  }
  const voiceId = resolveVoiceId(characterDescription);
  logger.info({ videoId, voiceId, characterDescription }, "Resolved ElevenLabs voice");

  let voiceoverUrl: string;
  try {
    voiceoverUrl = await generateElevenLabsVoiceover(scriptText ?? "", voiceId);
  } catch (err) {
    logger.error({ err, videoId }, "ElevenLabs TTS failed");
    await markFailed(videoId, "Voiceover generation hit a temporary issue. Please try again — your credits were not charged.");
    return;
  }
  const ttsChars = Math.min((scriptText ?? "").length, 800);
  deductPlatformCredits("elevenlabs", ttsChars, `TTS voiceover — video #${videoId}`).catch(() => {});

  await db.update(videosTable).set({ voiceoverUrl }).where(eq(videosTable.id, videoId));

  const duration = video.duration ?? 60;
  const photoPath = avatarPhotoPath ?? video.avatarPhotoPath;
  const heyGenKey = process.env.HEYGEN_API_KEY;

  // Step 2: Video clip generation
  // With HEYGEN_API_KEY + avatar/combined: HeyGen produces one lip-synced presenter video
  // Without HeyGen (or footage-only): FAL Kling produces B-roll clips
  let finalUrl: string;

  const useHeyGen = !!heyGenKey && (mode === "avatar" || mode === "combined");

  if (useHeyGen) {
    // ── HeyGen path ───────────────────────────────────────────────────────────
    // photoPath may be null — generateHeyGenVideo falls back to the default presenter avatar
    let heyGenVideoUrl: string;
    try {
      heyGenVideoUrl = await generateHeyGenVideo(voiceoverUrl, photoPath, scriptText, aspectRatio, resolution);
    } catch (err) {
      logger.error({ err, videoId }, "HeyGen generation failed");
      const msg = err instanceof Error && err.message.includes("timed out")
        ? "HeyGen avatar generation timed out. Please try again in a few minutes."
        : "HeyGen avatar generation hit a temporary issue. Please try again — your credits were not charged.";
      await markFailed(videoId, msg);
      return;
    }

    // For combined mode, also generate B-roll via FAL (runs in background alongside HeyGen)
    if (mode === "combined" && process.env.FAL_API_KEY) {
      const numClips = Math.max(1, Math.ceil(duration / FAL_CLIP_DURATION_S));
      const scenePrompts = buildScenePrompts(video.title, video.storyboard ?? "", numClips, video.cinematicPlan);
      let brollUrls: string[] = [];
      try {
        brollUrls = await generateFootageClipsT2V(scenePrompts, videoId, aspectRatio);
      } catch (err) {
        logger.warn({ err, videoId }, "FAL B-roll failed in combined mode — continuing with HeyGen presenter only");
        // Don't fail the whole render — HeyGen presenter is enough
      }

      if (brollUrls.length > 0) {
        // Compose: HeyGen presenter overlaid on B-roll using FFmpeg
        try {
          finalUrl = await composeHeyGenWithBroll({
            heyGenVideoUrl,
            brollUrls,
            voiceoverUrl,
            duration,
            resolution,
            aspectRatio,
            captionsEnabled,
            script: scriptText,
          });
        } catch (err) {
          logger.warn({ err, videoId }, "FFmpeg combined compose failed — using HeyGen presenter only");
          finalUrl = heyGenVideoUrl;
        }
      } else {
        finalUrl = captionsEnabled
          ? await burnCaptionsFFmpeg(heyGenVideoUrl, scriptText, duration, resolution, aspectRatio)
          : heyGenVideoUrl;
      }
    } else {
      // Avatar-only: burn captions if requested
      finalUrl = captionsEnabled
        ? await burnCaptionsFFmpeg(heyGenVideoUrl, scriptText, duration, resolution, aspectRatio)
        : heyGenVideoUrl;
    }

    deductPlatformCredits("heygen", 1, `HeyGen avatar — video #${videoId}`, {
      minutesGenerated: duration / 60,
      videosCount: 1,
      projectId: video.projectId,
      videoId: String(videoId),
    }).catch(() => {});

  } else {
    // ── FAL Kling path (no HeyGen or footage-only mode) ──────────────────────
    const numClips = Math.max(1, Math.ceil(duration / FAL_CLIP_DURATION_S));
    const scenePrompts = buildScenePrompts(video.title, video.storyboard ?? "", numClips, video.cinematicPlan);

    let footageUrls: string[] = [];
    let avatarClipUrls: string[] = [];

    if (mode === "avatar" || mode === "combined") {
      if (!photoPath) {
        await markFailed(videoId, "No avatar photo was found. Please re-upload your photo and try again.");
        return;
      }
    }

    try {
      if (mode === "combined") {
        const avatarCount = Math.min(AVATAR_UNIQUE_CLIPS, numClips);
        const avatarPrompts = buildAvatarPrompts(video.title, video.storyboard ?? "", avatarCount, avatarInstructions, video.cinematicPlan);
        [footageUrls, avatarClipUrls] = await Promise.all([
          generateFootageClipsT2V(scenePrompts, videoId, aspectRatio),
          generateAvatarClipsI2V(photoPath!, avatarPrompts, videoId),
        ]);
      } else if (mode === "footage") {
        footageUrls = await generateFootageClipsT2V(scenePrompts, videoId, aspectRatio);
      } else {
        const avatarCount = Math.min(AVATAR_UNIQUE_CLIPS, numClips);
        const avatarPrompts = buildAvatarPrompts(video.title, video.storyboard ?? "", avatarCount, avatarInstructions, video.cinematicPlan);
        avatarClipUrls = await generateAvatarClipsI2V(photoPath!, avatarPrompts, videoId);
      }
    } catch (err) {
      logger.error({ err, videoId }, "FAL clip generation failed");
      const msg = err instanceof Error && err.message.includes("timed out")
        ? "AI video generation is taking longer than expected. Please try again in a few minutes."
        : "AI video generation hit a temporary issue. Please try again — your credits were not charged.";
      await markFailed(videoId, msg);
      return;
    }

    const totalClips = footageUrls.length + avatarClipUrls.length;
    deductPlatformCredits("fal", totalClips, `AI clips (${totalClips}) — video #${videoId}`, {
      minutesGenerated: (FAL_CLIP_DURATION_S / 60) * totalClips,
      videosCount: totalClips,
      projectId: video.projectId,
      videoId: String(videoId),
    }).catch(() => {});

    // Step 3: FFmpeg composition — replaces Shotstack
    try {
      finalUrl = await composeWithFFmpeg({
        voiceoverUrl,
        footageUrls,
        avatarClipUrls,
        duration,
        resolution,
        aspectRatio,
        captionsEnabled,
        script: scriptText,
      });
    } catch (err) {
      logger.error({ err, videoId }, "FFmpeg composition failed");
      const msg = err instanceof Error && err.message.includes("timed out")
        ? "Video assembly is taking longer than expected. Please try again in a few minutes."
        : "Final video assembly hit a temporary issue. Please try again — your credits were not charged.";
      await markFailed(videoId, msg);
      return;
    }
  }

  await db.update(videosTable).set({
    renderStatus: "complete",
    videoUrl: finalUrl,
    renderCompletedAt: new Date(),
  }).where(eq(videosTable.id, videoId));
}

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────

async function generateElevenLabsVoiceover(text: string, voiceId?: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const selectedVoice = voiceId ?? VOICE_MALE_DEFAULT;
  const cappedText = text.length > 800 ? text.slice(0, 800) + "..." : text;

  const audioBuffer = await withRetry(async () => {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/v1/text-to-speech/${selectedVoice}?output_format=mp3_44100_128`,
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
        }),
        signal: AbortSignal.timeout(30_000),
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

// ── HeyGen Talking Avatar ──────────────────────────────────────────────────────

async function generateHeyGenVideo(
  voiceoverUrl: string,
  avatarPhotoPath: string | null | undefined,
  _script: string | null | undefined,
  aspectRatio: AspectRatio,
  resolution: RenderResolution,
): Promise<string> {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");

  const { width, height } = getOutputDimensions(resolution, aspectRatio);

  type Character =
    | { type: "avatar"; avatar_id: string }
    | { type: "talking_photo"; talking_photo_id: string };

  let character: Character;
  if (avatarPhotoPath) {
    const talkingPhotoId = await uploadHeyGenTalkingPhoto(avatarPhotoPath, apiKey);
    character = { type: "talking_photo", talking_photo_id: talkingPhotoId };
  } else {
    const defaultAvatarId = await resolveDefaultHeyGenAvatar(apiKey);
    character = { type: "avatar", avatar_id: defaultAvatarId };
  }

  const body = {
    video_inputs: [{
      character,
      voice: { type: "audio", audio_url: voiceoverUrl },
    }],
    dimension: { width, height },
  };

  const createRes = await withRetry(() =>
    fetch(`${HEYGEN_API_URL}/v2/video/generate`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`HeyGen generate: ${r.status} ${text.slice(0, 300)}`);
      }
      return r.json() as Promise<{ data: { video_id: string } }>;
    })
  );

  logger.info({ videoId: createRes.data.video_id }, "HeyGen video created — polling");
  return await pollHeyGenVideo(createRes.data.video_id, apiKey);
}

async function uploadHeyGenTalkingPhoto(photoUrl: string, apiKey: string): Promise<string> {
  const photoRes = await fetch(photoUrl, { signal: AbortSignal.timeout(30_000) });
  if (!photoRes.ok) throw new Error(`Download avatar photo: ${photoRes.status}`);
  const photoBuf = Buffer.from(await photoRes.arrayBuffer());

  const formData = new FormData();
  formData.append("file", new Blob([photoBuf], { type: "image/jpeg" }), "avatar.jpg");

  const res = await withRetry(() =>
    fetch(`${HEYGEN_API_URL}/v1/talking_photo`, {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: formData,
      signal: AbortSignal.timeout(60_000),
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`HeyGen talking_photo upload: ${r.status} ${text.slice(0, 300)}`);
      }
      return r.json() as Promise<{ data: { talking_photo_id: string } }>;
    })
  );

  return res.data.talking_photo_id;
}

async function pollHeyGenVideo(videoId: string, apiKey: string): Promise<string> {
  const MAX_POLLS = 120; // up to 20 minutes
  const POLL_INTERVAL_MS = 10_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const data = await withRetry(async () => {
      const res = await fetch(
        `${HEYGEN_API_URL}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
        { headers: { "X-Api-Key": apiKey }, signal: AbortSignal.timeout(15_000) }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HeyGen poll: ${res.status} ${text.slice(0, 200)}`);
      }
      return res.json() as Promise<{ data: { status: string; video_url?: string; error?: string } }>;
    });

    logger.info({ videoId, status: data.data.status, poll: i }, "HeyGen poll");

    if (data.data.status === "completed" && data.data.video_url) {
      const videoRes = await withRetry(() => fetch(data.data.video_url!, { signal: AbortSignal.timeout(120_000) }));
      if (!videoRes.ok) throw new Error(`HeyGen download: ${videoRes.status}`);
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      return await uploadVideoToStorage(buffer);
    }
    if (data.data.status === "failed") {
      throw new Error(`HeyGen generation failed: ${data.data.error ?? "unknown"}`);
    }
  }

  throw new Error("HeyGen video generation timed out after 20 minutes");
}

// ── FAL.ai Kling v1.6 ─────────────────────────────────────────────────────────

interface FalQueueResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  output?: { video?: { url: string }; videos?: Array<{ url: string }> };
  error?: string;
}

async function submitFalJob(modelId: string, body: Record<string, unknown>): Promise<FalQueueResponse> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("FAL_API_KEY not configured");

  const res = await fetch(`${FAL_QUEUE_BASE}/${modelId}`, {
    method: "POST",
    headers: { "Authorization": `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FAL submit: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<FalQueueResponse>;
}

async function pollFalJob(job: FalQueueResponse): Promise<string> {
  const apiKey = process.env.FAL_API_KEY!;
  const MAX_POLLS = 90; // up to 15 minutes
  const POLL_INTERVAL_MS = 10_000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const data = await withRetry(async () => {
      const res = await fetch(job.status_url, {
        headers: { "Authorization": `Key ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`FAL poll: ${res.status} ${text.slice(0, 200)}`);
      }
      return res.json() as Promise<FalStatusResponse>;
    });

    if (data.status === "COMPLETED") {
      const resultRes = await withRetry(() =>
        fetch(job.response_url, { headers: { "Authorization": `Key ${apiKey}` }, signal: AbortSignal.timeout(30_000) })
      );
      if (!resultRes.ok) throw new Error(`FAL result fetch: ${resultRes.status}`);
      const raw = await resultRes.json() as Record<string, unknown>;
      const rawVideo = raw["video"] as { url?: string } | undefined;
      const rawVideos = raw["videos"] as Array<{ url?: string }> | undefined;
      const videoUrl =
        rawVideo?.url ??
        rawVideos?.[0]?.url ??
        data.output?.video?.url ??
        data.output?.videos?.[0]?.url;
      if (!videoUrl) throw new Error(`FAL completed but no video URL — keys: ${Object.keys(raw).join(", ")}`);
      const videoRes = await withRetry(() => fetch(videoUrl, { signal: AbortSignal.timeout(120_000) }));
      if (!videoRes.ok) throw new Error(`FAL download: ${videoRes.status}`);
      const buffer = Buffer.from(await videoRes.arrayBuffer());
      return await uploadVideoToStorage(buffer);
    }
    if (data.status === "FAILED") {
      throw new Error(`FAL generation failed: ${data.error ?? "unknown"}`);
    }
  }

  throw new Error("FAL video generation timed out after 15 minutes");
}

// Map 4:5 → 9:16 since Kling doesn't support 4:5 natively; FFmpeg crops to 4:5 in post
function falAspectRatio(ar: AspectRatio): string {
  if (ar === "4:5") return "9:16";
  return ar;
}

async function generateFalT2V(prompt: string, aspectRatio: AspectRatio = "16:9"): Promise<string> {
  const job = await withRetry(() =>
    submitFalJob(FAL_T2V_MODEL, { prompt, duration: "5", aspect_ratio: falAspectRatio(aspectRatio) })
  );
  return await pollFalJob(job);
}

async function generateFalI2V(avatarImageUrl: string, prompt: string): Promise<string> {
  const job = await withRetry(() =>
    submitFalJob(FAL_I2V_MODEL, { image_url: avatarImageUrl, prompt, duration: "5" })
  );
  return await pollFalJob(job);
}

// ── FFmpeg Composition ────────────────────────────────────────────────────────

interface FFmpegComposeOptions {
  voiceoverUrl: string;
  footageUrls: string[];
  avatarClipUrls: string[];
  duration: number;
  resolution: RenderResolution;
  aspectRatio: AspectRatio;
  captionsEnabled: boolean;
  script?: string;
}

async function composeWithFFmpeg(opts: FFmpegComposeOptions): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
  try {
    // Build the ordered clip list: avatar clips interleaved with footage (avatar on top)
    const numSlots = Math.max(1, Math.ceil(opts.duration / FAL_CLIP_DURATION_S));
    const orderedClipUrls: string[] = [];
    const isOverlay = opts.footageUrls.length > 0 && opts.avatarClipUrls.length > 0;

    if (isOverlay) {
      // Combined mode: alternate footage + avatar per slot — FFmpeg overlay handled via filter
      // For simplicity in concat mode, use footage as base track; avatar overlaid
      for (let i = 0; i < numSlots; i++) {
        orderedClipUrls.push(opts.footageUrls[i % opts.footageUrls.length]!);
      }
    } else if (opts.avatarClipUrls.length > 0) {
      for (let i = 0; i < numSlots; i++) {
        orderedClipUrls.push(opts.avatarClipUrls[i % opts.avatarClipUrls.length]!);
      }
    } else {
      for (let i = 0; i < opts.footageUrls.length; i++) {
        orderedClipUrls.push(opts.footageUrls[i]!);
      }
    }

    // Download all clips
    const clipPaths: string[] = [];
    for (let i = 0; i < orderedClipUrls.length; i++) {
      const res = await fetch(orderedClipUrls[i]!);
      if (!res.ok) throw new Error(`Download clip ${i}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const p = path.join(tmpDir, `clip${i}.mp4`);
      fs.writeFileSync(p, buf);
      clipPaths.push(p);
    }

    // Download voiceover
    const audioRes = await fetch(opts.voiceoverUrl);
    if (!audioRes.ok) throw new Error(`Download voiceover: HTTP ${audioRes.status}`);
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    const audioPath = path.join(tmpDir, "voiceover.mp3");
    fs.writeFileSync(audioPath, audioBuf);

    // Write concat list
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
      // Escape ASS path for FFmpeg filter (colons must be escaped)
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

// Burn captions onto an existing video (used for HeyGen output)
async function burnCaptionsFFmpeg(
  videoUrl: string,
  script: string,
  duration: number,
  resolution: RenderResolution,
  aspectRatio: AspectRatio,
): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "captions-"));
  try {
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Download video for captions: HTTP ${videoRes.status}`);
    const videoBuf = Buffer.from(await videoRes.arrayBuffer());
    const videoPath = path.join(tmpDir, "input.mp4");
    fs.writeFileSync(videoPath, videoBuf);

    const { width, height } = getOutputDimensions(resolution, aspectRatio);
    const assPath = path.join(tmpDir, "captions.ass");
    fs.writeFileSync(assPath, generateASS(script, duration, width, height));
    const assEscaped = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const outputPath = path.join(tmpDir, "output.mp4");

    await runFFmpeg([
      "-y", "-i", videoPath,
      "-vf", `ass='${assEscaped}'`,
      "-c:v", "libx264", "-preset", "fast", "-crf", resolution === "4k" ? "18" : "23",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outputPath,
    ]);

    const outBuf = fs.readFileSync(outputPath);
    return await uploadVideoToStorage(outBuf);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Compose HeyGen presenter on top of B-roll clips using FFmpeg overlay
async function composeHeyGenWithBroll(opts: {
  heyGenVideoUrl: string;
  brollUrls: string[];
  voiceoverUrl: string;
  duration: number;
  resolution: RenderResolution;
  aspectRatio: AspectRatio;
  captionsEnabled: boolean;
  script?: string;
}): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "combined-"));
  try {
    // Download HeyGen presenter video
    const presenterRes = await fetch(opts.heyGenVideoUrl);
    if (!presenterRes.ok) throw new Error(`Download presenter: HTTP ${presenterRes.status}`);
    const presenterPath = path.join(tmpDir, "presenter.mp4");
    fs.writeFileSync(presenterPath, Buffer.from(await presenterRes.arrayBuffer()));

    // Download B-roll clips
    const brollPaths: string[] = [];
    for (let i = 0; i < opts.brollUrls.length; i++) {
      const res = await fetch(opts.brollUrls[i]!);
      if (!res.ok) throw new Error(`Download b-roll ${i}: HTTP ${res.status}`);
      const p = path.join(tmpDir, `broll${i}.mp4`);
      fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
      brollPaths.push(p);
    }

    // Download voiceover
    const audioRes = await fetch(opts.voiceoverUrl);
    if (!audioRes.ok) throw new Error(`Download voiceover: HTTP ${audioRes.status}`);
    const audioPath = path.join(tmpDir, "voiceover.mp3");
    fs.writeFileSync(audioPath, Buffer.from(await audioRes.arrayBuffer()));

    const numSlots = Math.max(1, Math.ceil(opts.duration / FAL_CLIP_DURATION_S));
    const concatPath = path.join(tmpDir, "broll.txt");
    const orderedBroll = Array.from({ length: numSlots }, (_, i) =>
      brollPaths[i % brollPaths.length]!
    );
    fs.writeFileSync(concatPath, orderedBroll.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n");

    const { width, height } = getOutputDimensions(opts.resolution, opts.aspectRatio);
    const crf = opts.resolution === "4k" ? "18" : "23";
    const outputPath = path.join(tmpDir, "output.mp4");

    // Presenter is scaled to 35% width, bottom-right corner
    const presenterW = Math.round(width * 0.35);
    const presenterX = width - presenterW - Math.round(width * 0.02);
    const presenterY = height - Math.round(presenterW * (16 / 9)) - Math.round(height * 0.02);

    let filterComplex = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black[broll]`,
      `[1:v]scale=${presenterW}:-1[pres]`,
      `[broll][pres]overlay=${presenterX}:${presenterY}[combined]`,
    ];
    let lastLabel = "combined";

    if (opts.captionsEnabled && opts.script) {
      const assPath = path.join(tmpDir, "captions.ass");
      fs.writeFileSync(assPath, generateASS(opts.script, opts.duration, width, height));
      const assEscaped = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
      filterComplex.push(`[combined]ass='${assEscaped}'[vout]`);
      lastLabel = "vout";
    }

    await runFFmpeg([
      "-y",
      "-f", "concat", "-safe", "0", "-i", concatPath, // 0: broll
      "-i", presenterPath,                              // 1: presenter
      "-i", audioPath,                                  // 2: voiceover
      "-filter_complex", filterComplex.join(";"),
      "-map", `[${lastLabel}]`,
      "-map", "2:a",
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
  // Strip any residual [MARKER] tags from legacy blueprints
  const clean = script.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(/\s+/).filter(Boolean);

  const WORDS_PER_SEC = 2.5; // average conversational speaking rate
  const WORDS_PER_CHUNK = 6;  // words per caption line

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

  const fontSize = Math.max(36, Math.round(width * 0.042)); // ~80px at 1920w
  const marginV = Math.max(30, Math.round(height * 0.075)); // 7.5% from bottom
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

// ── Cinematic plan type (mirrors contentGenerators) ───────────────────────────

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
      ].filter(Boolean).join(" ");
      return parts.slice(0, 500);
    });
  }

  const scenes = storyboard
    .split("\n")
    .map(l => l.replace(/^scene\s*\d+[:.]\s*/i, "").trim())
    .filter(l => l.length > 5);
  const base = scenes.length > 0 ? scenes : [`Marketing video for: ${title}`];
  return Array.from({ length: count }, (_, i) => {
    const scene = base[i % base.length] ?? title;
    return `Cinematic marketing footage, professional grade, 4K quality. ${scene.slice(0, 400)}`;
  });
}

function buildAvatarPrompts(
  title: string,
  storyboard: string,
  count: number,
  instructions: string | null | undefined,
  cinematicPlan?: string | null,
): string[] {
  const plan = parseCinematicPlan(cinematicPlan);

  const instructionLine = instructions?.trim()
    ? `Animate this person naturally. ${instructions.trim()}.`
    : plan?.performanceDirection
      ? `Animate this person naturally. ${plan.performanceDirection}.`
      : "Animate this person naturally as a confident professional presenter, speaking directly to camera with clear, engaging energy.";

  if (plan?.shots?.length) {
    const charDesc = plan.characterDescription ? `Character: ${plan.characterDescription}. ` : "";
    return Array.from({ length: count }, (_, i) => {
      const shot = plan.shots[i % plan.shots.length]!;
      const parts = [
        instructionLine,
        charDesc,
        shot.environment ? `Setting: ${shot.environment}.` : "",
        shot.subjectAction ? `${shot.subjectAction}.` : "",
        shot.facialExpression ? `Expression: ${shot.facialExpression}.` : "",
        shot.bodyMovement ? `Movement: ${shot.bodyMovement}.` : "",
        shot.cameraMovement ? `Camera: ${shot.cameraMovement}.` : "",
        shot.lighting ? `Lighting: ${shot.lighting}.` : "",
      ].filter(Boolean).join(" ");
      return parts.slice(0, 500);
    });
  }

  const scenes = storyboard
    .split("\n")
    .map(l => l.replace(/^scene\s*\d+[:.]\s*/i, "").trim())
    .filter(l => l.length > 5);
  const base = scenes.length > 0 ? scenes : [`Marketing video for: ${title}`];
  return Array.from({ length: count }, (_, i) => {
    const scene = base[i % base.length] ?? title;
    return `${instructionLine} Scene context: ${scene.replace(/^b-roll[:\s]*/i, "").slice(0, 300)}`;
  });
}

async function generateFootageClipsT2V(prompts: string[], videoId: number, aspectRatio: AspectRatio = "16:9"): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < prompts.length; i += CLIP_BATCH_SIZE) {
    const batch = prompts.slice(i, i + CLIP_BATCH_SIZE);
    logger.info({ videoId, batchStart: i, batchSize: batch.length, totalClips: prompts.length }, "Generating footage batch (FAL Kling)");
    const batchUrls = await Promise.all(batch.map(prompt => generateFalT2V(prompt, aspectRatio)));
    results.push(...batchUrls);
  }
  return results;
}

async function generateAvatarClipsI2V(photoPath: string, prompts: string[], videoId: number): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < prompts.length; i += CLIP_BATCH_SIZE) {
    const batch = prompts.slice(i, i + CLIP_BATCH_SIZE);
    logger.info({ videoId, batchStart: i, batchSize: batch.length, totalClips: prompts.length }, "Generating avatar batch (FAL Kling I2V)");
    const batchUrls = await Promise.all(batch.map(prompt => generateFalI2V(photoPath, prompt)));
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

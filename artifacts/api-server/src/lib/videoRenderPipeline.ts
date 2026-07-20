import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { deductPlatformCredits } from "./platformCredits.js";

const FFMPEG_BIN = "ffmpeg";

const logger = pino({ name: "videoRenderPipeline" });

// ── Render constants ──────────────────────────────────────────────────────────
const KLING_CLIP_DURATION_S = 5;
const CLIP_BATCH_SIZE = 5;

// ── API constants ─────────────────────────────────────────────────────────────
const ELEVENLABS_API_URL = "https://api.elevenlabs.io";
const KLING_BASE_URL = "https://api-singapore.klingai.com";
const KLING_DEFAULT_MODEL = "kling-v2-6";
const KLING_MODE = "std";
const KLING_NEGATIVE_PROMPT =
  "blurry, low quality, distorted, ugly, pixelated, amateur, watermark, text overlay";

// ── ElevenLabs voice resolution ───────────────────────────────────────────────

const VOICE_MALE_DEFAULT   = "pNInz6obpgDQGcFmaJgB";
const VOICE_FEMALE_DEFAULT = "oWAxZDx7w5VEj9dCyTzz";

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels?: Record<string, string>;
}

let _cachedVoices: ElevenLabsVoice[] | null = null;

async function fetchElevenLabsVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  if (_cachedVoices) return _cachedVoices;
  try {
    const res = await fetch(`${ELEVENLABS_API_URL}/v1/voices`, {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { voices: ElevenLabsVoice[] };
    _cachedVoices = data.voices ?? [];
    logger.info({ count: _cachedVoices.length }, "ElevenLabs voices fetched");
    return _cachedVoices;
  } catch {
    return [];
  }
}

async function resolveVoiceId(apiKey: string, characterDescription?: string | null): Promise<string> {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;

  const voices = await fetchElevenLabsVoices(apiKey);

  let genderHint: "male" | "female" | null = null;
  if (characterDescription) {
    const desc = characterDescription.toLowerCase();
    const femaleScore = ["female", "woman", "girl", "she/her", " she ", " her ", "latina", "asian"].filter(s => desc.includes(s)).length;
    const maleScore   = ["male", "man", " guy ", "he/him", " he ", " his ", "gentleman", "father"].filter(s => desc.includes(s)).length;
    if (femaleScore > maleScore) genderHint = "female";
    else if (maleScore > femaleScore) genderHint = "male";
  }

  const ownedCategories = ["cloned", "professional", "generated"];
  const ownedVoices = voices.filter(v => ownedCategories.includes(v.category));
  const premadeVoices = voices.filter(v => v.category === "premade");

  const pick = (pool: ElevenLabsVoice[]): string | null => {
    if (!pool.length) return null;
    if (!genderHint) return pool[0].voice_id;
    const genderLabels = genderHint === "female"
      ? ["female", "woman", "girl"]
      : ["male", "man", "boy", "guy"];
    const match = pool.find(v =>
      genderLabels.some(g =>
        v.name.toLowerCase().includes(g) ||
        Object.values(v.labels ?? {}).some(l => l.toLowerCase().includes(g))
      )
    );
    return match?.voice_id ?? pool[0].voice_id;
  };

  return pick(ownedVoices) ?? pick(premadeVoices) ?? (genderHint === "female" ? VOICE_FEMALE_DEFAULT : VOICE_MALE_DEFAULT);
}

// ── Public types ──────────────────────────────────────────────────────────────

export type RenderResolution = "1080p" | "4k";
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export interface RenderRequirementsResult {
  ready: boolean;
  missing: string[];
}

export function checkRenderRequirements(): RenderRequirementsResult {
  const missing: string[] = [];
  if (!process.env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
  if (!process.env.KLING_API_KEY) missing.push("KLING_API_KEY");
  return { ready: missing.length === 0, missing };
}

// ── Public entry point ────────────────────────────────────────────────────────

export function startVideoRender(
  videoId: number,
  resolution: RenderResolution,
  aspectRatio: AspectRatio = "16:9",
  captionsEnabled = false,
): void {
  runRenderPipeline(videoId, resolution, aspectRatio, captionsEnabled).catch((err) => {
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

// ── Core render pipeline ──────────────────────────────────────────────────────

async function runRenderPipeline(
  videoId: number,
  resolution: RenderResolution,
  aspectRatio: AspectRatio = "16:9",
  captionsEnabled = false,
): Promise<void> {
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, videoId));
  if (!video) throw new Error(`Video ${videoId} not found`);

  await db.update(videosTable).set({
    renderStatus: "processing",
    renderResolution: resolution,
    renderStartedAt: new Date(),
    renderError: null,
  }).where(eq(videosTable.id, videoId));

  // Step 1: ElevenLabs TTS
  const rawScript = video.voiceover ?? video.script ?? video.title;
  const scriptText = rawScript.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

  let characterDescription: string | null = null;
  if (video.cinematicPlan) {
    try {
      const plan = JSON.parse(video.cinematicPlan) as { characterDescription?: string };
      characterDescription = plan.characterDescription ?? null;
    } catch { /* ignore */ }
  }

  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY ?? "";
  const voiceId = await resolveVoiceId(elevenLabsApiKey, characterDescription);
  logger.info({ videoId, voiceId, characterDescription }, "Resolved ElevenLabs voice");

  let voiceoverUrl: string;
  try {
    voiceoverUrl = await generateElevenLabsVoiceover(scriptText ?? "", voiceId);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error({ err, videoId }, "ElevenLabs TTS failed");
    await markFailed(videoId, `Voiceover failed: ${detail}`);
    return;
  }
  const ttsChars = Math.min((scriptText ?? "").length, 800);
  deductPlatformCredits("elevenlabs", ttsChars, `TTS voiceover — video #${videoId}`).catch(() => {});
  await db.update(videosTable).set({ voiceoverUrl }).where(eq(videosTable.id, videoId));

  const duration = video.duration ?? 60;

  // Step 2: Kling T2V — generate cinematic footage from blueprint scenes
  const numClips = Math.max(1, Math.ceil(duration / KLING_CLIP_DURATION_S));
  const scenePrompts = buildScenePrompts(video.title, video.storyboard ?? "", numClips, video.cinematicPlan);

  let footageUrls: string[] = [];
  try {
    footageUrls = await generateFootageClipsT2V(scenePrompts, videoId, aspectRatio);
  } catch (err) {
    logger.error({ err, videoId }, "FAL clip generation failed");
    const msg = err instanceof Error && err.message.includes("timed out")
      ? "AI video generation is taking longer than expected. Please try again in a few minutes."
      : "AI video generation hit a temporary issue. Please try again — your credits were not charged.";
    await markFailed(videoId, msg);
    return;
  }

  deductPlatformCredits("kling", footageUrls.length, `AI clips (${footageUrls.length}) — video #${videoId}`, {
    minutesGenerated: (KLING_CLIP_DURATION_S / 60) * footageUrls.length,
    videosCount: footageUrls.length,
    projectId: video.projectId,
    videoId: String(videoId),
  }).catch(() => {});

  // Step 3: FFmpeg composition — stitch footage with voiceover (+ optional captions)
  let finalUrl: string;
  try {
    finalUrl = await composeWithFFmpeg({
      voiceoverUrl,
      footageUrls,
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

  await db.update(videosTable).set({
    renderStatus: "complete",
    videoUrl: finalUrl,
    renderCompletedAt: new Date(),
  }).where(eq(videosTable.id, videoId));
}

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────

class ElevenLabsPlanError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ElevenLabsPlanError";
  }
}

async function generateElevenLabsVoiceover(text: string, voiceId?: string): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");

  const selectedVoice = voiceId ?? VOICE_MALE_DEFAULT;
  const cappedText = text.length > 800 ? text.slice(0, 800) + "..." : text;

  let elevenLabsBuffer: Buffer | null = null;
  try {
    elevenLabsBuffer = await withRetry(async () => {
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
      if (response.status === 402 || response.status === 403) {
        const body = await response.text();
        throw new ElevenLabsPlanError(`ElevenLabs plan restriction (${response.status}): ${body.slice(0, 300)}`);
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ElevenLabs: ${response.status} ${body.slice(0, 200)}`);
      }
      return Buffer.from(await response.arrayBuffer());
    });
  } catch (err) {
    if (err instanceof ElevenLabsPlanError) {
      logger.warn({ msg: err.message }, "ElevenLabs plan restriction — falling back to OpenAI TTS");
    } else {
      throw err;
    }
  }

  if (elevenLabsBuffer) {
    return await uploadAudioToStorage(elevenLabsBuffer, "mp3");
  }

  const { textToSpeech } = await import("@workspace/integrations-openai-ai-server/audio");
  const cachedVoice = _cachedVoices?.find(v => v.voice_id === selectedVoice);
  const isFemaleVoice = cachedVoice?.labels?.["gender"] === "female"
    || ["female", "woman", "girl"].some(g => cachedVoice?.name.toLowerCase().includes(g));
  const openAiVoice = isFemaleVoice ? "nova" : "onyx";
  logger.info({ openAiVoice }, "Generating voiceover via OpenAI gpt-audio TTS");
  const wavBuffer = await textToSpeech(cappedText, openAiVoice, "wav");
  return await uploadAudioToStorage(wavBuffer, "wav");
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

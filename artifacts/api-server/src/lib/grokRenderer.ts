import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pino from "pino";
import { extractNarrationLines } from "./dialogue.js";
import type { CommercialRenderer, CommercialRenderJob, CommercialRenderResult, CommercialRendererCapabilities } from "./commercialRenderer.js";
import { buildGrokGenerationRequest, GROK_VIDEO_ENDPOINT, GROK_VIDEO_STATUS_ENDPOINT } from "./grokRequest.js";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";

const logger = pino({ name: "grokRenderer" });
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_POLLS = 90;
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const OUTPUT_DIMS: Record<CommercialRenderJob["aspectRatio"], { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 }, "4:5": { width: 1080, height: 1350 },
};
export const GROK_STORAGE_REFERENCE_PREFIX = "grok-object://";
export const GROK_MEDIA_PATH = "/api/projects";

type GrokStatus = { request_id?: string; status?: string; video?: { url?: string; duration?: number }; error?: string };
export interface GrokRendererDependencies {
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  save(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  signUrl(bucket: string, key: string): Promise<string>;
  normalizeFrame(input: Buffer, aspectRatio: CommercialRenderJob["aspectRatio"], durationSec: number): Promise<Buffer>;
  assemble(clips: Buffer[], targetDurationSec: number): Promise<Buffer>;
  pollIntervalMs: number;
  maxPolls: number;
}

const defaults: GrokRendererDependencies = {
  fetch: (...args) => fetch(...args),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  save: async (bucket, key, body, contentType) => objectStorageClient.bucket(bucket).file(key).save(body, { metadata: { contentType } }),
  signUrl: (bucket, key) => signObjectURL({ bucketName: bucket, objectName: key, method: "GET", ttlSec: 604800 }),
  normalizeFrame: normalizeVideoFrame,
  assemble: assembleVideo,
  pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  maxPolls: DEFAULT_MAX_POLLS,
};

export class GrokCommercialRenderer implements CommercialRenderer {
  readonly name = "GrokCommercialRenderer";
  readonly description = "xAI Grok Imagine video generation with native audio";
  readonly capabilities: CommercialRendererCapabilities = {
    supportsVoiceover: true,
    supportsFootage: true,
    supportsCaptions: false,
    maxResolution: "1080p",
  };
  private readonly deps: GrokRendererDependencies;

  constructor(overrides: Partial<GrokRendererDependencies> = {}) {
    this.deps = { ...defaults, ...overrides };
  }

  private get apiKey(): string {
    const key = process.env.GROWTHFORGE_GROK_API_KEY;
    if (!key) throw new Error("Grok provider is not configured");
    return key;
  }

  isAvailable(): boolean {
    return process.env.GROK_VIDEO_ENABLED === "true" &&
      Boolean(
        process.env.GROWTHFORGE_GROK_API_KEY &&
        process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID &&
        process.env.OBJECT_STORAGE_ENDPOINT &&
        process.env.OBJECT_STORAGE_REGION &&
        process.env.OBJECT_STORAGE_ACCESS_KEY_ID &&
        process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY
      );
  }

  async render(job: CommercialRenderJob): Promise<CommercialRenderResult> {
    if (!this.isAvailable()) throw new Error("Grok video generation is disabled or not configured");
    const bucket = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucket) throw new Error("Object storage is not configured");
    const targetDurationSec = job.durationSec ?? 15;
    if (!Number.isInteger(targetDurationSec) || targetDurationSec < 1 || targetDurationSec > 60) {
      throw new Error("Commercial duration must be an integer from 1 to 60 seconds");
    }
    const dialogueLines = extractNarrationLines(job.script);

    const segmentCount = Math.ceil(targetDurationSec / 15);
    const clips: Buffer[] = [];
    const linesPerSegment = Math.ceil(dialogueLines.length / segmentCount);
    const segmentDialogue = Array.from({ length: segmentCount }, (_, index) =>
      dialogueLines.slice(index * linesPerSegment, (index + 1) * linesPerSegment),
    );
    for (let index = 0; index < segmentCount; index++) {
      const startSec = index * 15;
      const durationSec = Math.min(15, targetDurationSec - startSec);
      const segmentJob: CommercialRenderJob = {
        ...job,
        script: (segmentDialogue[index] ?? []).map(line => `Actor Line: ${line}`).join("\n"),
        durationSec,
        totalDurationSec: targetDurationSec,
        segmentStartSec: startSec,
        segmentIndex: index + 1,
        segmentCount,
      };
      clips.push(await this.renderClip(segmentJob));
    }

    const finalBytes = await this.deps.assemble(clips, targetDurationSec);
    if (!finalBytes.length || finalBytes.length > MAX_VIDEO_BYTES) throw new Error("Assembled commercial is empty or exceeds the maximum allowed size");
    const bucketKey = `commercial/grok/${job.videoId}/${Date.now()}-assembled.mp4`;
    await this.deps.save(bucket, bucketKey, finalBytes, "video/mp4");
    const videoUrl = `grok-object://${encodeURIComponent(bucket)}/${bucketKey.split("/").map(encodeURIComponent).join("/")}`;
    logger.info({ videoId: job.videoId, segments: segmentCount, durationSec: targetDurationSec, bytes: finalBytes.length }, "Assembled native-audio commercial stored");
    return { videoUrl, durationSec: targetDurationSec, sceneJobIds: [] };
  }

  private async renderClip(job: CommercialRenderJob): Promise<Buffer> {
    const apiKey = this.apiKey;
    const request = buildGrokGenerationRequest(job);
    const submitted = await this.requestJson("POST", GROK_VIDEO_ENDPOINT, apiKey, request);
    const requestId = submitted.request_id;
    if (!requestId) throw new Error("Grok submission returned no request_id");
    logger.info({ videoId: job.videoId, requestId, duration: request.duration, segment: job.segmentIndex }, "Grok native-audio video segment submitted");

    let completed: GrokStatus | undefined;
    for (let poll = 0; poll < this.deps.maxPolls; poll++) {
      await this.deps.sleep(this.deps.pollIntervalMs);
      const status = await this.requestJson("GET", `${GROK_VIDEO_STATUS_ENDPOINT}/${encodeURIComponent(requestId)}`, apiKey);
      const normalized = (status.status ?? "").toLowerCase();
      if (["done", "completed", "succeeded"].includes(normalized)) { completed = status; break; }
      if (["failed", "error", "cancelled"].includes(normalized)) throw new Error(`Grok generation failed${status.error ? `: ${status.error}` : ""}`);
    }
    if (!completed) throw new Error("Grok video generation timed out; no automatic retry was attempted");
    const url = completed.video?.url;
    if (!url) throw new Error("Grok completed without a downloadable video URL");
    const downloadUrl = new URL(url);
    const host = downloadUrl.hostname.toLowerCase();
    const trustedHost = host === "x.ai" || host.endsWith(".x.ai") || host === "grok.com" || host.endsWith(".grok.com");
    if (downloadUrl.protocol !== "https:" || !trustedHost) throw new Error("Grok returned a video URL from an untrusted host");
    const response = await this.deps.fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Grok video download failed (HTTP ${response.status})`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_VIDEO_BYTES) throw new Error("Grok video exceeds the maximum allowed download size");
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    if (!response.body) throw new Error("Grok returned an empty video response");
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.length;
      if (totalBytes > MAX_VIDEO_BYTES) throw new Error("Grok video exceeds the maximum allowed download size");
      chunks.push(bytes);
    }
    const input = Buffer.concat(chunks, totalBytes);
    if (!input.length || input.length > MAX_VIDEO_BYTES) throw new Error("Grok returned an invalid or oversized video file");
    return this.deps.normalizeFrame(input, job.aspectRatio, request.duration);
  }

  private async requestJson(method: "GET" | "POST", url: string, apiKey: string, body?: unknown): Promise<GrokStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException("Grok API request timed out", "TimeoutError")), 30_000);
    try {
      const response = await this.deps.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      // Consume response text in this try/catch: fetch may resolve headers and
      // then abort while the body is streaming. Awaiting json() outside guarded
      // handling caused an unhandled Readable error to terminate the API process.
      const responseText = await response.text();
      if (!response.ok) throw new Error(`Grok API ${method} failed (HTTP ${response.status}): ${responseText.slice(0, 500)}`);
      try { return JSON.parse(responseText) as GrokStatus; }
      catch { throw new Error(`Grok API ${method} returned invalid JSON`); }
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Grok API ${method} timed out while requesting ${new URL(url).pathname}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function normalizeVideoFrame(input: Buffer, aspectRatio: CommercialRenderJob["aspectRatio"], durationSec: number): Promise<Buffer> {
  const { width, height } = OUTPUT_DIMS[aspectRatio];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-frame-"));
  const inputPath = path.join(dir, "input.mp4");
  const outputPath = path.join(dir, "output.mp4");
  try {
    fs.writeFileSync(inputPath, input);
    await new Promise<void>((resolve, reject) => {
      const filter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
      const child = spawn("ffmpeg", ["-y", "-i", inputPath, "-t", String(durationSec), "-vf", filter, "-map", "0:v:0", "-map", "0:a:0", "-af", `apad,atrim=duration=${durationSec}`, "-c:v", "libx264", "-c:a", "aac", "-b:a", "128k", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error(`Video frame normalization failed (FFmpeg ${code}): ${stderr}`)));
    });
    const output = fs.readFileSync(outputPath);
    if (!output.length || output.length > MAX_VIDEO_BYTES) throw new Error("Normalized video is empty or exceeds the maximum allowed size");
    return output;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function assembleVideo(clips: Buffer[], targetDurationSec: number): Promise<Buffer> {
  if (clips.length === 0) throw new Error("Cannot assemble a commercial without picture clips");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-commercial-"));
  const clipPaths = clips.map((clip, i) => {
    const clipPath = path.join(dir, `clip-${i}.mp4`);
    fs.writeFileSync(clipPath, clip);
    return clipPath;
  });
  const listPath = path.join(dir, "clips.txt");
  const outputPath = path.join(dir, "assembled.mp4");
  fs.writeFileSync(listPath, clipPaths.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  try {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-map", "0:v:0", "-map", "0:a:0", "-vf", `tpad=stop_mode=clone:stop_duration=${targetDurationSec}`,
      "-af", `apad,atrim=duration=${targetDurationSec}`, "-t", String(targetDurationSec),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath]);
    const output = fs.readFileSync(outputPath);
    const actualDuration = await probeDuration(outputPath);
    if (Math.abs(actualDuration - targetDurationSec) > 0.25) throw new Error(`Assembled video duration ${actualDuration}s does not match requested ${targetDurationSec}s`);
    return output;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg assembly failed (${code}): ${stderr}`)));
  });
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.once("error", reject);
    child.once("close", code => {
      const duration = Number(stdout.trim());
      if (code !== 0 || !Number.isFinite(duration)) reject(new Error("Could not verify assembled video duration with ffprobe"));
      else resolve(duration);
    });
  });
}

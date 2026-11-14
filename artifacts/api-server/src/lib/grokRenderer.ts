import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import pino from "pino";
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
  normalizeFrame(input: Buffer, aspectRatio: CommercialRenderJob["aspectRatio"]): Promise<Buffer>;
  pollIntervalMs: number;
  maxPolls: number;
}

const defaults: GrokRendererDependencies = {
  fetch: (...args) => fetch(...args),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  save: async (bucket, key, body, contentType) => objectStorageClient.bucket(bucket).file(key).save(body, { metadata: { contentType } }),
  signUrl: (bucket, key) => signObjectURL({ bucketName: bucket, objectName: key, method: "GET", ttlSec: 604800 }),
  normalizeFrame: normalizeVideoFrame,
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
    const apiKey = this.apiKey;
    const request = buildGrokGenerationRequest(job);
    const submitted = await this.requestJson("POST", GROK_VIDEO_ENDPOINT, apiKey, request);
    const requestId = submitted.request_id;
    if (!requestId) throw new Error("Grok submission returned no request_id");
    logger.info({ videoId: job.videoId, requestId, duration: request.duration }, "Grok video job submitted");

    let completed: GrokStatus | undefined;
    for (let poll = 0; poll < this.deps.maxPolls; poll++) {
      await this.deps.sleep(this.deps.pollIntervalMs);
      const status = await this.requestJson("GET", `${GROK_VIDEO_STATUS_ENDPOINT}/${encodeURIComponent(requestId)}`, apiKey);
      const normalized = (status.status ?? "").toLowerCase();
      if (["done", "completed", "succeeded"].includes(normalized)) { completed = status; break; }
      if (["failed", "error", "cancelled"].includes(normalized)) {
        throw new Error(`Grok generation failed${status.error ? `: ${status.error}` : ""}`);
      }
    }
    if (!completed) throw new Error("Grok video generation timed out; no automatic retry was attempted");
    const url = completed.video?.url;
    if (!url) throw new Error("Grok completed without a downloadable video URL");
    const downloadUrl = new URL(url);
    const host = downloadUrl.hostname.toLowerCase();
    const trustedHost = host === "x.ai" || host.endsWith(".x.ai") || host === "grok.com" || host.endsWith(".grok.com");
    if (downloadUrl.protocol !== "https:" || !trustedHost) {
      throw new Error("Grok returned a video URL from an untrusted host");
    }
    const videoResponse = await this.deps.fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) });
    if (!videoResponse.ok) throw new Error(`Grok video download failed (HTTP ${videoResponse.status})`);
    const declaredSize = Number(videoResponse.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_VIDEO_BYTES) throw new Error("Grok video exceeds the maximum allowed download size");
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    if (!videoResponse.body) throw new Error("Grok returned an empty video response");
    for await (const chunk of videoResponse.body) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.length;
      if (totalBytes > MAX_VIDEO_BYTES) throw new Error("Grok video exceeds the maximum allowed download size");
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks, totalBytes);
    if (bytes.length === 0 || bytes.length > MAX_VIDEO_BYTES) throw new Error("Grok returned an invalid or oversized video file");

    const normalizedBytes = await this.deps.normalizeFrame(bytes, job.aspectRatio);
    const key = `commercial/grok/${job.videoId}/${Date.now()}-${requestId}.mp4`;
    await this.deps.save(bucket, key, normalizedBytes, "video/mp4");
    // Persist a stable internal reference, not an expiring presigned URL.
    // Routes convert it into an authenticated media link on demand.
    const videoUrl = `grok-object://${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
    logger.info({ videoId: job.videoId, requestId, bytes: normalizedBytes.length, aspectRatio: job.aspectRatio, width: OUTPUT_DIMS[job.aspectRatio].width, height: OUTPUT_DIMS[job.aspectRatio].height }, "Normalized video stored in object storage");
    return { videoUrl, durationSec: completed.video?.duration ?? request.duration };
  }

  private async requestJson(method: "GET" | "POST", url: string, apiKey: string, body?: unknown): Promise<GrokStatus> {
    const response = await this.deps.fetch(url, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 500);
      throw new Error(`Grok API ${method} failed (HTTP ${response.status}): ${errorText}`);
    }
    return await response.json() as GrokStatus;
  }
}

async function normalizeVideoFrame(input: Buffer, aspectRatio: CommercialRenderJob["aspectRatio"]): Promise<Buffer> {
  const { width, height } = OUTPUT_DIMS[aspectRatio];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-frame-"));
  const inputPath = path.join(dir, "input.mp4");
  const outputPath = path.join(dir, "output.mp4");
  try {
    fs.writeFileSync(inputPath, input);
    await new Promise<void>((resolve, reject) => {
      const filter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`;
      const child = spawn("ffmpeg", ["-y", "-i", inputPath, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputPath], { stdio: ["ignore", "ignore", "pipe"] });
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

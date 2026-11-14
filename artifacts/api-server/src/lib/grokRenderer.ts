import pino from "pino";
import type { CommercialRenderer, CommercialRenderJob, CommercialRenderResult, CommercialRendererCapabilities } from "./commercialRenderer.js";
import { buildGrokGenerationRequest, GROK_VIDEO_ENDPOINT, GROK_VIDEO_STATUS_ENDPOINT } from "./grokRequest.js";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";

const logger = pino({ name: "grokRenderer" });
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_POLLS = 90;
const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
export const GROK_STORAGE_REFERENCE_PREFIX = "grok-object://";
export const GROK_MEDIA_PATH = "/api/projects";

type GrokStatus = { request_id?: string; status?: string; video?: { url?: string; duration?: number }; error?: string };
export interface GrokRendererDependencies {
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  save(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
  signUrl(bucket: string, key: string): Promise<string>;
  pollIntervalMs: number;
  maxPolls: number;
}

const defaults: GrokRendererDependencies = {
  fetch: (...args) => fetch(...args),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  save: async (bucket, key, body, contentType) => objectStorageClient.bucket(bucket).file(key).save(body, { metadata: { contentType } }),
  signUrl: (bucket, key) => signObjectURL({ bucketName: bucket, objectName: key, method: "GET", ttlSec: 604800 }),
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

    const key = `commercial/grok/${job.videoId}/${Date.now()}-${requestId}.mp4`;
    await this.deps.save(bucket, key, bytes, "video/mp4");
    // Persist a stable internal reference, not an expiring presigned URL.
    // Routes convert it into an authenticated media link on demand.
    const videoUrl = `grok-object://${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
    logger.info({ videoId: job.videoId, requestId, bytes: bytes.length }, "Grok video stored in object storage");
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

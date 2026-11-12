import pino from "pino";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";
import { db, klingSceneJobsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const logger = pino({ name: "omniRenderer" });
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODEL_ID = "gemini-omni-1.2-flash";
export const OMNI_SCENE_DURATION_SEC = 8;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 20 * 60_000;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export interface OmniSceneRenderRequest {
  sceneJobId: number;
  videoId: number;
  sceneIndex: number;
  prompt: string;
  aspectRatio: string;
  durationSec: number;
  newSceneCut: boolean;
  sourceFrameUrl?: string | null;
}

export interface OmniSceneRenderResult {
  videoUrl: string;
  durationSec: number;
  providerTaskId: string;
}

interface InteractionContent {
  type?: string;
  mime_type?: string;
  data?: string;
  uri?: string;
  status?: string;
}
interface InteractionStep { type?: string; content?: InteractionContent[] }
interface InteractionResponse {
  id?: string;
  status?: string;
  model?: string;
  steps?: InteractionStep[];
  errors?: Array<{ message?: string }>;
}

interface VideoFileResponse {
  state?: string;
  uri?: string;
  downloadUri?: string;
  mime_type?: string;
}

interface InteractionInputContent {
  type: "text" | "image";
  text?: string;
  mime_type?: string;
  data?: string;
}

const FILES_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/files";

function apiKey(): string {
  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENAI_API_KEY environment variable is not configured");
  return key;
}

function mapAspectRatio(aspectRatio: string): "16:9" | "9:16" {
  return aspectRatio === "9:16" ? "9:16" : "16:9";
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestJson(url: string, init: RequestInit): Promise<InteractionResponse> {
  const response = await fetch(url, {
    ...init,
    headers: { "x-goog-api-key": apiKey(), ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Gemini Omni API HTTP ${response.status}: ${text.slice(0, 1200)}`);
  try {
    return JSON.parse(text) as InteractionResponse;
  } catch {
    throw new Error(`Gemini Omni returned invalid JSON: ${text.slice(0, 500)}`);
  }
}

async function fetchImage(url: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Gemini Omni source-frame fetch HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
  if (!mimeType.startsWith("image/")) throw new Error(`Gemini Omni source frame is not an image (${mimeType})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) {
    throw new Error(`Gemini Omni source frame has unexpected size (${bytes.length} bytes)`);
  }
  return { mimeType, data: bytes.toString("base64") };
}

async function submitInteraction(request: OmniSceneRenderRequest): Promise<InteractionResponse> {
  const input: InteractionInputContent[] = [];
  if (!request.newSceneCut && request.sourceFrameUrl) {
    const image = await fetchImage(request.sourceFrameUrl);
    input.push({ type: "image", mime_type: image.mimeType, data: image.data });
    input.push({ type: "text", text: `Use the provided image as the visual starting reference and continue the commercial scene consistently. ${request.prompt}` });
  } else {
    input.push({ type: "text", text: request.prompt });
  }
  return requestJson(`${BASE_URL}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_ID,
      input,
      response_format: {
        type: "video",
        duration: `${OMNI_SCENE_DURATION_SEC}s`,
        resolution: "1080p",
        aspect_ratio: mapAspectRatio(request.aspectRatio),
        delivery: "uri",
      },
      background: true,
      store: true,
    }),
    signal: AbortSignal.timeout(90_000),
  });
}

async function pollInteraction(interactionId: string): Promise<InteractionResponse> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await requestJson(`${BASE_URL}/interactions/${encodeURIComponent(interactionId)}`, {
      method: "GET",
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status === "completed") return response;
    if (["failed", "cancelled", "canceled", "expired"].includes(response.status ?? "")) {
      const detail = response.errors?.map(error => error.message).filter(Boolean).join("; ");
      throw new Error(`Gemini Omni interaction ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Gemini Omni interaction timed out after ${POLL_TIMEOUT_MS / 60_000} minutes (id=${interactionId})`);
}

function extractVideoData(response: InteractionResponse): Buffer | string {
  const video = response.steps
    ?.filter(step => step.type === "model_output")
    .flatMap(step => step.content ?? [])
    .find(content => content.type === "video" && content.mime_type === "video/mp4" && (content.data || content.uri));
  if (!video) throw new Error("Gemini Omni completed without an MP4 video in its model_output steps");
  if (video.uri) return video.uri;
  if (!video.data) throw new Error("Gemini Omni MP4 output had neither inline data nor a URI");
  const bytes = Buffer.from(video.data, "base64");
  if (bytes.length < 1024 || bytes.length > MAX_VIDEO_BYTES) {
    throw new Error(`Gemini Omni MP4 has unexpected size (${bytes.length} bytes)`);
  }
  return bytes;
}

/**
 * Extract the Files API resource name from a hosted-video URI.
 *
 * `delivery: "uri"` returns e.g.
 *   https://generativelanguage.googleapis.com/v1beta/files/figwq4tpkvuv:download?alt=media
 * The `:download` custom-method verb is NOT part of the resource name —
 * including it makes GetFile fail with HTTP 400 "File name may only contain
 * lowercase alphanumeric characters or dashes". Verified against the live API.
 */
function parseFileResourceName(uri: string): string | null {
  return uri.match(/\/files\/([^:?#/]+)(?::[a-zA-Z]+)?(?:[?#]|$)/)?.[1] ?? null;
}

/**
 * Wait for the hosted file to become ACTIVE, then return its metadata
 * (`downloadUri` / `uri`) so the byte fetch never depends on a stale verb URL.
 */
async function waitForActiveFile(fileId: string): Promise<VideoFileResponse | null> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const file = await requestJson(`${FILES_BASE_URL}/${encodeURIComponent(fileId)}`, {
      method: "GET",
      signal: AbortSignal.timeout(30_000),
    }) as InteractionResponse & VideoFileResponse & { downloadUri?: string };
    if (file.state === "ACTIVE") return file;
    if (["FAILED", "CANCELLED", "CANCELED"].includes(file.state ?? "")) {
      throw new Error(`Gemini Omni hosted video file entered ${file.state} state`);
    }
    await sleep(2_000);
  }
  throw new Error("Gemini Omni hosted video file did not become ACTIVE within five minutes");
}

async function downloadVideo(uri: string): Promise<Buffer> {
  const fileId = parseFileResourceName(uri);
  let downloadUrl = uri;

  if (fileId) {
    // Metadata polling is a readiness check, not a hard requirement: if it
    // fails for any reason we still try the URI the interaction handed us
    // rather than throwing away a clip Google has already charged for.
    try {
      const meta = await waitForActiveFile(fileId) as (VideoFileResponse & { downloadUri?: string }) | null;
      downloadUrl = meta?.downloadUri || meta?.uri || uri;
    } catch (err) {
      logger.warn({ err, fileId }, "[OmniRenderer] File metadata poll failed - fetching returned URI directly");
      downloadUrl = uri;
    }
  }

  const response = await fetch(downloadUrl, {
    headers: { "x-goog-api-key": apiKey() },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Gemini Omni video download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024 || bytes.length > MAX_VIDEO_BYTES) {
    throw new Error(`Gemini Omni downloaded MP4 has unexpected size (${bytes.length} bytes)`);
  }
  return bytes;
}

async function storeSceneMp4(bytes: Buffer, videoId: number, sceneIndex: number): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  const objectName = `renders/omni/video-${videoId}-scene-${sceneIndex}.mp4`;
  await objectStorageClient.bucket(bucketId).file(objectName).save(bytes, { metadata: { contentType: "video/mp4" } });
  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 14_400 });
}

export class OmniRenderer {
  async renderScene(request: OmniSceneRenderRequest): Promise<OmniSceneRenderResult> {
    const interaction = await submitInteraction(request);
    if (!interaction.id) throw new Error("Gemini Omni create interaction returned no interaction id");

    // Persist before polling so a process restart resumes this paid job instead of submitting a duplicate.
    await db.update(klingSceneJobsTable)
      .set({ externalTaskId: interaction.id, status: "processing", model: MODEL_ID, updatedAt: new Date() })
      .where(eq(klingSceneJobsTable.id, request.sceneJobId));

    return this.finishScene(request, interaction.id, interaction.status === "completed" ? interaction : undefined);
  }

  async resumeScene(request: OmniSceneRenderRequest, interactionId: string): Promise<OmniSceneRenderResult> {
    return this.finishScene(request, interactionId);
  }

  private async finishScene(
    request: OmniSceneRenderRequest,
    interactionId: string,
    completedResponse?: InteractionResponse,
  ): Promise<OmniSceneRenderResult> {
    logger.info({ sceneJobId: request.sceneJobId, interactionId }, "[OmniRenderer] Waiting for native-audio video generation");
    const response = completedResponse ?? await pollInteraction(interactionId);
    if (response.model && response.model !== MODEL_ID) {
      throw new Error(`Gemini returned unexpected model ${response.model}; expected ${MODEL_ID}`);
    }
    const video = extractVideoData(response);
    const bytes = typeof video === "string" ? await downloadVideo(video) : video;
    const videoUrl = await storeSceneMp4(bytes, request.videoId, request.sceneIndex);
    logger.info({ sceneJobId: request.sceneJobId, interactionId, bytes: bytes.length, videoUrl }, "[OmniRenderer] Native-audio MP4 stored");
    return { videoUrl, durationSec: OMNI_SCENE_DURATION_SEC, providerTaskId: interactionId };
  }
}

let instance: OmniRenderer | null = null;
export function getOmniRenderer(): OmniRenderer {
  if (!instance) instance = new OmniRenderer();
  return instance;
}

export function checkOmniRequirements(): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.GOOGLE_GENAI_API_KEY) missing.push("GOOGLE_GENAI_API_KEY");
  if (!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) missing.push("DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  return { ready: missing.length === 0, missing };
}

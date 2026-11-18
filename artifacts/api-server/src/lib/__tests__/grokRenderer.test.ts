import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleVideo, GrokCommercialRenderer, normalizeVideoFrame } from "../grokRenderer.js";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommercialRenderJob } from "../commercialRenderer.js";

const job: CommercialRenderJob = {
  videoId: 42, resolution: "1080p", aspectRatio: "9:16", captionsEnabled: false,
  script: "Actor Line: \"Hello there.\"", storyboard: "A person presents a product.", durationSec: 8,
};
const original = {
  enabled: process.env.GROK_VIDEO_ENABLED,
  key: process.env.GROWTHFORGE_GROK_API_KEY,
  bucket: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
  storageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT,
  storageRegion: process.env.OBJECT_STORAGE_REGION,
  storageAccessKey: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
  storageSecret: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
};
afterEach(() => {
  if (original.enabled === undefined) delete process.env.GROK_VIDEO_ENABLED; else process.env.GROK_VIDEO_ENABLED = original.enabled;
  if (original.key === undefined) delete process.env.GROWTHFORGE_GROK_API_KEY; else process.env.GROWTHFORGE_GROK_API_KEY = original.key;
  if (original.bucket === undefined) delete process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID; else process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = original.bucket;
  if (original.storageEndpoint === undefined) delete process.env.OBJECT_STORAGE_ENDPOINT; else process.env.OBJECT_STORAGE_ENDPOINT = original.storageEndpoint;
  if (original.storageRegion === undefined) delete process.env.OBJECT_STORAGE_REGION; else process.env.OBJECT_STORAGE_REGION = original.storageRegion;
  if (original.storageAccessKey === undefined) delete process.env.OBJECT_STORAGE_ACCESS_KEY_ID; else process.env.OBJECT_STORAGE_ACCESS_KEY_ID = original.storageAccessKey;
  if (original.storageSecret === undefined) delete process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY; else process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = original.storageSecret;
});

describe("GrokCommercialRenderer (mocked provider, no paid requests)", () => {
  it("polls an async job, retrieves the completed MP4, and stores it", async () => {
    process.env.GROK_VIDEO_ENABLED = "true";
    process.env.GROWTHFORGE_GROK_API_KEY = "mock-key";
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "mock-bucket";
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.invalid";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "mock-access";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "mock-secret";
    const saved: unknown[] = [];
    const assembled: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-123", status: "pending" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-123", status: "done", video: { url: "https://vidgen.x.ai/output.mp4", duration: 8 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200, headers: { "content-type": "video/mp4", "content-length": "8" } }));
    const renderer = new GrokCommercialRenderer({
      fetch: fetchMock, sleep: async () => {}, pollIntervalMs: 0, maxPolls: 3,
      save: async (...args) => { saved.push(args); },
      signUrl: async (_bucket, key) => `https://storage.invalid/${key}`,
      normalizeFrame: async input => input,
      assemble: async (clips, duration) => { assembled.push({ clips, duration }); return Buffer.from("final-video"); },
    });
    const result = await renderer.render(job);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.x.ai/v1/videos/generations");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.x.ai/v1/videos/req-123");
    expect(fetchMock.mock.calls[2]?.[0]).toBeInstanceOf(URL);
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("https://vidgen.x.ai/output.mp4");
    expect(saved).toHaveLength(1);
    expect(assembled).toHaveLength(1);
    expect((assembled[0] as { duration: number }).duration).toBe(8);
    const generationBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(generationBody.generate_audio).toBe(true);
    expect(generationBody.prompt).toContain("Hello there.");
    expect(generationBody.prompt).toContain("ONLY these exact approved words");
    expect(generationBody.duration).toBe(8);
    expect(result.videoUrl).toMatch(/^grok-object:\/\/mock-bucket\/commercial\/grok\/42\//);
    expect(result.durationSec).toBe(8);
  });

  it("renders 45 seconds as three sequential native-audio Grok clips and assembles one final file", async () => {
    process.env.GROK_VIDEO_ENABLED = "true";
    process.env.GROWTHFORGE_GROK_API_KEY = "mock-key";
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "mock-bucket";
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.invalid";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "mock-access";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "mock-secret";
    const bodies: Array<{ duration: number; generate_audio: boolean; prompt: string }> = [];
    let n = 0;
    const fetchMock = vi.fn<typeof fetch>((async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/generations")) {
        bodies.push(JSON.parse(String(init?.body)) as typeof bodies[number]);
        n++;
        return new Response(JSON.stringify({ request_id: `segment-${n}` }), { status: 200 });
      }
      if (href.includes("/videos/")) return new Response(JSON.stringify({ request_id: `segment-${n}`, status: "done", video: { url: `https://vidgen.x.ai/${n}.mp4`, duration: 15 } }), { status: 200 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
    }) as typeof fetch);
    const assembled: { clips: Buffer[]; duration: number }[] = [];
    const renderer = new GrokCommercialRenderer({
      fetch: fetchMock, sleep: async () => {}, pollIntervalMs: 0, maxPolls: 1,
      save: async () => {}, signUrl: async () => "unused", normalizeFrame: async input => input,
      assemble: async (clips, duration) => { assembled.push({ clips, duration }); return Buffer.from("complete"); },
    });
    const result = await renderer.render({ ...job, script: Array.from({ length: 9 }, (_, i) => `\"Line ${i + 1}\"`).join("\n"), durationSec: 45, totalDurationSec: 45,
      cinematicPlan: JSON.stringify({ shots: Array.from({ length: 9 }, (_, i) => ({ duration: 5, subjectAction: `Scene ${i + 1}`, dialogue: `Line ${i + 1}` })) }) });
    expect(bodies.map(body => body.duration)).toEqual([15, 15, 15]);
    expect(bodies.every(body => body.generate_audio === true)).toBe(true);
    expect(bodies[0]?.prompt).toContain("Scene 1");
    expect(bodies[0]?.prompt).toContain("Line 1");
    expect(bodies[0]?.prompt).toContain("Line 3");
    expect(bodies[0]?.prompt).not.toContain("Line 4");
    expect(bodies[0]?.prompt).not.toContain("Scene 8");
    expect(bodies[1]?.prompt).toContain("Scene 4");
    expect(bodies[1]?.prompt).toContain("Line 4");
    expect(bodies[1]?.prompt).not.toContain("Line 1");
    expect(bodies[2]?.prompt).toContain("Scene 7");
    expect(bodies[2]?.prompt).toContain("Line 7");
    expect(bodies[2]?.prompt).not.toContain("Line 4");
    expect(assembled).toHaveLength(1);
    expect(assembled[0]?.clips).toHaveLength(3);
    expect(assembled[0]?.duration).toBe(45);
    expect(result.durationSec).toBe(45);
  });

  it("assembles an exact non-multiple duration using a short final segment", async () => {
    process.env.GROK_VIDEO_ENABLED = "true";
    process.env.GROWTHFORGE_GROK_API_KEY = "mock-key";
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "mock-bucket";
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.invalid";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "mock-access";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "mock-secret";
    const durations: number[] = [];
    const fetchMock = vi.fn<typeof fetch>((async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/generations")) {
        durations.push((JSON.parse(String(init?.body)) as { duration: number }).duration);
        return new Response(JSON.stringify({ request_id: `segment-${durations.length}` }), { status: 200 });
      }
      if (href.includes("/videos/")) return new Response(JSON.stringify({ request_id: "segment", status: "done", video: { url: "https://vidgen.x.ai/clip.mp4", duration: 15 } }), { status: 200 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch);
    let assembledDuration = 0;
    const renderer = new GrokCommercialRenderer({
      fetch: fetchMock, sleep: async () => {}, pollIntervalMs: 0, maxPolls: 1,
      save: async () => {}, signUrl: async () => "unused", normalizeFrame: async input => input,
      assemble: async (_clips, duration) => { assembledDuration = duration; return Buffer.from("complete"); },
    });
    const result = await renderer.render({ ...job, script: "Approved plain dialogue.", durationSec: 37 });
    expect(durations).toEqual([15, 15, 7]);
    expect(assembledDuration).toBe(37);
    expect(result.durationSec).toBe(37);
  });

  it("stays disabled unless the enable flag and credentials are explicitly present", async () => {
    process.env.GROK_VIDEO_ENABLED = "false";
    process.env.GROWTHFORGE_GROK_API_KEY = "mock-key";
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "mock-bucket";
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.invalid";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "mock-access";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "mock-secret";
    const renderer = new GrokCommercialRenderer({ fetch: vi.fn<typeof fetch>() });
    expect(renderer.isAvailable()).toBe(false);
    await expect(renderer.render(job)).rejects.toThrow("disabled or not configured");
  });

  it("does not retry a failed provider job", async () => {
    process.env.GROK_VIDEO_ENABLED = "true";
    process.env.GROWTHFORGE_GROK_API_KEY = "mock-key";
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "mock-bucket";
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.invalid";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "mock-access";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "mock-secret";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-fail" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-fail", status: "failed", error: "mock failure" }), { status: 200 }));
    const renderer = new GrokCommercialRenderer({ fetch: fetchMock, sleep: async () => {}, pollIntervalMs: 0, maxPolls: 3 });
    await expect(renderer.render(job)).rejects.toThrow("Grok generation failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses xAI's documented status route so submitted jobs do not 404 during polling", async () => {
    process.env.GROK_VIDEO_ENABLED = "true";
    process.env.GROWTHFORGE_GROK_API_KEY = "mock-key";
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "mock-bucket";
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.invalid";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "mock-access";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "mock-secret";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-route" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-route", status: "failed", error: "mock failure" }), { status: 200 }));
    const renderer = new GrokCommercialRenderer({ fetch: fetchMock, sleep: async () => {}, pollIntervalMs: 0, maxPolls: 1 });
    await expect(renderer.render(job)).rejects.toThrow("Grok generation failed");
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      "https://api.x.ai/v1/videos/generations",
      "https://api.x.ai/v1/videos/req-route",
    ]);
  });

  it("rejects provider download URLs outside the trusted HTTPS hosts", async () => {
    process.env.GROK_VIDEO_ENABLED = "true";
    process.env.GROWTHFORGE_GROK_API_KEY = "mock-key";
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "mock-bucket";
    process.env.OBJECT_STORAGE_ENDPOINT = "https://storage.invalid";
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_ACCESS_KEY_ID = "mock-access";
    process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY = "mock-secret";
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-ssrf" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-ssrf", status: "completed", video: { url: "http://127.0.0.1/admin" } }), { status: 200 }));
    const renderer = new GrokCommercialRenderer({ fetch: fetchMock, sleep: async () => {}, pollIntervalMs: 0, maxPolls: 1 });
    await expect(renderer.render(job)).rejects.toThrow("untrusted host");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});


describe("complete commercial render media pipeline", () => {
  it("assembles valid video and audio with exact duration, dimensions, and streams using real FFmpeg", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grok-pipeline-test-"));
    const clipPath = join(dir, "clip.mp4");

    try {
      await runMediaCommand("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", clipPath]);
      const normalizedClip = await normalizeVideoFrame(await readFile(clipPath), "9:16", 2);
      const result = await assembleVideo([normalizedClip], 2);
      const outputPath = join(dir, "result.mp4");
      await writeFile(outputPath, result);
      const metadata = JSON.parse(await runMediaCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", outputPath])) as { format: { duration: string }; streams: Array<{ codec_type: string; width?: number; height?: number }> };
      expect(Number(metadata.format.duration)).toBeCloseTo(2, 1);
      expect(metadata.streams.map(stream => stream.codec_type).sort()).toEqual(["audio", "video"]);
      expect(metadata.streams.find(stream => stream.codec_type === "video")).toMatchObject({ width: 1080, height: 1920 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

function runMediaCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited ${code}: ${stderr}`)));
  });
}

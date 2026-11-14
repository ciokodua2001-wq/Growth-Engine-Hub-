import { afterEach, describe, expect, it, vi } from "vitest";
import { GrokCommercialRenderer } from "../grokRenderer.js";
import type { CommercialRenderJob } from "../commercialRenderer.js";

const job: CommercialRenderJob = {
  videoId: 42, resolution: "1080p", aspectRatio: "9:16", captionsEnabled: false,
  script: "Speak naturally, with native audio.", storyboard: "A person presents a product.", durationSec: 8,
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
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-123", status: "pending" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ request_id: "req-123", status: "done", video: { url: "https://vidgen.x.ai/output.mp4", duration: 8 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200, headers: { "content-type": "video/mp4", "content-length": "8" } }));
    const renderer = new GrokCommercialRenderer({
      fetch: fetchMock, sleep: async () => {}, pollIntervalMs: 0, maxPolls: 3,
      save: async (...args) => { saved.push(args); },
      signUrl: async (_bucket, key) => `https://storage.invalid/${key}`,
    });
    const result = await renderer.render(job);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.x.ai/v1/videos/generations");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.x.ai/v1/videos/req-123");
    expect(fetchMock.mock.calls[2]?.[0]).toBeInstanceOf(URL);
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe("https://vidgen.x.ai/output.mp4");
    expect(saved).toHaveLength(1);
    expect(result.videoUrl).toMatch(/^grok-object:\/\/mock-bucket\/commercial\/grok\/42\//);
    expect(result.durationSec).toBe(8);
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

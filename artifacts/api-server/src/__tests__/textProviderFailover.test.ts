import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Failover coverage: Gemini is primary, Qwen-Flash catches a Gemini outage.
 *
 * The two things that must both be true - and are easy to get wrong together:
 *   1. an account/transport outage moves to Qwen and the caller still gets an
 *      answer (this is what keeps GrowthForge generating text while the Google
 *      key is out of prepaid credit), and
 *   2. a bad model ANSWER never moves to Qwen, because silently answering from
 *      a different vendor would hide a prompt bug and double the spend.
 */

const { callGeminiRaw, callQwenRaw, deductPlatformCredits } = vi.hoisted(() => ({
  callGeminiRaw: vi.fn(),
  callQwenRaw: vi.fn(),
  deductPlatformCredits: vi.fn(),
}));

vi.mock("../lib/textProviders.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/textProviders.js")>();
  return { ...actual, callGeminiRaw: callGeminiRaw, callQwenRaw: callQwenRaw };
});
vi.mock("../lib/platformCredits.js", () => ({ deductPlatformCredits }));

import { generateJson, runTextModel, TEXT_TIERS } from "../lib/aiJson.js";
import { isProviderOutageError } from "../lib/textProviders.js";
import { getTextProviderChain, getTextProviderFallback } from "../lib/textProviderConfig.js";
import type { RawTextCall } from "../lib/textProviders.js";

function qwenCall(text: string): RawTextCall {
  return {
    provider: "qwen",
    model: "qwen-flash",
    text,
    inputTokens: 50,
    outputTokens: 25,
    truncatedAtTokenLimit: false,
    latencyMs: 30,
  };
}

/** The actual error object shape Google's SDK produced during the real 402. */
function geminiOutOfCredit() {
  return new Error(
    '{"error":{"code":402,"message":"Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}',
  );
}

const MANAGED = [
  "ACTIVE_TEXT_PROVIDER",
  "TEXT_PROVIDER_FALLBACK",
  "QWEN_GROWTHFORGE_KEY",
  "QWEN_API_KEY",
  "DASHSCOPE_API_KEY",
  "QWEN_COST_PER_MILLION_INPUT_TOKENS",
  "QWEN_COST_PER_MILLION_OUTPUT_TOKENS",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  callGeminiRaw.mockReset();
  callQwenRaw.mockReset();
  deductPlatformCredits.mockReset();
  deductPlatformCredits.mockResolvedValue(undefined);
  for (const key of MANAGED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
});

afterEach(() => {
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("provider chain", () => {
  it("is gemini first with qwen as the default fallback", () => {
    expect(getTextProviderChain()).toEqual(["gemini", "qwen"]);
    expect(getTextProviderFallback("gemini")).toBe("qwen");
  });

  it("collapses to gemini-only when no Qwen credential exists", () => {
    delete process.env.QWEN_GROWTHFORGE_KEY;
    expect(getTextProviderChain()).toEqual(["gemini"]);
  });

  it("collapses when Qwen is already the primary (no self-fallback loop)", () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    expect(getTextProviderChain()).toEqual(["qwen"]);
  });

  it("honours TEXT_PROVIDER_FALLBACK=none for strict single-provider behaviour", () => {
    process.env.TEXT_PROVIDER_FALLBACK = "none";
    expect(getTextProviderChain()).toEqual(["gemini"]);
  });

  it("works symmetrically when qwen is primary and gemini is the fallback", () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    process.env.TEXT_PROVIDER_FALLBACK = "gemini";
    expect(getTextProviderChain()).toEqual(["qwen", "gemini"]);
  });
});

describe("isProviderOutageError", () => {
  it("classifies the live Gemini 402 credit depletion as an outage", () => {
    expect(isProviderOutageError(geminiOutOfCredit())).toBe(true);
  });

  it.each([
    "HTTP 429 Too Many Requests",
    '{"error":{"code":403,"message":"Permission denied"}}',
    "fetch failed",
    "socket hang up",
    "This operation was aborted",
    "Qwen request failed (HTTP 503)",
    "API key not valid. Please pass a valid API key.",
    "Model not found: gemini-2.5-flash",
  ])("treats %j as an outage", (message) => {
    expect(isProviderOutageError(new Error(message))).toBe(true);
  });

  it("reads the numeric code Google's typed APIError carries", () => {
    const typed = Object.assign(new Error("quota"), { code: 429 });
    expect(isProviderOutageError(typed)).toBe(true);
  });

  it("follows a wrapped cause", () => {
    const wrapped = new Error("generateContent failed", { cause: geminiOutOfCredit() });
    expect(isProviderOutageError(wrapped)).toBe(true);
  });

  it.each([
    "AI response was not valid JSON: <html>",
    "AI response was truncated (hit the 8192-token output limit)",
  ])("does NOT treat %j as an outage", (message) => {
    expect(isProviderOutageError(new Error(message))).toBe(false);
  });

  it("does not fail over on an unrecognised internal error", () => {
    expect(isProviderOutageError(new TypeError("cannot read properties of undefined"))).toBe(false);
    expect(isProviderOutageError(undefined)).toBe(false);
  });
});

describe("live failover behaviour", () => {
  it("answers from Qwen when Gemini is out of credit, and says so in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    callGeminiRaw.mockRejectedValue(geminiOutOfCredit());
    callQwenRaw.mockResolvedValue(qwenCall('{"caption":"hello"}'));

    const data = await generateJson<{ caption: string }>({
      system: "s",
      prompt: "p",
      label: "Social post",
    });

    expect(data).toEqual({ caption: "hello" });
    expect(callGeminiRaw).toHaveBeenCalledTimes(1);
    expect(callQwenRaw).toHaveBeenCalledTimes(1);
    expect(callQwenRaw.mock.calls[0]![0]).toBe("quality");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("failing over to qwen"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("prepayment credits"));
    warn.mockRestore();
  });

  it("attributes the spend to whichever provider actually answered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.QWEN_COST_PER_MILLION_INPUT_TOKENS = "0.1";
    process.env.QWEN_COST_PER_MILLION_OUTPUT_TOKENS = "1";
    callGeminiRaw.mockRejectedValue(geminiOutOfCredit());
    callQwenRaw.mockResolvedValue({ ...qwenCall('{"ok":true}'), inputTokens: 1000, outputTokens: 1000 });

    await generateJson({ system: "s", prompt: "p" });

    const [provider, amount] = deductPlatformCredits.mock.calls[0]!;
    expect(provider).toBe("qwen");
    expect(amount).toBeCloseTo(0.0001 + 0.001, 10);
    expect(deductPlatformCredits).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("tries Qwen for every call while Gemini stays down (no sticky cooldown, no caching)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    callGeminiRaw.mockRejectedValue(geminiOutOfCredit());
    callQwenRaw.mockResolvedValue(qwenCall('{"ok":true}'));

    await generateJson({ system: "s", prompt: "p" });
    await generateJson({ system: "s", prompt: "p" });

    expect(callGeminiRaw).toHaveBeenCalledTimes(2);
    expect(callQwenRaw).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("does NOT fail over when Gemini answered badly rather than failing", async () => {
    callGeminiRaw.mockResolvedValue({
      ...qwenCall("totally not json"),
      provider: "gemini",
      model: "gemini-3.6-flash",
    });

    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(/not valid JSON/);
    expect(callQwenRaw).not.toHaveBeenCalled();
  });

  it("does not fall back a second time for a bug in our own code", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    callGeminiRaw.mockRejectedValue(geminiOutOfCredit());
    callQwenRaw.mockResolvedValue({ ...qwenCall("not json either") });

    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(/not valid JSON/);
    expect(callGeminiRaw).toHaveBeenCalledTimes(1);
    expect(callQwenRaw).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("surfaces both failures when the fallback is down too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    callGeminiRaw.mockRejectedValue(geminiOutOfCredit());
    callQwenRaw.mockRejectedValue(new Error("Qwen request failed (HTTP 503)"));

    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(
      /All text providers failed.*prepayment credits.*HTTP 503/s,
    );
    warn.mockRestore();
  });

  it("still honours an explicit provider pin (the benchmark must not be rescued by failover)", async () => {
    callGeminiRaw.mockRejectedValue(geminiOutOfCredit());

    await expect(
      runTextModel({
        provider: "gemini",
        tier: "quality",
        ...TEXT_TIERS.quality,
        system: "s",
        prompt: "p",
      }),
    ).rejects.toThrow(/prepayment credits/);
    expect(callQwenRaw).not.toHaveBeenCalled();
  });

  it("restores strict behaviour when TEXT_PROVIDER_FALLBACK=none", async () => {
    process.env.TEXT_PROVIDER_FALLBACK = "none";
    callGeminiRaw.mockRejectedValue(geminiOutOfCredit());

    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(/prepayment credits/);
    expect(callQwenRaw).not.toHaveBeenCalled();
  });

  it("serves Gemini normally, untouched, when it is healthy", async () => {
    callGeminiRaw.mockResolvedValue({ ...qwenCall('{"ok":true}'), provider: "gemini", model: "gemini-3.6-flash" });

    const data = await generateJson<{ ok: boolean }>({ system: "s", prompt: "p" });

    expect(data).toEqual({ ok: true });
    expect(callQwenRaw).not.toHaveBeenCalled();
    expect(deductPlatformCredits.mock.calls[0]![0]).toBe("google-genai");
  });
});

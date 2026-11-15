import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Proves the ACTIVE_TEXT_PROVIDER switch actually routes GrowthForge's text
 * traffic, without making a network call: the transport module is mocked, so
 * these assertions cover dispatch, tier mapping, credit attribution, and the
 * error semantics every route depends on staying identical per provider.
 */

const { callGeminiRaw, callQwenRaw, deductPlatformCredits } = vi.hoisted(() => ({
  callGeminiRaw: vi.fn(),
  callQwenRaw: vi.fn(),
  deductPlatformCredits: vi.fn(),
}));

// Partial mock: keep the REAL isProviderOutageError so these tests exercise the
// actual failover policy, and stub only the two network transports.
vi.mock("../lib/textProviders.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/textProviders.js")>();
  return { ...actual, callGeminiRaw, callQwenRaw };
});
vi.mock("../lib/platformCredits.js", () => ({ deductPlatformCredits }));

import { generateJson, generateJsonFast, runTextModel } from "../lib/aiJson.js";
import type { RawTextCall } from "../lib/textProviders.js";

function geminiResult(text: string, overrides: Partial<RawTextCall> = {}): RawTextCall {
  return {
    provider: "gemini",
    model: "gemini-3.6-flash",
    text,
    inputTokens: 100,
    outputTokens: 200,
    truncatedAtTokenLimit: false,
    latencyMs: 12,
    ...overrides,
  };
}

function qwenResult(text: string, overrides: Partial<RawTextCall> = {}): RawTextCall {
  return {
    provider: "qwen",
    model: "qwen-flash",
    text,
    inputTokens: 100,
    outputTokens: 200,
    truncatedAtTokenLimit: false,
    latencyMs: 34,
    ...overrides,
  };
}

const ORIGINALS = {
  ACTIVE_TEXT_PROVIDER: process.env.ACTIVE_TEXT_PROVIDER,
  QWEN_GROWTHFORGE_KEY: process.env.QWEN_GROWTHFORGE_KEY,
  QWEN_API_KEY: process.env.QWEN_API_KEY,
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
  QWEN_COST_PER_MILLION_INPUT_TOKENS: process.env.QWEN_COST_PER_MILLION_INPUT_TOKENS,
  QWEN_COST_PER_MILLION_OUTPUT_TOKENS: process.env.QWEN_COST_PER_MILLION_OUTPUT_TOKENS,
};

beforeEach(() => {
  callGeminiRaw.mockReset();
  callQwenRaw.mockReset();
  deductPlatformCredits.mockReset();
  deductPlatformCredits.mockResolvedValue(undefined);
  delete process.env.ACTIVE_TEXT_PROVIDER;
  // The operator's own shell may carry a live Qwen credential under an alias;
  // these tests assert behaviour for "key present" / "key absent" explicitly.
  delete process.env.QWEN_GROWTHFORGE_KEY;
  delete process.env.QWEN_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINALS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("provider dispatch", () => {
  it("uses Gemini when ACTIVE_TEXT_PROVIDER is unset (the production default)", async () => {
    callGeminiRaw.mockResolvedValue(geminiResult('{"ok":true}'));

    const data = await generateJson<{ ok: boolean }>({ system: "s", prompt: "p" });

    expect(data).toEqual({ ok: true });
    expect(callGeminiRaw).toHaveBeenCalledTimes(1);
    expect(callQwenRaw).not.toHaveBeenCalled();
    expect(callGeminiRaw.mock.calls[0]![0]).toBe("gemini-3.6-flash");
  });

  it("uses Qwen for the quality tier when the switch is flipped", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    callQwenRaw.mockResolvedValue(qwenResult('{"ok":true}'));

    const data = await generateJson<{ ok: boolean }>({ system: "s", prompt: "p" });

    expect(data).toEqual({ ok: true });
    expect(callQwenRaw).toHaveBeenCalledTimes(1);
    expect(callGeminiRaw).not.toHaveBeenCalled();
    expect(callQwenRaw.mock.calls[0]![0]).toBe("quality");
  });

  it("uses Qwen for the fast (agent-chat) tier as well", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    callQwenRaw.mockResolvedValue(qwenResult('{"intent":"billing"}'));

    const data = await generateJsonFast<{ intent: string }>({ system: "s", prompt: "p" });

    expect(data).toEqual({ intent: "billing" });
    expect(callQwenRaw.mock.calls[0]![0]).toBe("fast");
  });

  it("keeps the fast tier on flash-lite when the switch is off", async () => {
    callGeminiRaw.mockResolvedValue(geminiResult('{"intent":"billing"}'));
    await generateJsonFast({ system: "s", prompt: "p" });
    expect(callGeminiRaw.mock.calls[0]![0]).toBe("gemini-3.1-flash-lite");
    expect(callGeminiRaw.mock.calls[0]![1]).toMatchObject({ thinkingLevel: "minimal" });
  });

  it("lets an explicit provider argument override the env (benchmark needs both in one process)", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "gemini";
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    callQwenRaw.mockResolvedValue(qwenResult('{"a":1}'));

    const outcome = await runTextModel<{ a: number }>({
      provider: "qwen",
      tier: "quality",
      geminiModel: "gemini-3.6-flash",
      geminiCostPerInputToken: 0,
      geminiCostPerOutputToken: 0,
      system: "s",
      prompt: "p",
      thinkingLevel: "low",
    });

    expect(outcome.provider).toBe("qwen");
    expect(outcome.model).toBe("qwen-flash");
    expect(outcome.latencyMs).toBe(34);
  });
});

describe("failure isolation", () => {
  it("fails loudly when Qwen is primary with no credential (nothing else in the chain)", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    delete process.env.QWEN_GROWTHFORGE_KEY;

    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(/QWEN_GROWTHFORGE_KEY/);
    expect(callQwenRaw).not.toHaveBeenCalled();
    // Qwen as primary means the default fallback (qwen) dedupes away, and Gemini
    // is never offered as a silent rescue - the operator asked for Qwen here.
    expect(callGeminiRaw).not.toHaveBeenCalled();
  });

  it("surfaces a Qwen outage without quietly moving traffic to Gemini", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    callQwenRaw.mockRejectedValue(new Error("Qwen request failed (invalid_api_key): Incorrect API key provided."));

    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(/invalid_api_key/);
    expect(callGeminiRaw).not.toHaveBeenCalled();
    // Failover is Gemini-first by design; the reverse is not automatic.
    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(/All text providers failed/);
  });
});

describe("error semantics are provider-independent", () => {
  it("reports invalid JSON the same way for both providers", async () => {
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";

    callGeminiRaw.mockResolvedValue(geminiResult("totally not json"));
    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(/not valid JSON/);

    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    callQwenRaw.mockResolvedValue(qwenResult("totally not json"));
    await expect(generateJson({ system: "s", prompt: "p" })).rejects.toThrow(/not valid JSON/);
  });

  it("recovers fenced JSON from Qwen, which is less disciplined about fences than Gemini", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    callQwenRaw.mockResolvedValue(qwenResult('```json\n{"hooks":["a","b"]}\n```'));

    const data = await generateJson<{ hooks: string[] }>({ system: "s", prompt: "p" });
    expect(data).toEqual({ hooks: ["a", "b"] });
  });

  it("keeps the truncation message and its maxTokens hint for Qwen too", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    callQwenRaw.mockResolvedValue(qwenResult('{"items":[1,2', { truncatedAtTokenLimit: true }));

    await expect(generateJson({ system: "s", prompt: "p", maxTokens: 256 })).rejects.toThrow(
      /truncated \(hit the 256-token output limit\)/,
    );
  });
});

describe("platform-credit attribution", () => {
  it("logs Gemini spend under google-genai with unchanged rates", async () => {
    callGeminiRaw.mockResolvedValue(geminiResult('{"ok":true}', { inputTokens: 1000, outputTokens: 1000 }));
    await generateJson({ system: "s", prompt: "p", label: "Campaign copy" });

    const [provider, amount, description] = deductPlatformCredits.mock.calls[0]!;
    expect(provider).toBe("google-genai");
    // $1.50/M input + $7.50/M output on 1k/1k tokens.
    expect(amount).toBeCloseTo(0.0015 + 0.0075, 10);
    expect(description).toContain("Campaign copy");
  });

  it("logs Qwen spend under its own provider so the two are comparable", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    process.env.QWEN_COST_PER_MILLION_INPUT_TOKENS = "0.15";
    process.env.QWEN_COST_PER_MILLION_OUTPUT_TOKENS = "1.5";
    callQwenRaw.mockResolvedValue(qwenResult('{"ok":true}', { inputTokens: 1000, outputTokens: 1000 }));

    await generateJson({ system: "s", prompt: "p", label: "Campaign copy" });

    const [provider, amount, description] = deductPlatformCredits.mock.calls[0]!;
    expect(provider).toBe("qwen");
    expect(amount).toBeCloseTo(0.00015 + 0.0015, 10);
    expect(description).toContain("qwen/1000 in / 1000 out tokens");
  });

  it("records zero (i.e. skips) Qwen spend while pricing is unconfigured", async () => {
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    callQwenRaw.mockResolvedValue(qwenResult('{"ok":true}'));

    await generateJson({ system: "s", prompt: "p" });

    expect(deductPlatformCredits.mock.calls[0]![1]).toBe(0);
  });
});

describe("prompt enrichment survives the switch", () => {
  it("injects the locale profile into the system prompt on both providers", async () => {
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";

    callGeminiRaw.mockResolvedValue(geminiResult('{"ok":true}'));
    await generateJson({ system: "Base instructions.", prompt: "p", locale: "es-MX" });
    const geminiSystem = callGeminiRaw.mock.calls[0]![1]!.system;

    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    callQwenRaw.mockResolvedValue(qwenResult('{"ok":true}'));
    await generateJson({ system: "Base instructions.", prompt: "p", locale: "es-MX" });
    const qwenSystem = callQwenRaw.mock.calls[0]![1]!.system;

    expect(geminiSystem).toContain("Base instructions.");
    expect(qwenSystem).toContain("Base instructions.");
    expect(qwenSystem).toBe(geminiSystem);
    expect(qwenSystem.length).toBeGreaterThan(geminiSystem.length - 1);
    // Localized calls must actually be enriched, not passed through untouched.
    expect(qwenSystem).not.toBe("Base instructions.");
  });

  it("leaves the English system prompt byte-identical for both providers", async () => {
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";

    callGeminiRaw.mockResolvedValue(geminiResult('{"ok":true}'));
    await generateJson({ system: "Plain.", prompt: "p" });
    process.env.ACTIVE_TEXT_PROVIDER = "qwen";
    callQwenRaw.mockResolvedValue(qwenResult('{"ok":true}'));
    await generateJson({ system: "Plain.", prompt: "p" });

    expect(callGeminiRaw.mock.calls[0]![1]!.system).toBe("Plain.");
    expect(callQwenRaw.mock.calls[0]![1]!.system).toBe("Plain.");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkTextProviderReadiness,
  getActiveTextProvider,
  getQwenApiKey,
  getQwenBaseUrl,
  getQwenCostRates,
  getQwenTextModel,
  getQwenTimeoutMs,
  QWEN_DEFAULT_BASE_URL,
  QWEN_DEFAULT_MODEL,
} from "../lib/textProviderConfig.js";

/**
 * Env resolution for the text-provider switch. The load-bearing guarantee is
 * the default: an unset or unrecognised ACTIVE_TEXT_PROVIDER must resolve to
 * Gemini so that no environment (Lightsail dev/prod, Replit, CI) changes
 * behaviour until it explicitly opts in.
 */

const MANAGED_KEYS = [
  "ACTIVE_TEXT_PROVIDER",
  "QWEN_GROWTHFORGE_KEY",
  "QWEN_API_KEY",
  "DASHSCOPE_API_KEY",
  "QWEN_BASE_URL",
  "DASHSCOPE_BASE_URL",
  "QWEN_TEXT_MODEL",
  "QWEN_FAST_TEXT_MODEL",
  "QWEN_TEXT_TIMEOUT_MS",
  "QWEN_COST_PER_MILLION_INPUT_TOKENS",
  "QWEN_COST_PER_MILLION_OUTPUT_TOKENS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of MANAGED_KEYS) saved[key] = process.env[key];
  for (const key of MANAGED_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("getActiveTextProvider", () => {
  it("defaults to gemini when unset", () => {
    expect(getActiveTextProvider()).toBe("gemini");
  });

  it.each(["", "  ", "banana", "openai", "claude"])("falls back to gemini for %j", (value) => {
    process.env.ACTIVE_TEXT_PROVIDER = value;
    expect(getActiveTextProvider()).toBe("gemini");
  });

  it("accepts qwen case-insensitively and with stray whitespace", () => {
    for (const value of ["qwen", "QWEN", " qwen "]) {
      process.env.ACTIVE_TEXT_PROVIDER = value;
      expect(getActiveTextProvider()).toBe("qwen");
    }
  });
});

describe("Qwen credential resolution", () => {
  it("reads the toolbox name first, then the documented aliases", () => {
    process.env.QWEN_GROWTHFORGE_KEY = "sk-primary";
    process.env.QWEN_API_KEY = "sk-alias";
    expect(getQwenApiKey()).toBe("sk-primary");

    delete process.env.QWEN_GROWTHFORGE_KEY;
    expect(getQwenApiKey()).toBe("sk-alias");

    delete process.env.QWEN_API_KEY;
    process.env.DASHSCOPE_API_KEY = "sk-dashscope";
    expect(getQwenApiKey()).toBe("sk-dashscope");
  });

  it("treats a blank value as absent rather than sending an empty bearer token", () => {
    for (const value of ["", "   ", '""', "''"]) {
      process.env.QWEN_GROWTHFORGE_KEY = value;
      expect(getQwenApiKey()).toBeNull();
    }
    delete process.env.QWEN_GROWTHFORGE_KEY;
    expect(getQwenApiKey()).toBeNull();
  });

  it("unwraps the surrounding quotes the toolbox writes into env files", () => {
    process.env.QWEN_GROWTHFORGE_KEY = '"sk-ws-abc123"';
    expect(getQwenApiKey()).toBe("sk-ws-abc123");
    process.env.QWEN_GROWTHFORGE_KEY = "'sk-ws-abc123'";
    expect(getQwenApiKey()).toBe("sk-ws-abc123");
    // Only a matched outer pair is removed; an inner quote belongs to the key.
    process.env.QWEN_GROWTHFORGE_KEY = 'sk-ws-a"b';
    expect(getQwenApiKey()).toBe('sk-ws-a"b');
  });
});

describe("Qwen endpoint and model resolution", () => {
  it("defaults to the OpenAI-compatible international endpoint and qwen-flash", () => {
    expect(getQwenBaseUrl()).toBe(QWEN_DEFAULT_BASE_URL);
    expect(getQwenTextModel("quality")).toBe(QWEN_DEFAULT_MODEL);
    expect(getQwenTextModel("fast")).toBe(QWEN_DEFAULT_MODEL);
  });

  it("strips trailing slashes so the path join can't double-slash", () => {
    process.env.QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1///";
    expect(getQwenBaseUrl()).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("honours per-tier model overrides so other Qwen models can be benchmarked", () => {
    process.env.QWEN_TEXT_MODEL = "qwen-plus";
    process.env.QWEN_FAST_TEXT_MODEL = "qwen-flash";
    expect(getQwenTextModel("quality")).toBe("qwen-plus");
    expect(getQwenTextModel("fast")).toBe("qwen-flash");
  });
});

describe("getQwenTimeoutMs", () => {
  it("defaults to 90s and clamps absurd values", () => {
    expect(getQwenTimeoutMs()).toBe(90_000);
    process.env.QWEN_TEXT_TIMEOUT_MS = "1";
    expect(getQwenTimeoutMs()).toBe(5_000);
    process.env.QWEN_TEXT_TIMEOUT_MS = "99999999";
    expect(getQwenTimeoutMs()).toBe(300_000);
    process.env.QWEN_TEXT_TIMEOUT_MS = "not-a-number";
    expect(getQwenTimeoutMs()).toBe(90_000);
  });
});

describe("getQwenCostRates", () => {
  it("reports zero rates when pricing is unconfigured (never invents spend)", () => {
    expect(getQwenCostRates()).toEqual({ costPerInputToken: 0, costPerOutputToken: 0 });
  });

  it("converts USD-per-million env rates to per-token", () => {
    process.env.QWEN_COST_PER_MILLION_INPUT_TOKENS = "0.15";
    process.env.QWEN_COST_PER_MILLION_OUTPUT_TOKENS = "1.5";
    const rates = getQwenCostRates();
    expect(rates.costPerInputToken).toBeCloseTo(0.15 / 1_000_000, 12);
    expect(rates.costPerOutputToken).toBeCloseTo(1.5 / 1_000_000, 12);
  });

  it("ignores negative or garbage rates", () => {
    process.env.QWEN_COST_PER_MILLION_INPUT_TOKENS = "-1";
    process.env.QWEN_COST_PER_MILLION_OUTPUT_TOKENS = "abc";
    expect(getQwenCostRates()).toEqual({ costPerInputToken: 0, costPerOutputToken: 0 });
  });
});

describe("checkTextProviderReadiness", () => {
  it("is always ready on gemini (the incumbent path needs no new secret)", () => {
    expect(checkTextProviderReadiness("gemini").ok).toBe(true);
  });

  it("fails loudly with an actionable reason when qwen is selected without a key", () => {
    const result = checkTextProviderReadiness("qwen");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("QWEN_GROWTHFORGE_KEY");
    expect(result.reason).toContain("EnvironmentFile");
  });

  it("is ready once a key is present", () => {
    process.env.QWEN_GROWTHFORGE_KEY = "sk-test";
    expect(checkTextProviderReadiness("qwen").ok).toBe(true);
  });
});

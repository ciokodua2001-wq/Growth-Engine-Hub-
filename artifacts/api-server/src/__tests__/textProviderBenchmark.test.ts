import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TextProvider } from "../lib/textProviderConfig.js";

/**
 * Live head-to-head benchmark: Qwen-Flash vs the Gemini stack GrowthForge runs
 * today, through the SAME production code path (runTextModel -> transport ->
 * JSON recovery -> credit accounting). No parallel implementation, so a pass
 * here means the wired feature works, not that a test double works.
 *
 * Skipped unless explicitly requested (it spends real money on both APIs and
 * needs credentials):
 *
 *   pnpm --dir artifacts/api-server benchmark:text
 *
 * Writes a machine-readable artifact to benchmarks/text-providers/<utc>.json so
 * two runs can be compared and the prose outputs judged side by side.
 */

const RUN = process.env.RUN_TEXT_PROVIDER_BENCHMARK === "1" || process.env.RUN_TEXT_PROVIDER_BENCHMARK === "true";

// __tests__ -> src -> api-server -> artifacts -> repo root (where .env lives).
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/** vitest.setup.ts plants a non-secret dummy so credential-heavy modules can
 *  be imported by offline suites. For a LIVE benchmark that dummy must not win
 *  over the real key in the gitignored env files. */
const VITEST_DUMMY = "vitest-dummy-key-not-real";

/** Load only the keys this harness needs from the gitignored env files. Values
 *  are never logged; a real environment value wins, a placeholder does not. */
function loadEnvValue(name: string): string | undefined {
  if (process.env[name] && process.env[name] !== VITEST_DUMMY) return process.env[name];
  if (process.env[name] === VITEST_DUMMY) delete process.env[name];
  for (const file of [".env", ".env.prod.wasabi"]) {
    try {
      const text = readFileSync(path.join(REPO_ROOT, file), "utf8");
      const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
      if (match) {
        const value = match[1].trim().replace(/^["']|["']$/g, "");
        if (value) {
          process.env[name] = value;
          return value;
        }
      }
    } catch {
      /* file absent in this environment */
    }
  }
  return undefined;
}

const BUSINESS_BRIEF = `Business: "MegaPrint NG", a printing and branding shop in Ikeja, Lagos.
Offer: 24-hour large-format printing (banners, standees, vehicle wraps, branded packaging).
Audience: small-business owners and marketing managers in Lagos.
Tone: confident, direct, no emoji spam. Currency: NGN.`;

interface BenchmarkTask {
  id: string;
  tier: "quality" | "fast";
  locale?: string;
  maxTokens: number;
  system: string;
  prompt: string;
}

loadEnvValue("GOOGLE_GENAI_API_KEY");
loadEnvValue("QWEN_GROWTHFORGE_KEY");
loadEnvValue("QWEN_API_KEY");

// Loaded AFTER the real credentials are in process.env: the shared `genai`
// client captures GOOGLE_GENAI_API_KEY when its module is first imported, so a
// static import here would bake in vitest.setup.ts's dummy key and every
// Gemini call would fail with API_KEY_INVALID (the first run of this harness
// proved exactly that).
const { TEXT_TIERS, runTextModel } = await import("../lib/aiJson.js");
const { getQwenApiKey } = await import("../lib/textProviderConfig.js");

const TASKS: BenchmarkTask[] = [
  {
    id: "social-post",
    tier: "quality",
    locale: "en-NG",
    maxTokens: 1200,
    system: `You write social media copy for small businesses. ${BUSINESS_BRIEF}
Return ONLY JSON: {"caption": string, "hashtags": string[], "cta": string}`,
    prompt: "Write one Instagram post promoting 24-hour banner printing for event season.",
  },
  {
    id: "video-script",
    tier: "quality",
    maxTokens: 1800,
    system: `You write 15-second commercial scripts. ${BUSINESS_BRIEF}
Return ONLY JSON: {"title": string, "scenes": [{"line": string, "visual": string}]}.
Exactly 3 scenes. Every spoken line must be faithful to the offer above - invent nothing.`,
    prompt: "Script a 15-second spot about same-day branding for a new shop opening.",
  },
  {
    id: "ad-headlines",
    tier: "quality",
    maxTokens: 800,
    system: `You write Google Ads headlines (max 30 characters each). ${BUSINESS_BRIEF}
Return ONLY JSON: {"headlines": string[]} - exactly 5, each <= 30 characters.`,
    prompt: "Headlines for a search campaign targeting 'banner printing lagos'.",
  },
  {
    id: "agent-intent",
    tier: "fast",
    maxTokens: 200,
    system: `You classify a support message into one intent.
Intents: billing, feature_request, bug, how_to, other.
Return ONLY JSON: {"intent": string, "confidence": number}.`,
    prompt: "User message: \"I was charged twice for my Starter plan this month, can you check?\"",
  },
];

interface Row {
  task: string;
  provider: TextProvider;
  model: string;
  ok: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  data?: unknown;
  error?: string;
}

const PROVIDERS: TextProvider[] = ["gemini", "qwen"];

const usd = (n: number) => (n === 0 ? "rate unset" : `$${n.toFixed(6)}`);

describe.skipIf(!RUN)("live text-provider benchmark (Qwen-Flash vs Gemini)", () => {
  it("runs every task against both providers through the production path", async () => {
    expect(getQwenApiKey(), "no Qwen credential available to the benchmark").toBeTruthy();

    const rows: Row[] = [];

    for (const task of TASKS) {
      for (const provider of PROVIDERS) {
        const tierConfig = TEXT_TIERS[task.tier];
        const started = Date.now();
        try {
          const outcome = await runTextModel<Record<string, unknown>>({
            provider,
            tier: task.tier,
            ...tierConfig,
            system: task.system,
            prompt: task.prompt,
            maxTokens: task.maxTokens,
            label: `benchmark:${task.id}`,
            locale: task.locale,
          });
          rows.push({
            task: task.id,
            provider,
            model: outcome.model,
            ok: true,
            latencyMs: outcome.latencyMs || Date.now() - started,
            inputTokens: outcome.inputTokens,
            outputTokens: outcome.outputTokens,
            costUsd: outcome.costUsd,
            data: outcome.data,
          });
        } catch (err) {
          rows.push({
            task: task.id,
            provider,
            model: provider === "qwen" ? "qwen-flash" : tierConfig.geminiModel,
            ok: false,
            latencyMs: Date.now() - started,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ── Report ───────────────────────────────────────────────────────────────
    console.log("\n=== GrowthForge text providers: Qwen-Flash vs Gemini ===");
    console.log(
      ["task".padEnd(14), "provider".padEnd(7), "model".padEnd(22), "ok".padEnd(3), "ms".padStart(6), "in".padStart(6), "out".padStart(6), "cost".padStart(11)].join(" "),
    );
    for (const r of rows) {
      console.log(
        [
          r.task.padEnd(14),
          r.provider.padEnd(7),
          r.model.padEnd(22),
          (r.ok ? "yes" : "NO").padEnd(3),
          String(r.latencyMs).padStart(6),
          String(r.inputTokens).padStart(6),
          String(r.outputTokens).padStart(6),
          usd(r.costUsd).padStart(11),
        ].join(" "),
      );
      if (!r.ok) console.log(`    error: ${r.error}`);
    }

    for (const provider of PROVIDERS) {
      const mine = rows.filter((r) => r.provider === provider);
      const ok = mine.filter((r) => r.ok);
      const avg = ok.length ? Math.round(ok.reduce((a, r) => a + r.latencyMs, 0) / ok.length) : 0;
      const tokens = mine.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
      const spend = mine.reduce((a, r) => a + r.costUsd, 0);
      console.log(
        `\n${provider}: ${ok.length}/${mine.length} valid JSON, mean latency ${avg}ms, ${tokens} tokens, ${usd(spend)}`,
      );
    }

    const outDir = path.join(REPO_ROOT, "benchmarks", "text-providers");
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          activeTextProvider: process.env.ACTIVE_TEXT_PROVIDER ?? "gemini (default)",
          qwen: {
            model: process.env.QWEN_TEXT_MODEL ?? "qwen-flash",
            baseUrl: process.env.QWEN_BASE_URL ?? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
            thinking: process.env.QWEN_ALLOW_THINKING === "true",
            costRatesConfigured: Boolean(process.env.QWEN_COST_PER_MILLION_OUTPUT_TOKENS),
          },
          gemini: { quality: TEXT_TIERS.quality.geminiModel, fast: TEXT_TIERS.fast.geminiModel },
          rows,
        },
        null,
        2,
      ),
    );
    console.log(`\nartifact: ${path.relative(REPO_ROOT, file)}`);

    // ── Verdict ──────────────────────────────────────────────────────────────
    // Qwen-Flash is the feature under test: it must produce parseable JSON for
    // every task on the production path. Anything else is a broken integration.
    const qwenFailures = rows.filter((r) => r.provider === "qwen" && !r.ok);
    expect(qwenFailures.map((f) => `${f.task}: ${f.error}`)).toEqual([]);

    // Gemini is the comparison baseline. A provider-side account state (out of
    // prepaid credit, quota) makes the COMPARISON inconclusive but is not a
    // code failure - so it is reported loudly rather than failing the suite.
    const geminiFailures = rows.filter((r) => r.provider === "gemini" && !r.ok);
    if (geminiFailures.length > 0) {
      const billing = geminiFailures.filter((r) => /402|RESOURCE_EXHAUSTED|credit|quota/i.test(r.error ?? ""));
      if (billing.length === geminiFailures.length) {
        console.log(
          "\n*** COMPARISON INCONCLUSIVE: the configured GOOGLE_GENAI_API_KEY is out of " +
            "prepaid credit (HTTP 402). Qwen-Flash itself passed every task. " +
            "Top the key up (https://ai.studio/projects -> billing), or point " +
            "GOOGLE_GENAI_API_KEY at a funded key, then re-run benchmark:text. ***",
        );
      } else {
        expect(geminiFailures.map((f) => `${f.task}: ${f.error}`)).toEqual([]);
      }
    }
  }, 300_000);

  it("falls back to Qwen-Flash for real when the Gemini primary is down", async () => {
    expect(getQwenApiKey(), "no Qwen credential available to the benchmark").toBeTruthy();

    // Step 1: pin Gemini so we know which world we are in - funded or not.
    let geminiError: string | null = null;
    try {
      await runTextModel<Record<string, unknown>>({
        provider: "gemini",
        tier: "quality",
        ...TEXT_TIERS.quality,
        system: `Return ONLY JSON: {"ok": boolean}`,
        prompt: "Health check.",
        maxTokens: 100,
        label: "failover-probe:gemini",
      });
    } catch (err) {
      geminiError = err instanceof Error ? err.message : String(err);
    }

    // Step 2: the UNSCOPED production call (no provider pin) must succeed either
    // way - from Gemini when it is healthy, from Qwen when it is not. This is the
    // behaviour the platform depends on while the Google key has no credit.
    const outcome = await runTextModel<Record<string, unknown>>({
      tier: "quality",
      ...TEXT_TIERS.quality,
      system: `Return ONLY JSON: {"ok": boolean}`,
      prompt: "Health check.",
      maxTokens: 100,
      label: "failover-check",
    });

    expect(outcome.data).toBeDefined();

    if (geminiError) {
      console.log(`\nGemini primary is down (${geminiError.slice(0, 120)}...)`);
      console.log(`Failover served the same call from: ${outcome.provider}/${outcome.model} in ${outcome.latencyMs}ms`);
      // Only a transport/account outage triggers failover, so a Gemini failure
      // here must land the call on Qwen - not error, and not silently retry.
      expect(outcome.provider).toBe("qwen");
    } else {
      console.log(`\nGemini primary is healthy; call served by ${outcome.provider}/${outcome.model} (failover not needed).`);
    }
  }, 120_000);
});

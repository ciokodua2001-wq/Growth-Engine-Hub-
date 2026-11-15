import { deductPlatformCredits } from "./platformCredits.js";
import { getLocaleProfile, injectCulturalNuance } from "./localization.js";
import { callGeminiRaw, callQwenRaw, type RawTextCall } from "./textProviders.js";
import {
  checkTextProviderReadiness,
  getActiveTextProvider,
  getQwenCostRates,
  type QwenTextTier,
  type TextProvider,
} from "./textProviderConfig.js";

// Provider note: these two tiers are how ALL LLM text leaves GrowthForge (32
// call sites across routes/libraries). ACTIVE_TEXT_PROVIDER decides which
// transport answers - "gemini" (default, the models named below) or "qwen"
// (Qwen-Flash, for the Gemini-vs-Qwen benchmark). The model constants below
// describe the Gemini side only; see textProviderConfig.ts + textProviders.ts.
// Note `thinkingLevel` is a Gemini-only knob - Qwen runs instant mode unless
// QWEN_ALLOW_THINKING=true (see qwenThinkingEnabled()).

// Full-quality tier — campaign generation, ad copy, video scripts, automated
// workflows: everything that needs real reasoning quality.
// NOTE: gemini-2.5-flash/-lite return 404 "no longer available to new users"
// on freshly-created API keys (Google gates older model generations behind a
// grandfathering rule) — see .agents/memory/google-ai-stack-migration.md.
// Pricing: $1.50/M input tokens, $7.50/M output tokens
const MODEL = "gemini-3.6-flash";
const COST_PER_INPUT_TOKEN  = 1.50 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 7.50 / 1_000_000;


// Fast/cheap tier — used for Forge AI agent chat (intent classification +
// conversational replies), where latency and cost matter more than depth.
// ~5x cheaper than gemini-3.6-flash; imperceptible quality difference for
// chat/routing tasks. Pricing: $0.25/M input tokens, $1.50/M output tokens
const FAST_MODEL = "gemini-3.1-flash-lite";
const FAST_COST_PER_INPUT_TOKEN  = 0.25 / 1_000_000;
const FAST_COST_PER_OUTPUT_TOKEN = 1.50 / 1_000_000;

/**
 * The exact per-tier Gemini config production uses, exported so the
 * provider-vs-provider benchmark measures the real path instead of a copy of
 * these constants that could drift away from it.
 */
export const TEXT_TIERS = {
  quality: {
    geminiModel: MODEL,
    geminiCostPerInputToken: COST_PER_INPUT_TOKEN,
    geminiCostPerOutputToken: COST_PER_OUTPUT_TOKEN,
    thinkingLevel: "low" as const,
  },
  fast: {
    geminiModel: FAST_MODEL,
    geminiCostPerInputToken: FAST_COST_PER_INPUT_TOKEN,
    geminiCostPerOutputToken: FAST_COST_PER_OUTPUT_TOKEN,
    thinkingLevel: "minimal" as const,
  },
};

function extractJsonBlock(text: string): string {
  // Case 1: complete fenced block  ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  // Case 2: fenced block that was truncated before the closing ``` — strip the
  // opening fence and fall through to brace extraction.
  const openFence = text.match(/^```(?:json)?\s*([\s\S]*)/i);
  const candidate = openFence ? openFence[1] : text;

  // Case 2b: the model is asked for `responseMimeType: application/json`, so it
  // usually returns a complete JSON document — an OBJECT or a top-level ARRAY.
  // If the whole candidate parses, hand it back untouched. Slicing to the
  // outermost { … } (Case 3) CORRUPTS arrays: it strips the enclosing brackets
  // and concatenates the elements (`{…}, {…}`), which then fails JSON.parse and
  // surfaced as "AI response was not valid JSON" during scene decomposition.
  const trimmed = candidate.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // fall through to the defensive brace-slice recovery below
    }
  }

  // Case 3: locate the outermost { … } in whatever we have.
  const firstBrace = candidate.indexOf("{");
  const lastBrace  = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  return candidate.trim();
}

/**
 * Shared text-model call: locale enrichment -> provider transport -> JSON
 * recovery -> platform-credit accounting.
 *
 * Both providers land here, so switching ACTIVE_TEXT_PROVIDER does not change
 * what routes see: same `AI response was not valid JSON` / `AI response was
 * truncated` errors, same credit rows, same optional locale injection.
 */
async function callTextModel<T>(params: {
  tier: QwenTextTier;
  provider?: TextProvider;
  geminiModel: string;
  geminiCostPerInputToken: number;
  geminiCostPerOutputToken: number;
  system: string;
  prompt: string;
  maxTokens?: number;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  label?: string;
  locale?: string;
}): Promise<T> {
  const outcome = await runTextModel<T>(params);
  return outcome.data;
}

export interface TextModelOutcome<T> {
  data: T;
  provider: TextProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/**
 * Same as callTextModel but hands back the transport metadata (which provider
 * answered, tokens, wall-clock latency). The benchmark harness needs exactly
 * this, and production routes ignore it - keeping the two paths on one code
 * path rather than a parallel "benchmark-only" implementation that could drift.
 */
export async function runTextModel<T>(params: {
  tier: QwenTextTier;
  provider?: TextProvider;
  geminiModel: string;
  geminiCostPerInputToken: number;
  geminiCostPerOutputToken: number;
  system: string;
  prompt: string;
  maxTokens?: number;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  label?: string;
  locale?: string;
}): Promise<TextModelOutcome<T>> {
  // ── Cultural nuance injection ─────────────────────────────────────────────
  // Fetch the locale profile (null = English fallback) and upgrade the system
  // prompt with native copywriting directives before the request is sent.
  // injectCulturalNuance() is a no-op when profile is null, so English calls
  // are completely unaffected in both behaviour and token cost.
  const localeProfile = params.locale ? getLocaleProfile(params.locale) : null;
  const enrichedSystem = injectCulturalNuance(params.system, localeProfile, params.locale);

  const provider = params.provider ?? getActiveTextProvider();
  const transportParams = {
    system: enrichedSystem,
    prompt: params.prompt,
    maxTokens: params.maxTokens,
    thinkingLevel: params.thinkingLevel,
  };

  let raw: RawTextCall;
  if (provider === "qwen") {
    const readiness = checkTextProviderReadiness("qwen");
    if (!readiness.ok) throw new Error(readiness.reason ?? "Qwen text provider is not configured");
    raw = await callQwenRaw(params.tier, transportParams);
    const rates = getQwenCostRates();
    return finishCall<T>(raw, rates.costPerInputToken, rates.costPerOutputToken, params.label, params.maxTokens);
  }

  raw = await callGeminiRaw(params.geminiModel, transportParams);
  return finishCall<T>(raw, params.geminiCostPerInputToken, params.geminiCostPerOutputToken, params.label, params.maxTokens);
}

function finishCall<T>(
  raw: RawTextCall,
  costPerInputToken: number,
  costPerOutputToken: number,
  label: string | undefined,
  maxTokens: number | undefined,
): TextModelOutcome<T> {
  const cost = raw.inputTokens * costPerInputToken + raw.outputTokens * costPerOutputToken;
  deductPlatformCredits(
    raw.provider === "qwen" ? "qwen" : "google-genai",
    cost,
    `${label ?? "AI call"} (${raw.provider}/${raw.inputTokens} in / ${raw.outputTokens} out tokens)`,
  ).catch(() => {});

  const jsonText = extractJsonBlock(raw.text);
  const maxOutputTokens = maxTokens ?? 8192;

  let data: T;
  try {
    data = JSON.parse(jsonText) as T;
  } catch {
    if (raw.truncatedAtTokenLimit) {
      throw new Error(
        `AI response was truncated (hit the ${maxOutputTokens}-token output limit) before it finished ` +
          `— increase maxTokens for this call. Partial output: ${raw.text.slice(0, 300)}`,
      );
    }
    throw new Error(`AI response was not valid JSON: ${raw.text.slice(0, 500)}`);
  }

  return {
    data,
    provider: raw.provider,
    model: raw.model,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    costUsd: cost,
    latencyMs: raw.latencyMs,
  };
}

/**
 * Full-quality generation (Gemini 3.6 Flash, or Qwen-Flash when
 * ACTIVE_TEXT_PROVIDER=qwen) — used for all content and analysis
 * (campaign generation, ad copy, landing page code, video scripts, tutoring text).
 * Pass `locale` (BCP-47 code, e.g. "es-MX") to upgrade the system prompt with
 * native copywriting directives via injectCulturalNuance(). Omit for English.
 * `thinkingLevel` defaults to "low" — these are template-filling/structured-JSON
 * tasks, not open-ended reasoning, so a large thinking budget only risks eating
 * into maxTokens and truncating the response. Override upward only for prompts
 * that genuinely need multi-step reasoning.
 */
export async function generateJson<T>(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  label?: string;
  locale?: string;
}): Promise<T> {
  return callTextModel<T>({
    tier: "quality",
    ...TEXT_TIERS.quality,
    ...params,
  });
}

/**
 * Fast, low-cost generation (Gemini 3.1 Flash-Lite, or the QWEN_FAST_TEXT_MODEL
 * when ACTIVE_TEXT_PROVIDER=qwen) — used exclusively for Forge AI
 * agent chat (intent classification + conversational replies). ~5x cheaper than the
 * full tier with no perceptible quality difference for chat and routing tasks.
 * Locale injection is intentionally omitted here — chat responses are always in English.
 */
export async function generateJsonFast<T>(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  label?: string;
}): Promise<T> {
  return callTextModel<T>({
    tier: "fast",
    ...TEXT_TIERS.fast,
    ...params,
  });
}

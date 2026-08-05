import { ThinkingLevel } from "@google/genai";
import { genai } from "@workspace/integrations-google-genai";
import { deductPlatformCredits } from "./platformCredits.js";
import { getLocaleProfile, injectCulturalNuance } from "./localization.js";

const THINKING_LEVEL: Record<"minimal" | "low" | "medium" | "high", ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

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

function extractJsonBlock(text: string): string {
  // Case 1: complete fenced block  ```json ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  // Case 2: fenced block that was truncated before the closing ``` — strip the
  // opening fence and fall through to brace extraction.
  const openFence = text.match(/^```(?:json)?\s*([\s\S]*)/i);
  const candidate = openFence ? openFence[1] : text;

  // Case 3: locate the outermost { … } in whatever we have.
  const firstBrace = candidate.indexOf("{");
  const lastBrace  = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  return candidate.trim();
}

async function callGemini<T>(params: {
  model: string;
  costPerInputToken: number;
  costPerOutputToken: number;
  system: string;
  prompt: string;
  maxTokens?: number;
  thinkingLevel: "minimal" | "low" | "medium" | "high";
  label?: string;
  locale?: string;
}): Promise<T> {
  // ── Cultural nuance injection ─────────────────────────────────────────────
  // Fetch the locale profile (null = English fallback) and upgrade the system
  // prompt with native copywriting directives before the request is sent.
  // injectCulturalNuance() is a no-op when profile is null, so English calls
  // are completely unaffected in both behaviour and token cost.
  const localeProfile = params.locale ? getLocaleProfile(params.locale) : null;
  const enrichedSystem = injectCulturalNuance(params.system, localeProfile, params.locale);

  const maxOutputTokens = params.maxTokens ?? 8192;

  // Gemini has no separate "system" message slot in generateContent's simple
  // form — folded into systemInstruction, which is the supported equivalent.
  const response = await genai.models.generateContent({
    model: params.model,
    contents: params.prompt,
    config: {
      systemInstruction: enrichedSystem,
      maxOutputTokens,
      // Gemini 3.x models "think" before answering by default (thinkingLevel
      // defaults to MEDIUM/HIGH depending on model), and thinking tokens are
      // billed from — and count against — the same maxOutputTokens budget as
      // the actual JSON we want back. For structured template-filling tasks
      // like these (no deep multi-step reasoning needed), an unconstrained
      // thinking budget risks silently eating most of maxOutputTokens and
      // truncating the JSON response before it's complete. Keep it low/minimal
      // so the budget goes to real content instead.
      thinkingConfig: { thinkingLevel: THINKING_LEVEL[params.thinkingLevel] },
      // Structured JSON output mode — the model is constrained to emit valid
      // JSON directly, removing the need for markdown-fence scraping in the
      // common case. extractJsonBlock() below stays as a defensive fallback
      // for any edge cases (e.g. truncated output) where it doesn't apply.
      responseMimeType: "application/json",
    },
  });

  const usage = response.usageMetadata;
  const inTok  = usage?.promptTokenCount ?? 0;
  const outTok = usage?.candidatesTokenCount ?? 0;
  const cost   = inTok * params.costPerInputToken + outTok * params.costPerOutputToken;
  deductPlatformCredits(
    "google-genai",
    cost,
    `${params.label ?? "AI call"} (${inTok} in / ${outTok} out tokens)`,
  ).catch(() => {});

  const text = response.text ?? "";
  const jsonText = extractJsonBlock(text);
  const hitTokenLimit =
    response.candidates?.[0]?.finishReason === "MAX_TOKENS" || outTok >= maxOutputTokens;

  try {
    return JSON.parse(jsonText) as T;
  } catch {
    if (hitTokenLimit) {
      throw new Error(
        `AI response was truncated (hit the ${maxOutputTokens}-token output limit) before it finished ` +
          `— increase maxTokens for this call. Partial output: ${text.slice(0, 300)}`,
      );
    }
    throw new Error(`AI response was not valid JSON: ${text.slice(0, 500)}`);
  }
}

/**
 * Full-quality generation with Gemini 3.6 Flash — used for all content and analysis
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
  return callGemini<T>({
    model: MODEL,
    costPerInputToken: COST_PER_INPUT_TOKEN,
    costPerOutputToken: COST_PER_OUTPUT_TOKEN,
    thinkingLevel: "low",
    ...params,
  });
}

/**
 * Fast, low-cost generation with Gemini 3.1 Flash-Lite — used exclusively for Forge AI
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
  return callGemini<T>({
    model: FAST_MODEL,
    costPerInputToken: FAST_COST_PER_INPUT_TOKEN,
    costPerOutputToken: FAST_COST_PER_OUTPUT_TOKEN,
    thinkingLevel: "minimal",
    ...params,
  });
}

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { deductPlatformCredits } from "./platformCredits.js";
import { getLocaleProfile, injectCulturalNuance } from "./localization.js";

const MODEL = "claude-sonnet-4-6";
// Claude Sonnet pricing: $3/M input tokens, $15/M output tokens
const COST_PER_INPUT_TOKEN  = 3  / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15 / 1_000_000;

// Claude Haiku — used for Forge AI agent chat (classify + respond).
// 12× cheaper than Sonnet; imperceptible quality difference for chat/classification tasks.
// Pricing: $0.25/M input tokens, $1.25/M output tokens
const HAIKU_MODEL = "claude-haiku-4-5";
const HAIKU_COST_PER_INPUT_TOKEN  = 0.25 / 1_000_000;
const HAIKU_COST_PER_OUTPUT_TOKEN = 1.25 / 1_000_000;

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text.trim();
}

async function callClaude<T>(params: {
  model: string;
  costPerInputToken: number;
  costPerOutputToken: number;
  system: string;
  prompt: string;
  maxTokens?: number;
  label?: string;
  locale?: string;
}): Promise<T> {
  // ── Cultural nuance injection ─────────────────────────────────────────────
  // Fetch the locale profile (null = English fallback) and upgrade the system
  // prompt with native copywriting directives before the request is sent.
  // injectCulturalNuance() is a no-op when profile is null, so English calls
  // are completely unaffected in both behaviour and token cost.
  const localeProfile = params.locale ? getLocaleProfile(params.locale) : null;
  const enrichedSystem = injectCulturalNuance(params.system, localeProfile);

  const message = await anthropic.messages.create({
    model: params.model,
    max_tokens: params.maxTokens ?? 8192,
    system: enrichedSystem,
    messages: [{ role: "user", content: params.prompt }],
  });

  const inTok  = message.usage.input_tokens;
  const outTok = message.usage.output_tokens;
  const cost   = inTok * params.costPerInputToken + outTok * params.costPerOutputToken;
  deductPlatformCredits(
    "anthropic",
    cost,
    `${params.label ?? "AI call"} (${inTok} in / ${outTok} out tokens)`,
  ).catch(() => {});

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "";
  const jsonText = extractJsonBlock(text);

  try {
    return JSON.parse(jsonText) as T;
  } catch {
    throw new Error(`AI response was not valid JSON: ${text.slice(0, 500)}`);
  }
}

/**
 * Full-quality generation with Claude Sonnet — used for all content and analysis.
 * Pass `locale` (BCP-47 code, e.g. "es-MX") to upgrade the system prompt with
 * native copywriting directives via injectCulturalNuance(). Omit for English.
 */
export async function generateJson<T>(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
  label?: string;
  locale?: string;
}): Promise<T> {
  return callClaude<T>({
    model: MODEL,
    costPerInputToken: COST_PER_INPUT_TOKEN,
    costPerOutputToken: COST_PER_OUTPUT_TOKEN,
    ...params,
  });
}

/**
 * Fast, low-cost generation with Claude Haiku — used exclusively for Forge AI agent
 * chat (intent classification + conversational replies). 12× cheaper than Sonnet
 * with no perceptible quality difference for chat and routing tasks.
 * Locale injection is intentionally omitted here — chat responses are always in English.
 */
export async function generateJsonFast<T>(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
  label?: string;
}): Promise<T> {
  return callClaude<T>({
    model: HAIKU_MODEL,
    costPerInputToken: HAIKU_COST_PER_INPUT_TOKEN,
    costPerOutputToken: HAIKU_COST_PER_OUTPUT_TOKEN,
    ...params,
  });
}

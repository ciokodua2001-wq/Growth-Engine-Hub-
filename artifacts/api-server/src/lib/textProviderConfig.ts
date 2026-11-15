/** Which model family serves LLM text. "gemini" is the incumbent default. */
export type TextProvider = "gemini" | "qwen";

/**
 * Text-model provider selection - the text twin of videoProviderConfig.ts.
 *
 * GrowthForge's entire LLM-text surface (campaign generation, ad copy, video
 * scripts, SEO/analysis routes, Forge agent chat) funnels through
 * lib/aiJson.ts, so provider choice is resolved once, here, instead of being
 * scattered across the 30+ call sites.
 *
 * Deliberate design choices, matching the video-provider policy:
 *  - Any unset/unknown value resolves to "gemini", so every environment that
 *    has not explicitly opted in behaves exactly as it did before this switch
 *    existed.
 *  - A provider whose outage ends the chain still FAILS VISIBLY; only a
 *    transport-level outage (quota, credit, 5xx, timeout) triggers failover,
 *    so model-output problems are never silently retried on another model.
 */
const VALID_PROVIDERS: TextProvider[] = ["gemini", "qwen"];

export function getActiveTextProvider(): TextProvider {
  const raw = (process.env.ACTIVE_TEXT_PROVIDER ?? "").trim().toLowerCase();
  return VALID_PROVIDERS.includes(raw as TextProvider) ? (raw as TextProvider) : "gemini";
}

/**
 * Failover target when the PRIMARY provider has a transport-level outage.
 *
 * Default is "qwen", and it only takes effect when a Qwen credential actually
 * exists (see getTextProviderChain), which is what the platform needs right
 * now: the Gemini key is out of prepaid credit (HTTP 402), so with no fallback
 * every text feature is down. Failover is deliberately NOT applied to bad
 * model output - see isProviderOutageError() in textProviders.ts.
 *
 * Set TEXT_PROVIDER_FALLBACK=none to restore strict single-provider behaviour
 * (an outage then fails loudly instead of quietly spending on another vendor).
 */
const FALLBACK_NONE = new Set(["none", "off", "false", "0", "disabled"]);

export function getTextProviderFallback(primary: TextProvider): TextProvider | null {
  // NOTE: an UNSET/empty value means "use the default fallback", not "disabled" -
  // only an explicit none/off turns failover off. (Empty-string-as-disable was
  // the first version of this function and silently left the platform with no
  // fallback at all, which is the opposite of why this exists.)
  const raw = (process.env.TEXT_PROVIDER_FALLBACK ?? "").trim().toLowerCase();
  if (FALLBACK_NONE.has(raw)) return null;
  const candidate = VALID_PROVIDERS.includes(raw as TextProvider) ? (raw as TextProvider) : "qwen";
  // Never "fall back" to the provider that just failed.
  if (candidate === primary) return null;
  // No credential -> no point offering a fallback that can only error.
  if (candidate === "qwen" && !getQwenApiKey()) return null;
  return candidate;
}

/**
 * Ordered providers to try for a text call. `getActiveTextProvider()` first,
 * then its fallback. This is the whole failover policy in one place so a route,
 * a benchmark and a unit test can never disagree about who answers.
 */
export function getTextProviderChain(): TextProvider[] {
  const primary = getActiveTextProvider();
  const fallback = getTextProviderFallback(primary);
  return fallback ? [primary, fallback] : [primary];
}

/**
 * Human-readable chain for logs, e.g. "gemini -> qwen(qwen-flash)" or just
 * "gemini" when failover is disabled/unavailable. Takes the chain so callers
 * that already resolved it (and know the tier model) don't resolve it twice.
 */
export function describeTextProviderChain(
  chain: TextProvider[] = getTextProviderChain(),
  tier: QwenTextTier = "quality",
): string {
  return chain
    .map((provider) => (provider === "qwen" ? `qwen(${getQwenTextModel(tier)})` : "gemini"))
    .join(" -> ");
}

/** Model Studio's instant-mode flash model - the direct cost/latency peer of
 *  gemini-3.6-flash, and the reason it is the default for BOTH tiers.
 *  Override with QWEN_TEXT_MODEL / QWEN_FAST_TEXT_MODEL to benchmark another
 *  Qwen model (e.g. qwen-plus) against the same tier slots. */
export const QWEN_DEFAULT_MODEL = "qwen-flash";

/** OpenAI-compatible endpoint, Singapore/International region (the region an
 *  `sk-...` key issued from the alibabacloud.com console belongs to). Beijing
 *  accounts need https://dashscope.aliyuncs.com/compatible-mode/v1 instead -
 *  set QWEN_BASE_URL rather than editing code. */
export const QWEN_DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export type QwenTextTier = "quality" | "fast";

export function getQwenTextModel(tier: QwenTextTier): string {
  const raw = (tier === "fast" ? process.env.QWEN_FAST_TEXT_MODEL : process.env.QWEN_TEXT_MODEL) ?? "";
  return raw.trim() || QWEN_DEFAULT_MODEL;
}

export function getQwenBaseUrl(): string {
  const raw = (process.env.QWEN_BASE_URL ?? process.env.DASHSCOPE_BASE_URL ?? "").trim();
  return (raw || QWEN_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/**
 * The credential name used in the project toolbox. `QWEN_API_KEY` and
 * `DASHSCOPE_API_KEY` are accepted as aliases so a hand-written .env on the
 * Lightsail box doesn't need to match our exact variable name to work.
 */
export function getQwenApiKey(): string | null {
  const raw =
    process.env.QWEN_GROWTHFORGE_KEY ??
    process.env.QWEN_API_KEY ??
    process.env.DASHSCOPE_API_KEY ??
    "";
  // .env.prod.wasabi (and every other toolbox-written file) stores the value
  // double-quoted. systemd's EnvironmentFile parser strips those, a dotenv
  // loader strips them too - but a hand-exported or partially-parsed value
  // keeps them, and a quoted key 401s with a message that looks like a wrong
  // key. Strip a single matching pair so the credential survives all three.
  let value = raw.trim();
  if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
    value = value.slice(1, -1).trim();
  }
  return value.length > 0 ? value : null;
}

export function getQwenTimeoutMs(): number {
  const raw = Number(process.env.QWEN_TEXT_TIMEOUT_MS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return 90_000;
  return Math.min(300_000, Math.max(5_000, Math.round(raw)));
}

export interface QwenCostRates {
  costPerInputToken: number;
  costPerOutputToken: number;
}

/**
 * Qwen pricing is NOT hardcoded. Model Studio prices Qwen-Flash in a
 * tiered/dynamic scheme that changes by region and promotion, and inventing a
 * rate would put fabricated dollars into platform_credit_transactions.
 *
 * Until the operator supplies the real rate from the Model Studio pricing page
 * (USD per 1M tokens), spend is reported as 0 and deductPlatformCredits()
 * short-circuits on a zero amount - so no bogus accounting rows are written.
 * The token counts are still recorded in the call log/description, which is
 * what a benchmark actually needs.
 */
export function getQwenCostRates(): QwenCostRates {
  const perMillionIn = Number(process.env.QWEN_COST_PER_MILLION_INPUT_TOKENS ?? "");
  const perMillionOut = Number(process.env.QWEN_COST_PER_MILLION_OUTPUT_TOKENS ?? "");
  return {
    costPerInputToken: Number.isFinite(perMillionIn) && perMillionIn > 0 ? perMillionIn / 1_000_000 : 0,
    costPerOutputToken: Number.isFinite(perMillionOut) && perMillionOut > 0 ? perMillionOut / 1_000_000 : 0,
  };
}

export interface TextProviderReadiness {
  ok: boolean;
  provider: TextProvider;
  reason?: string;
}

/**
 * Pre-flight check used at startup and by the benchmark, so a misconfigured
 * flip fails loudly and immediately rather than on a user's first generation.
 */
export function checkTextProviderReadiness(provider = getActiveTextProvider()): TextProviderReadiness {
  if (provider !== "qwen") return { ok: true, provider };
  if (!getQwenApiKey()) {
    return {
      ok: false,
      provider,
      reason:
        "ACTIVE_TEXT_PROVIDER=qwen but QWEN_GROWTHFORGE_KEY is not set in this environment " +
        "(systemd loads it from EnvironmentFile=/home/ubuntu/{dev,prod}/app/.env).",
    };
  }
  return { ok: true, provider };
}

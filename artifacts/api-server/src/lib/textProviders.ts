import { ThinkingLevel } from "@google/genai";
import { genai } from "@workspace/integrations-google-genai";
import {
  buildQwenChatRequest,
  describeQwenError,
  isQwenResponseFormatError,
  type QwenChatRequest,
  parseQwenChatResponse,
  QWEN_CHAT_COMPLETIONS_PATH,
} from "./qwenRequest.js";
import {
  getQwenApiKey,
  getQwenBaseUrl,
  getQwenTextModel,
  getQwenTimeoutMs,
  type QwenTextTier,
} from "./textProviderConfig.js";
import type { TextProvider } from "./textProviderConfig.js";

/**
 * Provider-transport layer for LLM text.
 *
 * Both functions return the RAW model text plus token accounting; JSON parsing,
 * cost bookkeeping and credit deduction stay in aiJson.ts so that every route
 * in the app keeps its existing error semantics no matter which provider is
 * active. Nothing here touches the database, which is what lets the
 * provider-vs-provider benchmark run against the real transport code path.
 */

export type ThinkingLevelName = "minimal" | "low" | "medium" | "high";

const GEMINI_THINKING_LEVEL: Record<ThinkingLevelName, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export interface RawTextCall {
  provider: TextProvider;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Set when the model stopped because it hit the output-token ceiling. */
  truncatedAtTokenLimit: boolean;
  latencyMs: number;
}

export interface RawTextCallParams {
  system: string;
  prompt: string;
  maxTokens?: number;
  thinkingLevel: ThinkingLevelName;
  /** Gemini's responseMimeType / Qwen's response_format - on for every
   *  structured-generation call in this app. */
  jsonMode?: boolean;
}

// ── Gemini (incumbent) ───────────────────────────────────────────────────────

export async function callGeminiRaw(
  model: string,
  params: RawTextCallParams,
): Promise<RawTextCall> {
  const maxOutputTokens = params.maxTokens ?? 8192;
  const started = Date.now();

  // Gemini has no separate "system" message slot in generateContent's simple
  // form - folded into systemInstruction, which is the supported equivalent.
  const response = await genai.models.generateContent({
    model,
    contents: params.prompt,
    config: {
      systemInstruction: params.system,
      maxOutputTokens,
      // Gemini 3.x models "think" before answering by default (thinkingLevel
      // defaults to MEDIUM/HIGH depending on model), and thinking tokens are
      // billed from - and count against - the same maxOutputTokens budget as
      // the actual JSON we want back. For structured template-filling tasks
      // like these (no deep multi-step reasoning needed), an unconstrained
      // thinking budget risks silently eating most of maxOutputTokens and
      // truncating the JSON response before it's complete. Keep it low/minimal
      // so the budget goes to real content instead.
      thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL[params.thinkingLevel] },
      // Structured JSON output mode - the model is constrained to emit valid
      // JSON directly, removing the need for markdown-fence scraping in the
      // common case. extractJsonBlock() in aiJson.ts stays as a defensive
      // fallback for any edge cases (e.g. truncated output) where it doesn't.
      responseMimeType: params.jsonMode === false ? undefined : "application/json",
    },
  });

  const usage = response.usageMetadata;
  const inTok = usage?.promptTokenCount ?? 0;
  const outTok = usage?.candidatesTokenCount ?? 0;

  return {
    provider: "gemini",
    model,
    text: response.text ?? "",
    inputTokens: inTok,
    outputTokens: outTok,
    truncatedAtTokenLimit:
      response.candidates?.[0]?.finishReason === "MAX_TOKENS" || outTok >= maxOutputTokens,
    latencyMs: Date.now() - started,
  };
}

// ── Qwen (Model Studio, OpenAI-compatible mode) ──────────────────────────────

export async function callQwenRaw(
  tier: QwenTextTier,
  params: RawTextCallParams,
): Promise<RawTextCall> {
  const apiKey = getQwenApiKey();
  if (!apiKey) {
    throw new Error(
      "Qwen text provider is active but no API key is configured - set QWEN_GROWTHFORGE_KEY " +
        "(aliases: QWEN_API_KEY / DASHSCOPE_API_KEY) in the environment file the service loads.",
    );
  }
  const model = getQwenTextModel(tier);
  const url = `${getQwenBaseUrl()}${QWEN_CHAT_COMPLETIONS_PATH}`;
  const maxTokens = params.maxTokens ?? 8192;

  // Instant mode: see qwenThinkingEnabled() for why thinking stays off unless
  // an operator explicitly turns it on (non-streaming requests are rejected
  // with enable_thinking=true, and this benchmark compares against Gemini
  // running at low/minimal thinking anyway).
  const allowThinking = (process.env.QWEN_ALLOW_THINKING ?? "").trim().toLowerCase() === "true";

  const body = buildQwenChatRequest({
    model,
    system: params.system,
    prompt: params.prompt,
    maxTokens,
    jsonMode: params.jsonMode !== false,
    thinking: allowThinking,
  });

  const started = Date.now();
  let response = await postQwenChat(url, apiKey, body);

  // Some Qwen deployments reject response_format=json_object (typically when
  // the prompt doesn't contain the word "json"). Retry once in plain mode
  // rather than failing the user's generation - extractJsonBlock() in aiJson
  // still recovers fenced/prefixed JSON from the raw text.
  if (!response.ok && isQwenResponseFormatError(response.status, response.payload)) {
    response = await postQwenChat(url, apiKey, {
      ...body,
      response_format: undefined,
      // Thinking mode is only valid streamed; the plain retry stays instant.
      enable_thinking: false,
    });
  }

  if (!response.ok) throw new Error(describeQwenError(response.status, response.payload));

  const completion = parseQwenChatResponse(response.payload);
  return {
    provider: "qwen",
    model,
    text: completion.text,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    truncatedAtTokenLimit: completion.finishReason === "length",
    latencyMs: Date.now() - started,
  };
}

interface QwenHttpResult {
  ok: boolean;
  status: number;
  payload: unknown;
}

async function postQwenChat(
  url: string,
  apiKey: string,
  body: QwenChatRequest,
): Promise<QwenHttpResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(getQwenTimeoutMs()),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Qwen request could not be completed (${reason})`);
  }

  const raw = await res.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { message: raw.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, payload };
}

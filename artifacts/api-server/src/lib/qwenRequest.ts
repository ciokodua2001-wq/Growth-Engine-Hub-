/**
 * Pure request builder / response parser for Alibaba Cloud Model Studio (Qwen)
 * in OpenAI-compatible mode. No I/O, no credentials - the same split used by
 * grokRequest.ts vs grokRenderer.ts, so the wire format stays unit-testable.
 *
 * Endpoint shape (compatible-mode):
 *   POST {base}/chat/completions
 *   Authorization: Bearer <QWEN_GROWTHFORGE_KEY>
 *   { model, messages: [{role, content}], max_tokens, response_format, enable_thinking }
 */

export const QWEN_CHAT_COMPLETIONS_PATH = "/chat/completions";

export interface QwenChatMessage {
  role: "system" | "user";
  content: string;
}

export interface QwenChatRequest {
  model: string;
  messages: QwenChatMessage[];
  max_tokens: number;
  response_format?: { type: "json_object" };
  enable_thinking: boolean;
}

/**
 * Thinking-mode mapping.
 *
 * Model Studio rejects `enable_thinking: true` on a non-streaming request, and
 * streaming SSE would mean a second response-parsing path for every route.
 * Since the Gemini side of this benchmark runs at thinkingLevel "low"/"minimal"
 * (see aiJson.ts - deliberately constrained so reasoning tokens don't eat the
 * maxOutputTokens budget), the honest apples-to-apples comparison is Qwen's
 * instant mode. So `thinking` is only ever true when the operator explicitly
 * opts in, and nothing upstream silently assumes reasoning happened.
 */
export function qwenThinkingEnabled(
  level: "minimal" | "low" | "medium" | "high" | undefined,
  allowThinking = false,
): boolean {
  if (!allowThinking) return false;
  return level === "medium" || level === "high";
}

export function buildQwenChatRequest(params: {
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  jsonMode?: boolean;
  thinking?: boolean;
}): QwenChatRequest {
  if (!params.prompt.trim()) throw new Error("Qwen text request requires a non-empty prompt");
  const messages: QwenChatMessage[] = [];
  if (params.system.trim()) messages.push({ role: "system", content: params.system });
  messages.push({ role: "user", content: params.prompt });

  const maxTokens = params.maxTokens ?? 8192;
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error("Qwen max_tokens must be a positive integer");
  }

  const request: QwenChatRequest = {
    model: params.model,
    messages,
    max_tokens: maxTokens,
    enable_thinking: params.thinking === true,
  };
  // Structured output, mirroring Gemini's responseMimeType: "application/json".
  // Some Qwen models reject json_object when the prompt never mentions JSON, so
  // callers may pass jsonMode: false to skip it (textProviders.ts retries once
  // without it on that specific error).
  if (params.jsonMode !== false) request.response_format = { type: "json_object" };
  return request;
}

export interface QwenChatCompletion {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Reasoning tokens, billed as output tokens when thinking mode is on. */
  reasoningTokens: number;
  finishReason: string | null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Message content is documented as a string, but compatible-mode also returns
 * the array-of-parts shape for multimodal models. Accept both rather than
 * letting a formatting difference take down content generation.
 */
function contentToText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean);
    return parts.length > 0 ? parts.join("") : null;
  }
  return null;
}

export function parseQwenChatResponse(payload: unknown): QwenChatCompletion {
  if (!payload || typeof payload !== "object") {
    throw new Error("Qwen returned an unrecognised response shape");
  }
  const body = payload as {
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };

  const choice = body.choices?.[0];
  if (!choice) throw new Error("Qwen response contained no choices");

  const text = contentToText(choice.message?.content);
  if (text === null) throw new Error("Qwen response choice had no readable text content");

  const usage = body.usage ?? {};
  const inputTokens = asNumber(usage.prompt_tokens);
  const outputTokens = asNumber(usage.completion_tokens);
  const reasoningTokens = asNumber(usage.completion_tokens_details?.reasoning_tokens);

  return {
    text,
    inputTokens,
    outputTokens,
    reasoningTokens,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  };
}

/**
 * Human-readable failure reason for a non-2xx response. Never interpolates the
 * API key, the request body, or a full response dump into the message - this
 * surfaces in route logs and occasionally to end users.
 */
export function describeQwenError(status: number, payload: unknown): string {
  let code = "";
  let message = "";
  if (payload && typeof payload === "object") {
    const err = (payload as { error?: { code?: unknown; message?: unknown } }).error;
    code = typeof err?.code === "string" ? err.code : "";
    message = typeof err?.message === "string" ? err.message : "";
    if (!message && typeof (payload as { message?: unknown }).message === "string") {
      message = (payload as { message: string }).message;
    }
    if (!message && typeof (payload as { code?: unknown }).code === "string") {
      code = String((payload as { code: string }).code);
    }
  }
  // Provider messages can carry a whole echoed request body; cap the length so
  // an upstream blow-up never becomes a log-spam / oversized-error-response bug.
  const capped = message.length > 300 ? `${message.slice(0, 300)}…` : message;
  const detail = [code, capped].filter(Boolean).join(": ") || `HTTP ${status}`;
  return `Qwen request failed (${detail})`;
}

/** True when the API rejected our structured-output request specifically. */
export function isQwenResponseFormatError(status: number, payload: unknown): boolean {
  if (status !== 400) return false;
  const text = JSON.stringify(payload ?? "").toLowerCase();
  return text.includes("response_format") || text.includes("json_object");
}

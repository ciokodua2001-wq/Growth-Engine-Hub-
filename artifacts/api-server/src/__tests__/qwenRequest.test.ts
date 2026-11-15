import { describe, it, expect } from "vitest";
import {
  buildQwenChatRequest,
  describeQwenError,
  isQwenResponseFormatError,
  parseQwenChatResponse,
  qwenThinkingEnabled,
} from "../lib/qwenRequest.js";

/**
 * Unit coverage for the Qwen (Model Studio OpenAI-compatible) wire format.
 * Pure functions only - no network, no credentials, mirroring
 * grokRequest.test.ts's split from grokRenderer.test.ts.
 */

describe("buildQwenChatRequest", () => {
  it("folds the system prompt into a system message and keeps user content intact", () => {
    const req = buildQwenChatRequest({
      model: "qwen-flash",
      system: "You are a copywriter.",
      prompt: "Write 3 hooks",
      maxTokens: 2048,
    });

    expect(req.model).toBe("qwen-flash");
    expect(req.messages).toEqual([
      { role: "system", content: "You are a copywriter." },
      { role: "user", content: "Write 3 hooks" },
    ]);
    expect(req.max_tokens).toBe(2048);
    expect(req.response_format).toEqual({ type: "json_object" });
  });

  it("omits an empty system message instead of sending a blank turn", () => {
    const req = buildQwenChatRequest({ model: "qwen-flash", system: "   ", prompt: "hi" });
    expect(req.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("defaults the output budget to the same 8192 the Gemini path uses", () => {
    expect(buildQwenChatRequest({ model: "m", system: "s", prompt: "p" }).max_tokens).toBe(8192);
  });

  it("can drop structured-output mode for models that reject it", () => {
    const req = buildQwenChatRequest({
      model: "m",
      system: "s",
      prompt: "p",
      jsonMode: false,
    });
    expect(req.response_format).toBeUndefined();
  });

  it("refuses an empty prompt rather than billing a meaningless call", () => {
    expect(() => buildQwenChatRequest({ model: "m", system: "s", prompt: "  " })).toThrow(
      /non-empty prompt/,
    );
  });

  it("rejects a non-positive or fractional max_tokens", () => {
    for (const maxTokens of [0, -5, 12.5]) {
      expect(() =>
        buildQwenChatRequest({ model: "m", system: "s", prompt: "p", maxTokens }),
      ).toThrow(/positive integer/);
    }
  });
});

describe("qwenThinkingEnabled", () => {
  it("stays off for every level unless thinking is explicitly allowed", () => {
    for (const level of ["minimal", "low", "medium", "high"] as const) {
      expect(qwenThinkingEnabled(level)).toBe(false);
    }
  });

  it("only enables thinking for medium/high once opted in", () => {
    expect(qwenThinkingEnabled("low", true)).toBe(false);
    expect(qwenThinkingEnabled("medium", true)).toBe(true);
    expect(qwenThinkingEnabled("high", true)).toBe(true);
  });
});

describe("parseQwenChatResponse", () => {
  it("reads text, token usage and finish reason from a standard completion", () => {
    const parsed = parseQwenChatResponse({
      choices: [{ message: { content: '{"hooks":[]}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 340 },
    });
    expect(parsed).toEqual({
      text: '{"hooks":[]}',
      inputTokens: 120,
      outputTokens: 340,
      reasoningTokens: 0,
      finishReason: "stop",
    });
  });

  it("reports reasoning tokens when thinking mode is used", () => {
    const parsed = parseQwenChatResponse({
      choices: [{ message: { content: "x" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 10, completion_tokens_details: { reasoning_tokens: 4 } },
    });
    expect(parsed.reasoningTokens).toBe(4);
  });

  it("accepts the parts-array content shape", () => {
    const parsed = parseQwenChatResponse({
      choices: [{ message: { content: [{ text: "{" }, { text: '"a":1}' }] }, finish_reason: "stop" }],
    });
    expect(parsed.text).toBe('{"a":1}');
  });

  it("flags a length-truncated completion via its finish reason", () => {
    const parsed = parseQwenChatResponse({
      choices: [{ message: { content: "partial" }, finish_reason: "length" }],
      usage: { prompt_tokens: 5, completion_tokens: 8192 },
    });
    expect(parsed.finishReason).toBe("length");
  });

  it("throws on responses with no choices or no readable content", () => {
    expect(() => parseQwenChatResponse({ choices: [] })).toThrow(/no choices/);
    expect(() => parseQwenChatResponse({ choices: [{ message: {} }] })).toThrow(/no readable text/);
    expect(() => parseQwenChatResponse("nope")).toThrow(/unrecognised response shape/);
  });
});

describe("describeQwenError", () => {
  it("surfaces the provider code and message", () => {
    const msg = describeQwenError(401, {
      error: { code: "invalid_api_key", message: "Incorrect API key provided." },
    });
    expect(msg).toContain("invalid_api_key");
    expect(msg).toContain("Incorrect API key provided.");
  });

  it("caps an oversized provider message instead of dumping the whole echo", () => {
    const msg = describeQwenError(400, { error: { message: "x".repeat(5000) } });
    expect(msg.length).toBeLessThan(400);
    expect(msg).toContain("…");
  });

  it("falls back to the status code when the body is unparseable", () => {
    expect(describeQwenError(502, null)).toContain("HTTP 502");
  });
});

describe("isQwenResponseFormatError", () => {
  it("recognises only the 400 structured-output rejection", () => {
    expect(
      isQwenResponseFormatError(400, { error: { message: 'response_format must be "json_object"' } }),
    ).toBe(true);
    expect(isQwenResponseFormatError(400, { error: { message: "quota exceeded" } })).toBe(false);
    expect(isQwenResponseFormatError(401, { error: { message: "response_format" } })).toBe(false);
  });
});

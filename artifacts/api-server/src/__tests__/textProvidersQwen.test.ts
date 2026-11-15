import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Transport-level coverage for callQwenRaw: URL joining, auth header, request
 * body, the structured-output retry, and error mapping. `fetch` is stubbed, so
 * nothing here needs a credential or the network - but it exercises the exact
 * code the live benchmark runs.
 */

import { callQwenRaw } from "../lib/textProviders.js";

const KEY = "sk-ws-testvalue";
const ORIGINALS: Record<string, string | undefined> = {};

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function completion(content: string, extra: Record<string, unknown> = {}) {
  return {
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop", index: 0 }],
    usage: { prompt_tokens: 21, completion_tokens: 140, total_tokens: 161 },
    model: "qwen-flash",
    ...extra,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const key of ["QWEN_GROWTHFORGE_KEY", "QWEN_API_KEY", "DASHSCOPE_API_KEY", "QWEN_BASE_URL", "QWEN_TEXT_MODEL", "QWEN_FAST_TEXT_MODEL", "QWEN_ALLOW_THINKING"]) {
    ORIGINALS[key] = process.env[key];
    delete process.env[key];
  }
  process.env.QWEN_GROWTHFORGE_KEY = KEY;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(ORIGINALS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const baseParams = {
  system: "You generate JSON.",
  prompt: "Return {\"hooks\":[...]}",
  maxTokens: 4096,
  thinkingLevel: "low" as const,
};

describe("callQwenRaw request", () => {
  it("posts the built chat request to the compatible-mode endpoint with a bearer token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, completion('{"hooks":["a"]}')));

    const result = await callQwenRaw("quality", baseParams);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    });

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "qwen-flash",
      max_tokens: 4096,
      response_format: { type: "json_object" },
      enable_thinking: false,
    });
    expect(body.messages).toEqual([
      { role: "system", content: "You generate JSON." },
      { role: "user", content: 'Return {"hooks":[...]}' },
    ]);
  });

  it("honours QWEN_BASE_URL and QWEN_FAST_TEXT_MODEL overrides", async () => {
    process.env.QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/";
    process.env.QWEN_FAST_TEXT_MODEL = "qwen-turbo";
    fetchMock.mockResolvedValue(jsonResponse(200, completion('{"ok":true}')));

    await callQwenRaw("fast", baseParams);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(JSON.parse(init.body as string).model).toBe("qwen-turbo");
  });

  it("applies a request timeout so a hung provider can't pin a request forever", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, completion('{"ok":true}')));
    await callQwenRaw("quality", baseParams);
    const init = fetchMock.mock.calls[0]![1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("callQwenRaw response", () => {
  it("returns raw text plus token accounting for the shared JSON layer", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, completion('{"hooks":["a","b"]}')));

    const result = await callQwenRaw("quality", baseParams);

    expect(result.provider).toBe("qwen");
    expect(result.model).toBe("qwen-flash");
    expect(result.text).toBe('{"hooks":["a","b"]}');
    expect(result.inputTokens).toBe(21);
    expect(result.outputTokens).toBe(140);
    expect(result.truncatedAtTokenLimit).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("marks truncation when the model stops at the token ceiling", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, completion('{"items":[1,', { choices: [{ message: { content: '{"items":[1,' }, finish_reason: "length" }] })),
    );
    const result = await callQwenRaw("quality", baseParams);
    expect(result.truncatedAtTokenLimit).toBe(true);
  });

  it("retries once without response_format when the model rejects structured output", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: "invalid_parameter", message: "response_format json_object requires 'json' in prompt" } }))
      .mockResolvedValueOnce(jsonResponse(200, completion('{"ok":true}')));

    const result = await callQwenRaw("quality", baseParams);

    expect(result.text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body);
    expect(retryBody.response_format).toBeUndefined();
    expect(retryBody.enable_thinking).toBe(false);
  });

  it("does not retry (or loop) on a real error", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: "invalid_api_key", message: "Incorrect API key provided." } }));

    await expect(callQwenRaw("quality", baseParams)).rejects.toThrow(/invalid_api_key/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a non-JSON error body without throwing inside the error handler", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    await expect(callQwenRaw("quality", baseParams)).rejects.toThrow(/Qwen request failed/);
  });

  it("reports a transport failure as a failed request rather than an empty answer", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await expect(callQwenRaw("quality", baseParams)).rejects.toThrow(/could not be completed \(socket hang up\)/);
  });
});

describe("callQwenRaw configuration guard", () => {
  it("throws before any network call when no credential is configured", async () => {
    delete process.env.QWEN_GROWTHFORGE_KEY;
    await expect(callQwenRaw("quality", baseParams)).rejects.toThrow(/QWEN_GROWTHFORGE_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

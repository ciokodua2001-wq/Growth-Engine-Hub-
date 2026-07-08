import { anthropic } from "@workspace/integrations-anthropic-ai";

const MODEL = "claude-sonnet-4-6";

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

export async function generateJson<T>(params: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<T> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: params.maxTokens ?? 8192,
    system: params.system,
    messages: [{ role: "user", content: params.prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "";
  const jsonText = extractJsonBlock(text);

  try {
    return JSON.parse(jsonText) as T;
  } catch {
    throw new Error(`AI response was not valid JSON: ${text.slice(0, 500)}`);
  }
}

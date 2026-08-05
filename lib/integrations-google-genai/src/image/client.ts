import { Buffer } from "node:buffer";
import { genai } from "../client";

// The old Imagen family (imagen-4.0-generate-001 / -fast / -ultra, called via
// models.generateImages()) is both API-deprecated (Google's SDK logs a
// deprecation warning pointing at generateContent) AND fully gated behind a
// 404 "no longer available to new users" for any freshly-created API key —
// confirmed Aug 2026, see .agents/memory/google-ai-stack-migration.md.
// gemini-3.1-flash-image (aka "Nano Banana 2") is the current recommended
// replacement: called via the normal generateContent() path with
// responseModalities: ["IMAGE"] + imageConfig, same as text/JSON generation.
//
// IMPORTANT: image generation has NO free tier on the Gemini API — it
// requires Google Cloud billing to be enabled on the project behind the API
// key (Tier 1+), independent of whatever quota the text models get. A
// free-tier-only key will get a 429 RESOURCE_EXHAUSTED with `limit: 0` no
// matter which image model is requested — that's a billing/plan gap, not a
// code bug. See console.cloud.google.com/billing for the linked project.
const IMAGE_MODEL = "gemini-3.1-flash-image";

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536" | "auto";

// Keeps the old OpenAI-style pixel-size call signature (used unchanged by
// content.ts / images.ts) while mapping to Gemini's aspect-ratio config
// under the hood — avoids touching call-site logic.
const ASPECT_RATIO_BY_SIZE: Record<Exclude<ImageSize, "auto">, string> = {
  "1024x1024": "1:1",
  "1536x1024": "16:9",
  "1024x1536": "9:16",
};

export async function generateImageBuffer(
  prompt: string,
  size: ImageSize = "1024x1024",
): Promise<Buffer> {
  const aspectRatio = size === "auto" ? "1:1" : ASPECT_RATIO_BY_SIZE[size];

  let response;
  try {
    response = await genai.models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio, imageSize: "1K" },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("RESOURCE_EXHAUSTED") || /"limit"\s*:\s*0/.test(msg)) {
      throw new Error(
        "Image generation requires Google Cloud billing to be enabled on this project — " +
          "the Gemini API has no free tier for image models (text generation stays free/cheap, " +
          "images do not). Enable billing at console.cloud.google.com/billing for the project " +
          "behind GOOGLE_GENAI_API_KEY, then try again.",
      );
    }
    throw err;
  }

  // Some backends can return multiple parts for a single request — take the
  // last image part rather than the first, matching Google's own documented
  // workaround for this exact ambiguity.
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imageParts = parts.filter((p) => p.inlineData?.data);
  const imageBytes = imageParts[imageParts.length - 1]?.inlineData?.data ?? "";

  if (!imageBytes) {
    throw new Error("Gemini returned no image data — the prompt may have been blocked by safety filters.");
  }
  return Buffer.from(imageBytes, "base64");
}

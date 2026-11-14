import { describe, expect, it } from "vitest";
import { buildGrokGenerationRequest, GROK_VIDEO_MODEL, grokBillableSeconds, grokSourceAspectRatio } from "../grokRequest.js";
import type { CommercialRenderJob } from "../commercialRenderer.js";

describe("buildGrokGenerationRequest (offline, no provider calls)", () => {
  it("builds the approved 9:16 request with native audio and no captions", () => {
    const body = buildGrokGenerationRequest({
      script: "Spoken dialogue here.",
      storyboard: "Four shots in a bright Lagos home.",
      cinematicPlan: null,
      aspectRatio: "9:16",
      durationSec: 15,
    });

    expect(body).toEqual({
      model: GROK_VIDEO_MODEL,
      prompt: "Four shots in a bright Lagos home.\n\nSpoken dialogue here.\n\nDo not add unrequested captions, subtitles, text overlays, logos, or legible written text. Preserve and accurately render any customer-requested branding, logos, product labels, or approved on-screen text described in the brief or storyboard.",
      duration: 15,
      aspect_ratio: "9:16",
      resolution: "720p",
      generate_audio: true,
    });
    expect(body.prompt).toMatch(/Do not add unrequested captions, subtitles, text overlays/);
    expect(body.prompt).toMatch(/Preserve and accurately render any customer-requested branding/);
  });

  it("rejects missing prompt text", () => {
    expect(() => buildGrokGenerationRequest({
      script: " ", storyboard: null, cinematicPlan: null, aspectRatio: "9:16",
    })).toThrow("non-empty prompt");
  });

  it("supports every product ratio and maps 4:5 to portrait source generation", () => {
    expect(grokSourceAspectRatio("16:9")).toBe("16:9");
    expect(grokSourceAspectRatio("9:16")).toBe("9:16");
    expect(grokSourceAspectRatio("1:1")).toBe("1:1");
    expect(grokSourceAspectRatio("4:5")).toBe("9:16");
    expect(buildGrokGenerationRequest({ script: "Ad prompt", aspectRatio: "4:5" }).aspect_ratio).toBe("9:16");
  });

  it("rejects invalid durations", () => {
    for (const durationSec of [0, 16, 1.5]) {
      expect(() => buildGrokGenerationRequest({
        script: "Ad prompt", aspectRatio: "16:9", durationSec,
      })).toThrow("integer from 1 to 15");
    }
  });

  it("defaults duration when none is supplied", () => {
    expect(buildGrokGenerationRequest({ script: "Ad prompt", aspectRatio: "1:1" }).duration).toBe(15);
  });

  it("preserves ordered storyboard shots and dialogue in the provider prompt", () => {
    const job = {
      script: "Brand story",
      storyboard: "Visual overview",
      cinematicPlan: JSON.stringify({ shots: [
        { environment: "Kitchen", subjectAction: "Opens jar", dialogue: "Taste the difference", duration: 4 },
        { environment: "Garden", subjectAction: "Smiles", cameraMovement: "Slow push-in", duration: 3 },
      ] }),
      aspectRatio: "9:16", durationSec: 7,
    } as CommercialRenderJob;
    const request = buildGrokGenerationRequest(job);
    expect(request.prompt.indexOf("Shot 1:")).toBeLessThan(request.prompt.indexOf("Shot 2:"));
    expect(request.prompt).toContain("Spoken dialogue: Taste the difference");
    expect(request.generate_audio).toBe(true);
  });

  it("bills Grok using the requested/capped duration and actual returned duration", () => {
    expect(grokBillableSeconds(60)).toBe(15);
    expect(grokBillableSeconds(8)).toBe(8);
    expect(grokBillableSeconds(12, 7.2)).toBe(8);
    expect(grokBillableSeconds(3, 20)).toBe(15);
  });
});

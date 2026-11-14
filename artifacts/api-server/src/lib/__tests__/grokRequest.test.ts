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
      prompt: expect.stringContaining("Four shots in a bright Lagos home."),
      duration: 15,
      aspect_ratio: "9:16",
      resolution: "720p",
      generate_audio: true,
    });
    expect(body.prompt).toMatch(/Never create split-screen, divided panels, triptychs, grids, contact sheets/);
    expect(body.prompt).toMatch(/opening frame must be a normal full-frame cinematic image/);
    expect(body.prompt).toMatch(/Do not invent, approximate, synthesize, or display any logo/);
    expect(body.prompt).not.toMatch(/Preserve and accurately render any customer-requested branding/);
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

  it("preserves all editable production brief and shot fields while full script remains dialogue authority", () => {
    const job = {
      script: "Customer's newly edited complete script",
      storyboard: "Visual overview",
      cinematicPlan: JSON.stringify({
        visualStyle: "Bright editorial style",
        performanceDirection: "Warm and confident",
        textOverlayPlacement: "Lower third",
        finalHeroShot: "Product close-up",
        shots: [
          { environment: "Kitchen", subjectAction: "Opens jar", dialogue: "New shot one line", facialExpression: "Delighted", bodyMovement: "Leans forward", lensStyle: "50mm", lighting: "Soft key", visualEffects: "None", transition: "Cut", cameraMovement: "Push-in", duration: 4 },
          { environment: "Garden", subjectAction: "Smiles", cameraMovement: "Slow push-in", dialogue: "New shot two line", duration: 3 },
        ],
      }),
      aspectRatio: "9:16", durationSec: 7,
    } as CommercialRenderJob;
    const request = buildGrokGenerationRequest(job);
    expect(request.prompt.indexOf("Shot 1\n")).toBeLessThan(request.prompt.indexOf("Shot 2\n"));
    expect(request.prompt).toContain("Customer's newly edited complete script");
    expect(request.prompt).toContain("Visual style: Bright editorial style");
    expect(request.prompt).toContain("Performance direction: Warm and confident");
    expect(request.prompt).toContain("Actor-line timing/reference: New shot one line");
    expect(request.prompt).toContain("Facial expression: Delighted");
    expect(request.prompt).toContain("Body movement: Leans forward");
    expect(request.prompt).toContain("Lens: 50mm");
    expect(request.prompt).toContain("Text overlay placement: Lower third");
    expect(request.prompt).toContain("Final hero shot: Product close-up");
    expect(request.prompt).toContain("Speak the complete actor script exactly once and in order");
    expect(request.generate_audio).toBe(true);
  });

  it("bills Grok using the requested/capped duration and actual returned duration", () => {
    expect(grokBillableSeconds(60)).toBe(15);
    expect(grokBillableSeconds(8)).toBe(8);
    expect(grokBillableSeconds(12, 7.2)).toBe(8);
    expect(grokBillableSeconds(3, 20)).toBe(15);
  });
});

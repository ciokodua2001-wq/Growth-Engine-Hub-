import { describe, expect, it } from "vitest";
import { buildGrokGenerationRequest, GROK_VIDEO_MODEL } from "../grokRequest.js";

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
      prompt: "Four shots in a bright Lagos home.\n\nSpoken dialogue here.",
      duration: 15,
      aspect_ratio: "9:16",
      resolution: "720p",
      generate_audio: true,
    });
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/caption|subtitle|overlay/);
  });

  it("rejects missing prompt text", () => {
    expect(() => buildGrokGenerationRequest({
      script: " ", storyboard: null, cinematicPlan: null, aspectRatio: "9:16",
    })).toThrow("non-empty prompt");
  });

  it("rejects unsupported aspect ratios", () => {
    expect(() => buildGrokGenerationRequest({
      script: "Ad prompt", aspectRatio: "4:5" as "9:16",
    })).toThrow("does not support aspect ratio");
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
});

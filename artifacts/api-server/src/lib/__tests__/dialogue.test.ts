import { describe, expect, it } from "vitest";
import {
  extractDialogueLines,
  distributeDialogue,
  estimateDialogueFit,
  compareScriptToTranscript,
} from "../dialogue.js";

const ALLBIRDS_PLAN = JSON.stringify({
  shots: [
    { shotNumber: 1, duration: 3, dialogue: "Ever feel like your shoes are holding you back?" },
    { shotNumber: 2, duration: 4, dialogue: "Swap those heavy synthetic sneakers for soft eucalyptus tree fiber." },
    { shotNumber: 3, duration: 5, dialogue: "You get bouncy, all-day comfort that is actually good for the planet." },
    { shotNumber: 4, duration: 3, dialogue: "" },
  ],
});

describe("extractDialogueLines", () => {
  it("pulls exact per-shot dialogue from cinematicPlan and drops silent shots", () => {
    const lines = extractDialogueLines(null, ALLBIRDS_PLAN);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Ever feel like your shoes are holding you back?");
    expect(lines[2]).toContain("good for the planet");
  });

  it("falls back to sentence-splitting the continuous script", () => {
    const lines = extractDialogueLines(
      "Ever feel like your shoes are holding you back? Swap those heavy synthetic sneakers.",
      null,
    );
    expect(lines).toHaveLength(2);
  });
});

describe("distributeDialogue", () => {
  it("joins adjacent lines verbatim when there are more lines than scenes", () => {
    const out = distributeDialogue(["A one", "B two", "C three"], 2);
    expect(out).toEqual(["A one B two", "C three"]);
  });

  it("returns empty strings for silent scenes", () => {
    const out = distributeDialogue([], 2);
    expect(out).toEqual(["", ""]);
  });
});

describe("estimateDialogueFit", () => {
  it("fits the 25-word Allbirds script in 15s", () => {
    const script = "Ever feel like your shoes are holding you back? Swap those heavy synthetic sneakers for soft eucalyptus tree fiber. You get bouncy, all-day comfort that is actually good for the planet.";
    const fit = estimateDialogueFit(script, 15);
    expect(fit.fits).toBe(true);
  });

  it("flags a dense script and suggests a longer duration", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const fit = estimateDialogueFit(long, 8);
    expect(fit.fits).toBe(false);
    expect(fit.suggestedDurationSec).toBeGreaterThan(8);
  });
});

describe("compareScriptToTranscript", () => {
  it("reports matches for identical wording", () => {
    const r = compareScriptToTranscript("Hello there friend", "Hello there friend");
    expect(r.status).toBe("matches");
    expect(r.similarity).toBe(1);
  });

  it("detects a paraphrase and flags added words", () => {
    const r = compareScriptToTranscript(
      "Ever feel like your shoes are holding you back?",
      "Ever feel like your heavy synthetic shoes are holding you back from real comfort?",
    );
    expect(r.status).toBe("difference");
    expect(r.similarity).toBeLessThan(1);
    expect(r.differences.some(d => d.type === "added" && d.spoken === "heavy")).toBe(true);
  });

  it("flags material price/claim changes", () => {
    const r = compareScriptToTranscript("Get 50% off today", "Get 80% off today");
    expect(r.status).toBe("difference");
    expect(r.differences.some(d => d.type === "material")).toBe(true);
  });
});

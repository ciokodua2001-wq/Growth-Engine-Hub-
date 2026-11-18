import { describe, expect, it } from "vitest";
import { buildCreativeVisionInstructions } from "../lib/contentGenerators.js";

const sample = `QUANTIVARIAN NIGERIA — “FROM FRUSTRATION TO CONFIDENCE!”
Exactly 45 seconds. Five timed scenes: family comedy, neighbour reveals QUANTIVARIAN, learning montage, family transformation, brand/CTA.
MOTHER: “WHAT?! Seven out of thirty?!”
FATHER: “Seven?! Are you serious?!”
BOY: “Mummy, I just don't understand mathematics!”
All dialogue in English; no Pidgin or indigenous languages. Nigerian English accents. Keep the website ng.quantivarian.com visible in the final six seconds.`;

describe("creative vision prompt fidelity", () => {
  const prompt = buildCreativeVisionInstructions(sample, 45);

  it("treats the supplied script as the controlling source, not disposable inspiration", () => {
    expect(prompt).toContain("CONTROLLING SOURCE OF TRUTH");
    expect(prompt).toContain("not disposable inspiration");
    expect(prompt).toContain(sample);
  });

  it("preserves exact scene, role, dialogue, language and CTA direction", () => {
    for (const required of [
      "scene sequence, roles, timing, key dialogue, language, tone, brand reveal, and CTA",
      "MOTHER: “WHAT?! Seven out of thirty?!”",
      "All dialogue in English; no Pidgin or indigenous languages.",
      "ng.quantivarian.com visible in the final six seconds.",
    ]) expect(prompt).toContain(required);
  });

  it("does not reimpose the old monologue or four-shot restrictions", () => {
    expect(prompt).not.toContain("do not copy verbatim");
    expect(prompt).not.toContain("reference only");
    expect(prompt).not.toContain("continuous performance");
    expect(prompt).not.toContain("exactly 4 shots");
  });

  it("injects the selected duration and requires matching shot dialogue", () => {
    expect(prompt).toContain("exactly 45 seconds");
    expect(prompt).toContain("matching cinematic shot plan");
    expect(prompt).toContain("assign them accurately to shot dialogue");
  });
});

describe("brand-reveal handling", () => {
  const prompt = buildCreativeVisionInstructions(sample, 45);
  it("converts brand-reveal requests into post-composited text, not drawn logos", () => {
    expect(prompt).toContain("never describe a logo");
    expect(prompt).toContain("post-production");
  });
});

import { describe, expect, it } from "vitest";
import {
  segmentTextToPhrases,
  extractDialogueLines,
  distributeDialogue,
  estimateDialogueFit,
  compareScriptToTranscript,
  assignEstimatedTiming,
  transcriptToCaptionEntries,
  hashScript,
  captionMaxCharsPerLine,
  captionMaxWidthRatio,
  clampCaptionX,
  clampCaptionY,
  CAPION_SAFE_MARGIN_X,
  CAPION_SAFE_MARGIN_TOP,
  CAPION_SAFE_MARGIN_BOTTOM,
  CAPION_NOMINAL_HALF_WIDTH,
  CAPION_NOMINAL_HALF_HEIGHT,
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

describe("assignEstimatedTiming", () => {
  it("produces estimated, unreviewed, ordered timing across the duration", () => {
    const segs = assignEstimatedTiming([{ text: "Hello there" }, { text: "Goodbye now" }], 15);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.timingSource).toBe("estimated");
    expect(segs[0]!.reviewed).toBe(false);
    expect(segs[0]!.startSec).toBeGreaterThanOrEqual(0);
    expect(segs[1]!.startSec).toBeGreaterThanOrEqual(segs[0]!.endSec!);
  });
});

describe("hashScript", () => {
  it("is deterministic (cache key for suggestion cost-control)", () => {
    const a = hashScript("  Same script\n");
    const b = hashScript("Same script");
    expect(a).toBe(b);
    expect(a).toHaveLength(24);
  });
});

describe("transcriptToCaptionEntries", () => {
  it("only returns segments with text AND timing", () => {
    const entries = transcriptToCaptionEntries([
      { text: "A line", startSec: 1, endSec: 3 },
      { text: "no timing yet" },
      { text: "", startSec: 1, endSec: 2 },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("A line");
  });

  it("returns empty for null transcript (never falls back to script)", () => {
    expect(transcriptToCaptionEntries(null)).toEqual([]);
  });
});

describe("compareScriptToTranscript (fidelity score bounded 0..1)", () => {
  it("identical scripts -> similarity 1 and status matches", () => {
    const r = compareScriptToTranscript("step into allbirds today", "step into allbirds today");
    expect(r.similarity).toBe(1);
    expect(r.status).toBe("matches");
  });

  it("repeated words cannot push similarity above 1 (regression: 104%)", () => {
    const r = compareScriptToTranscript("a a b", "a b");
    expect(r.similarity).toBeLessThanOrEqual(1);
    expect(r.similarity).toBe(1);
  });

  it("partial match -> similarity < 1 and status difference", () => {
    const r = compareScriptToTranscript("step into allbirds today", "step into allbirds");
    expect(r.similarity).toBeLessThan(1);
    expect(r.status).toBe("difference");
    expect(r.differences.some((d) => d.type === "missing" && d.approved === "today")).toBe(true);
  });

  it("extra spoken words -> similarity < 1", () => {
    const r = compareScriptToTranscript("try allbirds", "try allbirds today now");
    expect(r.similarity).toBeLessThan(1);
    expect(r.differences.some((d) => d.type === "added" && d.spoken === "today")).toBe(true);
    expect(r.differences.some((d) => d.type === "added" && d.spoken === "now")).toBe(true);
  });

  it("empty transcript vs non-empty script -> similarity 0", () => {
    const r = compareScriptToTranscript("hello world", "");
    expect(r.similarity).toBe(0);
    expect(r.status).toBe("difference");
  });

  it("empty vs empty -> similarity 1", () => {
    const r = compareScriptToTranscript("", "");
    expect(r.similarity).toBe(1);
  });
});

describe("segmentTextToPhrases and transcriptToCaptionEntries phrase flow", () => {
  it("splits a long multi-sentence transcript segment into short phrase-level captions", () => {
    const longText = "Ever feel like your daily shoes are holding you back? Upgrade to sugarcane and tree fiber comfort. Step naturally today.";
    const phrases = segmentTextToPhrases(longText, 0.1, 15.0);

    expect(phrases.length).toBeGreaterThanOrEqual(3);
    for (const p of phrases) {
      expect(p.text.length).toBeLessThanOrEqual(40);
      expect(p.startSec).toBeGreaterThanOrEqual(0.05);
      expect(p.endSec).toBeLessThanOrEqual(15.0);
      expect(p.endSec).toBeGreaterThan(p.startSec);
    }

    // Confirm phrases sequential timestamps
    for (let i = 0; i < phrases.length - 1; i++) {
      expect(phrases[i]!.endSec).toBeCloseTo(phrases[i + 1]!.startSec, 2);
    }
  });

  it("transcriptToCaptionEntries maps long segments into phrase-level ASS caption entries", () => {
    const segments = [
      { text: "Ever feel like your daily shoes are holding you back? Upgrade to sugarcane and tree fiber comfort. Step naturally today.", startSec: 0.1, endSec: 15.0, reviewed: true }
    ];
    const entries = transcriptToCaptionEntries(segments);

    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(entries[0]!.text).not.toContain("Step naturally today");
    expect(entries[entries.length - 1]!.text).toBe("Step naturally today.");
  });

  it("shifts captions earlier by the global caption lead (never late)", () => {
    // Default 0.25s lead: [1.0, 3.0] becomes [0.75, 2.75].
    const phrases = segmentTextToPhrases("Hello world this is a test sentence.", 1.0, 3.0);
    expect(phrases[0]!.startSec).toBeCloseTo(0.75, 2);
    expect(phrases[phrases.length - 1]!.endSec).toBeCloseTo(2.75, 2);
  });

  it("allows the caption lead to be overridden for fine-tuning", () => {
    // leadSec = 0 gives exact alignment (no early shift).
    const exact = segmentTextToPhrases("Hello world this is a test sentence.", 1.0, 3.0, 32, 0);
    expect(exact[0]!.startSec).toBeCloseTo(1.0, 2);
  });

  it("clamps the caption lead so the first phrase never starts before the video", () => {
    // 0.1 - 0.25 = -0.15, clamped to the 0.05 floor.
    const phrases = segmentTextToPhrases("Hello world.", 0.1, 2.0);
    expect(phrases[0]!.startSec).toBeCloseTo(0.05, 2);
    expect(phrases[0]!.startSec).toBeGreaterThanOrEqual(0);
  });
});


describe("caption layout (responsive safe-area)", () => {
  it("wraps more characters per line on landscape than on vertical", () => {
    expect(captionMaxCharsPerLine(1.78)).toBeGreaterThan(captionMaxCharsPerLine(0.5625));
    expect(captionMaxCharsPerLine(1.0)).toBeGreaterThan(captionMaxCharsPerLine(0.5625));
  });

  it("widens the container ratio on landscape vs vertical", () => {
    expect(captionMaxWidthRatio(1.78)).toBeGreaterThan(captionMaxWidthRatio(0.5625));
  });

  it("clamps X so the caption box never leaves the horizontal safe area", () => {
    const lo = CAPION_SAFE_MARGIN_X + CAPION_NOMINAL_HALF_WIDTH;
    const hi = 1 - CAPION_SAFE_MARGIN_X - CAPION_NOMINAL_HALF_WIDTH;
    expect(clampCaptionX(0.01, 1.0)).toBeCloseTo(lo);
    expect(clampCaptionX(0.99, 1.0)).toBeCloseTo(hi);
    expect(clampCaptionX(0.5, 1.0)).toBeCloseTo(0.5);
  });

  it("clamps Y so the caption box allows nearly full vertical range (0.04 to 0.96) at scale 1.0", () => {
    expect(clampCaptionY(0.0, 1.0)).toBeCloseTo(0.04);
    expect(clampCaptionY(1.0, 1.0)).toBeCloseTo(0.96);
  });

  it("centers the caption when it is scaled larger than the safe area", () => {
    expect(clampCaptionX(0.1, 5.0)).toBeCloseTo(0.5);
  });
});


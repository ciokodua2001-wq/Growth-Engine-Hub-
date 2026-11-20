import { describe, expect, it } from "vitest";
import { buildPerShotRenderJobs } from "../videoRenderPipeline.js";

const SHOTS = [
  { shotNumber: 1, duration: 4, environment: "Study room", subjectAction: "Frustrated", facialExpression: "", bodyMovement: "", cameraMovement: "Push in", lensStyle: "", lighting: "", visualEffects: "", transition: "", dialogue: "\"What is the emergency?!\"" },
  { shotNumber: 2, duration: 3, environment: "Study room", subjectAction: "Points", facialExpression: "", bodyMovement: "", cameraMovement: "", lensStyle: "", lighting: "", visualEffects: "", transition: "", dialogue: "'His homework is due tomorrow!'" },
  { shotNumber: 3, duration: 3, environment: "Kitchen", subjectAction: "Smiles", facialExpression: "", bodyMovement: "", cameraMovement: "", lensStyle: "", lighting: "", visualEffects: "", transition: "", dialogue: "" },
];

const PLAN = {
  visualStyle: "Nollywood family comedy", characterDescription: "A student", environment: "Home",
  lighting: "Warm", cameraLanguage: "Cinematic", performanceDirection: "Energetic", shots: SHOTS,
};

const OPTS = {
  videoId: 72, resolution: "1080p" as const, aspectRatio: "9:16" as const,
  script: "FALLBACK SCRIPT", cinematicPlan: JSON.stringify(PLAN),
};

describe("buildPerShotRenderJobs (one shot per Grok request, no contact sheets)", () => {
  it("produces one job per shot for a multi-shot plan", () => {
    expect(buildPerShotRenderJobs(OPTS)).toHaveLength(3);
  });

  it("wraps every job as a SINGLE-shot plan so Grok cannot tile panels", () => {
    for (const job of buildPerShotRenderJobs(OPTS)) {
      const parsed = JSON.parse(job.cinematicPlan!) as { shots: unknown[] };
      expect(parsed.shots).toHaveLength(1);
    }
  });

  it("gives each shot its own dialogue line, stripped of wrapping quotes", () => {
    const jobs = buildPerShotRenderJobs(OPTS);
    expect(jobs[0]!.script).toBe("What is the emergency?!");
    expect(jobs[1]!.script).toBe("His homework is due tomorrow!");
    expect(jobs[2]!.script).toBe("");
  });

  it("numbers segments 1..N with cumulative start offsets", () => {
    const jobs = buildPerShotRenderJobs(OPTS);
    expect(jobs.map(j => j.segmentIndex)).toEqual([1, 2, 3]);
    expect(jobs.map(j => j.segmentStartSec)).toEqual([0, 4, 7]);
    expect(jobs.every(j => j.segmentCount === 3)).toBe(true);
    expect(jobs.map(j => j.durationSec)).toEqual([4, 3, 3]);
  });

  it("keeps the plan-level style on every single-shot plan", () => {
    for (const job of buildPerShotRenderJobs(OPTS)) {
      const parsed = JSON.parse(job.cinematicPlan!) as { visualStyle: string };
      expect(parsed.visualStyle).toBe("Nollywood family comedy");
    }
  });

  it("clamps shot durations into Grok's 3-15s window", () => {
    const odd = { ...PLAN, shots: [
      { ...SHOTS[0]!, duration: 1 }, { ...SHOTS[1]!, duration: 40 },
    ] };
    const jobs = buildPerShotRenderJobs({ ...OPTS, cinematicPlan: JSON.stringify(odd) });
    expect(jobs.map(j => j.durationSec)).toEqual([3, 15]);
  });

  it("returns [] for a single-shot plan so the caller uses one request", () => {
    const single = { ...PLAN, shots: [SHOTS[0]!] };
    expect(buildPerShotRenderJobs({ ...OPTS, cinematicPlan: JSON.stringify(single) })).toEqual([]);
  });

  it("returns [] for an unparseable or shotless plan", () => {
    expect(buildPerShotRenderJobs({ ...OPTS, cinematicPlan: "not json" })).toEqual([]);
    expect(buildPerShotRenderJobs({ ...OPTS, cinematicPlan: JSON.stringify({ shots: [] }) })).toEqual([]);
    expect(buildPerShotRenderJobs({ ...OPTS, cinematicPlan: "" })).toEqual([]);
  });

  it("defaults a missing or non-positive shot duration instead of dropping planned content", () => {
    const partial = { ...PLAN, shots: [
      { ...SHOTS[0]!, duration: 4 }, { ...SHOTS[1]!, duration: 0 }, { ...SHOTS[2]!, duration: NaN },
    ] };
    const jobs = buildPerShotRenderJobs({ ...OPTS, cinematicPlan: JSON.stringify(partial) });
    // All three shots survive, so the plan stays multi-shot and is still split.
    expect(jobs).toHaveLength(3);
    expect(jobs.map(j => j.durationSec)).toEqual([4, 4, 4]);
  });
});

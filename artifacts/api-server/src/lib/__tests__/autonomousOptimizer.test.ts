import { describe, it, expect } from "vitest";
import {
  evaluateCampaign,
  computeBudgetStep,
  isCooldownActive,
  DEFAULT_GUARDRAILS,
  type CampaignSnapshot,
} from "../autonomousOptimizer.js";

function snap(overrides: Partial<CampaignSnapshot> = {}): CampaignSnapshot {
  return {
    id: 1,
    projectId: 13,
    externalId: "123",
    source: "meta",
    status: "active",
    budget: 10,
    spent: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    roas: null,
    ctr: null,
    cpc: null,
    ...overrides,
  };
}

describe("computeBudgetStep", () => {
  it("steps up by budgetStepPct", () => {
    expect(computeBudgetStep(10, "up", DEFAULT_GUARDRAILS)).toBe(12);
  });
  it("steps down by budgetStepPct", () => {
    expect(computeBudgetStep(10, "down", DEFAULT_GUARDRAILS)).toBe(8);
  });
  it("clamps to maxDailyBudget", () => {
    expect(computeBudgetStep(190, "up", DEFAULT_GUARDRAILS)).toBe(200);
  });
  it("clamps to minDailyBudget", () => {
    expect(computeBudgetStep(1, "down", DEFAULT_GUARDRAILS)).toBe(1);
  });
});

describe("evaluateCampaign", () => {
  it("NOOP when paused with no historical performance", () => {
    const d = evaluateCampaign(snap({ status: "paused", spent: 0, conversions: 0 }));
    expect(d.action).toBe("NOOP");
    expect(d.reason).toBe("paused campaign has no historical performance to justify resume");
  });

  it("RESUME recommendation when paused with historical conversions", () => {
    const d = evaluateCampaign(snap({ status: "paused", spent: 120, conversions: 8 }));
    expect(d.action).toBe("RESUME");
    expect(d.afterStatus).toBe("active");
  });

  it("RESUME recommendation when paused and historically profitable", () => {
    const d = evaluateCampaign(snap({ status: "paused", spent: 100, conversions: 0, roas: 2.5 }));
    expect(d.action).toBe("RESUME");
  });

  it("NOOP when paused and historically unprofitable", () => {
    const d = evaluateCampaign(snap({ status: "paused", spent: 100, conversions: 0, roas: 0.5 }));
    expect(d.action).toBe("NOOP");
  });

  it("NOOP when completed/archived (not paused, not active)", () => {
    const d = evaluateCampaign(snap({ status: "completed", spent: 100, conversions: 5 }));
    expect(d.action).toBe("NOOP");
    expect(d.reason).toBe("campaign is not active");
  });

  it("NOOP when no budget configured", () => {
    const d = evaluateCampaign(snap({ budget: null }));
    expect(d.action).toBe("NOOP");
  });

  it("PAUSE when spending with zero conversions beyond threshold", () => {
    const d = evaluateCampaign(snap({ spent: 60, conversions: 0 }));
    expect(d.action).toBe("PAUSE");
    expect(d.afterStatus).toBe("paused");
  });

  it("DECREASE_BUDGET when spending with zero conversions above decrease threshold", () => {
    const d = evaluateCampaign(snap({ spent: 25, conversions: 0, budget: 100 }));
    expect(d.action).toBe("DECREASE_BUDGET");
    expect(d.afterBudget).toBe(80);
  });

  it("INCREASE_BUDGET on a proven winner (roas >= target)", () => {
    const d = evaluateCampaign(snap({ conversions: 5, roas: 2.5, budget: 50 }));
    expect(d.action).toBe("INCREASE_BUDGET");
    expect(d.afterBudget).toBe(60);
  });

  it("DECREASE_BUDGET when roas below floor", () => {
    const d = evaluateCampaign(snap({ conversions: 1, roas: 0.5, budget: 50 }));
    expect(d.action).toBe("DECREASE_BUDGET");
    expect(d.afterBudget).toBe(40);
  });

  it("NOOP when within guardrails (low spend, no data)", () => {
    const d = evaluateCampaign(snap({ spent: 5, conversions: 0, roas: null }));
    expect(d.action).toBe("NOOP");
  });

  it("pause takes priority over decrease when both thresholds crossed", () => {
    const d = evaluateCampaign(snap({ spent: 80, conversions: 0, budget: 100 }));
    expect(d.action).toBe("PAUSE");
  });
});


describe("isCooldownActive", () => {
  const now = new Date("2026-10-21T12:00:00Z");

  it("returns false when no prior application", () => {
    expect(isCooldownActive(null, 360, now)).toBe(false);
  });

  it("returns false when cooldown is disabled", () => {
    expect(isCooldownActive(new Date("2026-10-21T11:59:00Z"), 0, now)).toBe(false);
  });

  it("returns true when within the cooldown window", () => {
    expect(isCooldownActive(new Date("2026-10-21T11:00:00Z"), 360, now)).toBe(true);
  });

  it("returns false once the cooldown window has elapsed", () => {
    expect(isCooldownActive(new Date("2026-10-21T06:00:00Z"), 360, now)).toBe(false);
  });
});

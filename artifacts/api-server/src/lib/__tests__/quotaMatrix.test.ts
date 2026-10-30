import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { sql, eq } from "drizzle-orm";

// ── Isolated test environment (set BEFORE importing @workspace/db) ────────────
const URL = "postgresql://ubuntu@/growthforge_nigeria_test?host=/var/run/postgresql";
process.env.DATABASE_URL = URL;

// requireActiveSubscription reads the auth userId; route to a fixed test user.
vi.mock("../supabaseAuth.js", () => ({
  getAuth: () => ({ userId: "quota-test-user" }),
}));

import { PLAN_LIMITS, PLAN_PROJECT_LIMITS, meetsMinPlan } from "../planLimits.js";
import { TRIAL_LIMITS } from "../trialLimits.js";
import { VIDEO_CONFIG_DEFAULTS } from "../videoConfig.js";

// ── 1. Sanctioned entitlement matrix (source of truth = pricing cards) ────────
describe("Plan entitlement matrix matches the pricing cards", () => {
  it("Starter matches the Starter card", () => {
    expect(PLAN_LIMITS["starter"]).toEqual({
      analysis: 3,
      competitors: 2,
      competitor_report: 2,
      personas: 3,
      strategy: 1,
      social_posts: 50,
      email_campaigns: 10,
      ads: 10,
      video_blueprints: 5,
      agent_messages: 200,
      image_generation: 15,
      seo_strategy: 1,
      campaign_reports: 1,
      seo_blog_posts: 5,
      seo_watchdog: 4,
    });
  });

  it("Get-Going matches the Get-Going card", () => {
    expect(PLAN_LIMITS["get-going"]).toEqual({
      analysis: 8,
      competitors: 6,
      competitor_report: 6,
      personas: 10,
      strategy: 3,
      social_posts: 100,
      email_campaigns: 30,
      ads: 30,
      video_blueprints: 13,
      agent_messages: 600,
      image_generation: 30,
      seo_strategy: 3,
      campaign_reports: 2,
      seo_blog_posts: 15,
      seo_watchdog: 4,
    });
  });

  it("Growth matches the Growth card", () => {
    expect(PLAN_LIMITS["growth"]).toEqual({
      analysis: 15,
      competitors: 12,
      competitor_report: 12,
      personas: 20,
      strategy: 6,
      social_posts: 200,
      email_campaigns: 60,
      ads: 60,
      video_blueprints: 35,
      agent_messages: 1000,
      image_generation: 60,
      seo_strategy: 6,
      campaign_reports: 5,
      seo_blog_posts: 30,
      seo_watchdog: 4,
    });
  });

  it("Agency matches the Agency card (SEO blog posts & watchdog unlimited)", () => {
    expect(PLAN_LIMITS["agency"]).toEqual({
      analysis: 30,
      competitors: 25,
      competitor_report: 25,
      personas: 50,
      strategy: 15,
      social_posts: 400,
      email_campaigns: 120,
      ads: 120,
      video_blueprints: 70,
      agent_messages: 4000,
      image_generation: 120,
      seo_strategy: 20,
      campaign_reports: 10,
      seo_blog_posts: null,
      seo_watchdog: null,
    });
  });

  it("Free trial matches the trial card", () => {
    expect(TRIAL_LIMITS).toEqual({
      analysis: 1,
      competitors: 1,
      personas: 2,
      strategy: 1,
      competitor_report: 1,
      social_posts: 5,
      email_campaigns: 1,
      video_blueprints: 0,
      ads: 0,
      image_generation: 0,
      agent_messages: 10,
      seo_strategy: 0,
      campaign_reports: 0,
      seo_blog_posts: 0,
      seo_watchdog: 1,
    });
  });

  it("Project counts match the cards (trial/starter 1, get-going 3, growth 6, agency 20)", () => {
    expect(PLAN_PROJECT_LIMITS).toEqual({
      trial: 1,
      starter: 1,
      "get-going": 3,
      growth: 6,
      agency: 20,
    });
  });

  it("Included video seconds match the cards (0/80/200/560/1120)", () => {
    expect(VIDEO_CONFIG_DEFAULTS.trial_monthly_seconds).toBe("0");
    expect(VIDEO_CONFIG_DEFAULTS.starter_monthly_seconds).toBe("80");
    expect(VIDEO_CONFIG_DEFAULTS.get_going_monthly_seconds).toBe("200");
    expect(VIDEO_CONFIG_DEFAULTS.growth_monthly_seconds).toBe("560");
    expect(VIDEO_CONFIG_DEFAULTS.agency_monthly_seconds).toBe("1120");
  });

  it("annual and monthly share identical entitlements (entitlements keyed on plan slug, not interval)", () => {
    // Entitlement lookup is by plan slug only; there is no interval dimension in
    // PLAN_LIMITS/PLAN_PROJECT_LIMITS/video seconds. Asserting the matrix above is
    // interval-agnostic by construction - a monthly and annual "starter" are the
    // same slug and therefore the same entitlements.
    expect(Object.keys(PLAN_LIMITS).sort()).toEqual(["agency", "get-going", "growth", "starter"]);
  });
});

describe("Tier gating (meetsMinPlan)", () => {
  it("orders trial < starter < get-going < growth < agency", () => {
    expect(meetsMinPlan("starter", "starter")).toBe(true);
    expect(meetsMinPlan("get-going", "starter")).toBe(true);
    expect(meetsMinPlan("growth", "get-going")).toBe(true);
    expect(meetsMinPlan("agency", "growth")).toBe(true);
    expect(meetsMinPlan("trial", "starter")).toBe(false);
    expect(meetsMinPlan("starter", "get-going")).toBe(false);
    expect(meetsMinPlan("growth", "agency")).toBe(false);
    expect(meetsMinPlan("agency", "agency")).toBe(true);
  });

  it("fails closed for unknown or invalid plans (no elevated paid access)", () => {
    expect(meetsMinPlan("unknown", "starter")).toBe(false);
    expect(meetsMinPlan("", "get-going")).toBe(false);
    expect(meetsMinPlan("custom", "agency")).toBe(false);
    expect(meetsMinPlan("trial", "unknown")).toBe(false); // unknown minPlan also fails closed
    // recognized plans still work
    expect(meetsMinPlan("starter", "starter")).toBe(true);
    expect(meetsMinPlan("agency", "starter")).toBe(true);
  });
});

// ── 2. requireActiveSubscription trial-expiry gate (server-side enforcement) ──
describe("requireActiveSubscription (trial expiry + cancellation)", () => {
  let db: any;
  let usersTable: any;
  let requireActiveSubscription: any;

  beforeAll(async () => {
    ({ db, usersTable } = await import("@workspace/db"));
    ({ requireActiveSubscription } = await import("../authz.js"));
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`);
  });

  function harness() {
    let statusCode = 0;
    let jsonBody: any = null;
    let nextCalled = false;
    const res: any = {
      status: (c: number) => { statusCode = c; return res; },
      json: (b: unknown) => { jsonBody = b; return res; },
    };
    const next = () => { nextCalled = true; };
    return { res, next, get: () => ({ statusCode, jsonBody, nextCalled }) };
  }

  async function seed(overrides: Record<string, unknown> = {}) {
    await db.insert(usersTable).values({ id: "quota-test-user", email: "quota@test.com", ...overrides });
  }

  it("blocks generation when a trial has expired", async () => {
    await seed({ plan: "trial", subscriptionStatus: "trial", trialEndsAt: new Date("2020-01-01T00:00:00.000Z") });
    const h = harness();
    await requireActiveSubscription({} as any, h.res, h.next);
    expect(h.get().statusCode).toBe(403);
    expect(h.get().jsonBody.error).toBe("trial_expired");
    expect(h.get().nextCalled).toBe(false);
  });

  it("allows generation for an unexpired trial", async () => {
    await seed({ plan: "trial", subscriptionStatus: "trial", trialEndsAt: new Date("2099-01-01T00:00:00.000Z") });
    const h = harness();
    await requireActiveSubscription({} as any, h.res, h.next);
    expect(h.get().nextCalled).toBe(true);
    expect(h.get().statusCode).toBe(0);
  });

  it("blocks generation for a cancelled subscriber", async () => {
    await seed({ plan: "starter", subscriptionStatus: "cancelled" });
    const h = harness();
    await requireActiveSubscription({} as any, h.res, h.next);
    expect(h.get().statusCode).toBe(403);
    expect(h.get().jsonBody.error).toBe("subscription_cancelled");
  });

  it("blocks generation for a non-renewing subscriber whose paid period ended", async () => {
    await seed({
      plan: "starter", subscriptionStatus: "active",
      paystackRenewalDisabled: true, paystackAccessEndsAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const h = harness();
    await requireActiveSubscription({} as any, h.res, h.next);
    expect(h.get().statusCode).toBe(403);
    expect(h.get().jsonBody.error).toBe("subscription_cancelled");
  });

  it("allows generation for an active paid subscriber", async () => {
    await seed({ plan: "growth", subscriptionStatus: "active" });
    const h = harness();
    await requireActiveSubscription({} as any, h.res, h.next);
    expect(h.get().nextCalled).toBe(true);
  });
});

describe("meetsMinPlan fail-closed for unknown plans", () => {
  it("rejects unknown plan values (no elevated access)", () => {
    expect(meetsMinPlan("unknown", "starter")).toBe(false);
    expect(meetsMinPlan("", "get-going")).toBe(false);
    expect(meetsMinPlan("custom", "agency")).toBe(false);
    expect(meetsMinPlan("trial", "unknown")).toBe(false);
  });

  it("still allows recognized tiers", () => {
    expect(meetsMinPlan("starter", "starter")).toBe(true);
    expect(meetsMinPlan("agency", "starter")).toBe(true);
    expect(meetsMinPlan("growth", "get-going")).toBe(true);
  });
});

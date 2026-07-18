import { eq, and, sum } from "drizzle-orm";
import { db } from "@workspace/db";
import { projectsTable, planUsageTable, trialUsageTable, videosTable } from "@workspace/db";
import { consumeTrialQuota, TRIAL_LIMITS, type TrialFeature } from "./trialLimits.js";

export type PlanFeature = TrialFeature;
export type PaidPlan = "starter" | "get-going" | "growth" | "agency";

/**
 * Monthly per-feature limits for each paid plan.
 * Derived from the pricing cards in plans.tsx.
 * null = unlimited for that feature on that plan.
 */
export const PLAN_LIMITS: Record<PaidPlan, Record<PlanFeature, number | null>> = {
  starter: {
    analysis: 3,
    competitors: 2,
    competitor_report: 2,
    personas: 3,
    strategy: 1,
    social_posts: 50,
    email_campaigns: 10,
    ads: 10,
    video_blueprints: 10,
    agent_messages: 200,
    image_generation: 15,
    seo_strategy: 1,
    campaign_reports: 1,
  },
  "get-going": {
    analysis: 8,
    competitors: 6,
    competitor_report: 6,
    personas: 10,
    strategy: 3,
    social_posts: 100,
    email_campaigns: 30,
    ads: 30,
    video_blueprints: 30,
    agent_messages: 600,
    image_generation: 30,
    seo_strategy: 3,
    campaign_reports: 2,
  },
  growth: {
    analysis: 15,
    competitors: 12,
    competitor_report: 12,
    personas: 20,
    strategy: 6,
    social_posts: 200,
    email_campaigns: 60,
    ads: 60,
    video_blueprints: 60,
    agent_messages: 1000,
    image_generation: 60,
    seo_strategy: 6,
    campaign_reports: 5,
  },
  agency: {
    analysis: 30,
    competitors: 25,
    competitor_report: 25,
    personas: 50,
    strategy: 15,
    social_posts: 400,
    email_campaigns: 120,
    ads: 120,
    video_blueprints: 120,
    agent_messages: 4000,
    image_generation: 120,
    seo_strategy: 20,
    campaign_reports: 10,
  },
};

/** Maximum number of projects allowed per plan tier (enforced at project creation). */
export const PLAN_PROJECT_LIMITS: Record<string, number> = {
  trial: 1,
  starter: 1,
  "get-going": 3,
  growth: 6,
  agency: 20,
};

const FEATURE_LABELS: Record<PlanFeature, string> = {
  analysis: "website analysis",
  competitors: "competitor discovery",
  personas: "persona generation",
  strategy: "marketing strategy generation",
  competitor_report: "competitor report generation",
  social_posts: "social post generation",
  email_campaigns: "email campaign generation",
  video_blueprints: "video blueprint generation",
  ads: "ad creative generation",
  agent_messages: "Forge AI messages",
  image_generation: "AI image generation",
  seo_strategy: "AI SEO Strategy generation",
  campaign_reports: "AI campaign report",
};

const PLAN_TIER_ORDER = ["trial", "starter", "get-going", "growth", "agency"] as const;

/**
 * Returns true if `projectPlan` is at or above `minPlan` in the tier hierarchy.
 * Unknown/custom plans fail-open (return true) so admin-set plans aren't blocked.
 */
export function meetsMinPlan(projectPlan: string, minPlan: string): boolean {
  const tiers = PLAN_TIER_ORDER as readonly string[];
  const projectIdx = tiers.indexOf(projectPlan);
  const minIdx = tiers.indexOf(minPlan);
  if (minIdx === -1) return true;
  if (projectIdx === -1) return true;
  return projectIdx >= minIdx;
}

/** Returns the first instant of the current UTC calendar month. */
export function currentPeriodStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export type QuotaResult =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * Unified quota enforcement for all plan tiers.
 *
 * - trial     → delegates to consumeTrialQuota (lifetime caps, existing logic)
 * - paid plan → checks and atomically increments planUsageTable for the current
 *               calendar month; resets automatically each month
 * - unknown   → passes (fail-open for admin-set custom plans)
 */
export async function consumeQuota(
  projectId: number,
  feature: PlanFeature,
  amount = 1,
): Promise<QuotaResult> {
  const [project] = await db
    .select({ plan: projectsTable.plan })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));

  if (!project) return { allowed: false, message: "Project not found" };

  const { plan } = project;

  if (plan === "trial") return consumeTrialQuota(projectId, feature, amount);

  const planLimits = PLAN_LIMITS[plan as PaidPlan];
  if (!planLimits) return { allowed: true };

  const limit = planLimits[feature];
  if (limit === null) return { allowed: true };

  const periodStart = currentPeriodStart();
  const label = FEATURE_LABELS[feature];

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(planUsageTable)
      .where(
        and(
          eq(planUsageTable.projectId, projectId),
          eq(planUsageTable.feature, feature),
          eq(planUsageTable.periodStart, periodStart),
        ),
      )
      .for("update");

    const current = existing?.count ?? 0;
    if (current + amount > limit) {
      const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
      return {
        allowed: false,
        message: `Monthly limit reached: ${label} is limited to ${limit} per month on your ${planLabel} plan. Upgrade your plan to continue.`,
      } satisfies QuotaResult;
    }

    if (existing) {
      await tx
        .update(planUsageTable)
        .set({ count: current + amount })
        .where(eq(planUsageTable.id, existing.id));
    } else {
      await tx
        .insert(planUsageTable)
        .values({ projectId, feature, count: amount, periodStart });
    }

    return { allowed: true } satisfies QuotaResult;
  });
}

/**
 * Soft display cap (seconds) for rendered video minutes per plan.
 * Not enforced as a hard quota — purely informational for the usage dashboard.
 */
const VIDEO_SECONDS_DISPLAY_LIMIT: Record<string, number | null> = {
  trial:       3 * 60,   // 3 min
  starter:     10 * 60,  // 10 min
  "get-going": 30 * 60,  // 30 min
  growth:      60 * 60,  // 60 min
  agency:      null,     // unlimited
};

/**
 * Returns quota usage for a project — used by the frontend to display
 * usage bars and remaining quota.
 *
 * - trial projects: lifetime usage from trialUsageTable, limits from TRIAL_LIMITS
 * - paid projects:  current-month usage from planUsageTable, limits from PLAN_LIMITS
 * Also returns renderedVideoSeconds (sum of duration for completed renders).
 */
export async function getQuotaUsage(projectId: number): Promise<{
  plan: string;
  periodStart: Date | null;
  renderedVideoSeconds: number;
  renderedVideoSecondsLimit: number | null;
  usage: Record<string, { used: number; limit: number | null }>;
} | null> {
  const [project] = await db
    .select({ plan: projectsTable.plan })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));

  if (!project) return null;

  const { plan } = project;
  const isTrial = plan === "trial";
  const periodStart = isTrial ? null : currentPeriodStart();

  const [quotaRows, videoSecRow] = await Promise.all([
    isTrial
      ? db
          .select({ feature: trialUsageTable.feature, count: trialUsageTable.count })
          .from(trialUsageTable)
          .where(eq(trialUsageTable.projectId, projectId))
      : db
          .select({ feature: planUsageTable.feature, count: planUsageTable.count })
          .from(planUsageTable)
          .where(
            and(
              eq(planUsageTable.projectId, projectId),
              eq(planUsageTable.periodStart, periodStart!),
            ),
          ),
    db
      .select({ total: sum(videosTable.duration) })
      .from(videosTable)
      .where(
        and(
          eq(videosTable.projectId, projectId),
          eq(videosTable.renderStatus, "complete"),
        ),
      ),
  ]);

  const usageMap: Record<string, number> = {};
  for (const row of quotaRows) usageMap[row.feature] = row.count;

  const limits: Record<string, number | null> = isTrial
    ? TRIAL_LIMITS
    : (PLAN_LIMITS[plan as PaidPlan] ?? {});

  const usage: Record<string, { used: number; limit: number | null }> = {};
  for (const [feat, limit] of Object.entries(limits)) {
    usage[feat] = { used: usageMap[feat] ?? 0, limit: limit as number | null };
  }

  const renderedVideoSeconds = parseInt(videoSecRow[0]?.total ?? "0", 10) || 0;
  const renderedVideoSecondsLimit = VIDEO_SECONDS_DISPLAY_LIMIT[plan] ?? null;

  return { plan, periodStart, renderedVideoSeconds, renderedVideoSecondsLimit, usage };
}

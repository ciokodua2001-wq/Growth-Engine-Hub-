import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { projectsTable, trialUsageTable } from "@workspace/db";

// Limits are sized to keep the theoretical worst-case AI spend for a single trial
// project at or below $0.45 (see cost-per-unit table in the trial-spend-cap memory
// note / replit.md). Every limit below participates in that budget — do not add a
// new AI-costing feature without a matching entry here and a re-check of the total.
//
// Worst-case budget at max trial utilization (~$0.178 total, under $0.18 cap):
//   analysis $0.030, 1×competitors $0.020, personas $0.020, strategy $0.020,
//   competitor_report $0.040, 5×social_posts $0.025, 10×agent_messages $0.023 (Haiku)
//   → total $0.178. email/ads/images/video_blueprints are paid-only (quota = 0).
//
// NOTE: Forge AI chat runs on Claude Haiku ($0.0023/msg). Trial limit is 10 messages
// — enough to demonstrate the agent without meaningful extraction risk.
//
// Content Engine (blog/whitepaper/case-study etc.): NOT on trial — excluded from this
// budget because a single 3-piece generation call costs ~$0.030-0.060 (long-form body
// text). Gated behind meetsMinPlan(..., "get-going") in routes/content.ts instead.
//
// Video renders are NOT available on trial — they are exclusively a paid feature.
// Any new AI-costing feature must get its own TRIAL_LIMITS entry and be re-checked
// against the $0.45 budget before shipping.
export const TRIAL_LIMITS = {
  analysis: 1,
  competitors: 1,
  personas: 1,
  strategy: 1,
  competitor_report: 1,
  social_posts: 5,
  // Paid-only content features — quota = 0 blocks trial entirely; UI shows upgrade teaser.
  email_campaigns: 0,
  video_blueprints: 0,
  ads: 0,
  image_generation: 0,
  agent_messages: 10,
  // SEO Strategy Builder is a paid-only feature; trial quota = 0 blocks it entirely.
  seo_strategy: 0,
  // Campaign reports are paid-only (requireActiveSubscription gate); quota = 0 blocks trial entirely.
  campaign_reports: 0,
} as const;

export type TrialFeature = keyof typeof TRIAL_LIMITS;

const FEATURE_LABELS: Record<TrialFeature, string> = {
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
  seo_strategy: "AI SEO Strategy Builder",
  campaign_reports: "AI campaign report",
};

const FEATURE_UNITS: Record<TrialFeature, string> = {
  analysis: "time",
  competitors: "time",
  personas: "time",
  strategy: "time",
  competitor_report: "time",
  social_posts: "post",
  email_campaigns: "time",
  video_blueprints: "time",
  ads: "ad",
  agent_messages: "message",
  image_generation: "image",
  seo_strategy: "strategy",
  campaign_reports: "report",
};

/** Trial-plan video blueprint batches are capped smaller than the platform's normal
 * "auto" batch size (9) to keep a single generation event's cost bounded. */
export const TRIAL_MAX_VIDEO_BATCH = 3;

/** Returns the project's plan, or null if the project doesn't exist. */
export async function getProjectPlan(projectId: number): Promise<string | null> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  return project?.plan ?? null;
}

export type TrialQuotaResult =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * Checks whether a project (still on the trial plan) has remaining quota for an
 * AI-costing (or otherwise trial-capped) feature, and if so, atomically consumes
 * `amount` units of quota. Use `amount` > 1 for features where a single request
 * can produce a variable-size batch (e.g. generating N social posts at once).
 * Paid plans (anything other than "trial") always pass.
 */
export async function consumeTrialQuota(
  projectId: number,
  feature: TrialFeature,
  amount = 1,
): Promise<TrialQuotaResult> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    return { allowed: false, message: "Project not found" };
  }
  if (project.plan !== "trial") {
    return { allowed: true };
  }

  const limit = TRIAL_LIMITS[feature];
  const unit = FEATURE_UNITS[feature];

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trialUsageTable)
      .where(and(eq(trialUsageTable.projectId, projectId), eq(trialUsageTable.feature, feature)))
      .for("update");

    const current = existing?.count ?? 0;
    if (current + amount > limit) {
      return {
        allowed: false,
        message: `Trial limit reached: ${FEATURE_LABELS[feature]} is limited to ${limit} ${unit}${limit === 1 ? "" : "s"} during your trial. Upgrade your plan to continue.`,
      } satisfies TrialQuotaResult;
    }

    if (existing) {
      await tx.update(trialUsageTable).set({ count: current + amount }).where(eq(trialUsageTable.id, existing.id));
    } else {
      await tx.insert(trialUsageTable).values({ projectId, feature, count: amount });
    }

    return { allowed: true } satisfies TrialQuotaResult;
  });
}

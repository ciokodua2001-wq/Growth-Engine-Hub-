import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { projectsTable, trialUsageTable } from "@workspace/db";

export const TRIAL_LIMITS = {
  analysis: 1,
  competitors: 3,
  personas: 1,
  strategy: 1,
  competitor_report: 3,
  social_posts: 5,
  email_campaigns: 1,
  video_blueprints: 1,
  agent_messages: 25,
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
  agent_messages: "Forge AI messages",
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
  agent_messages: "message",
};

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

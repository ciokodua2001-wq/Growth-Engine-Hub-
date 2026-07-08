import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { projectsTable, trialUsageTable } from "@workspace/db";

export const TRIAL_LIMITS = {
  analysis: 1,
  competitors: 3,
  personas: 1,
  strategy: 1,
  competitor_report: 3,
} as const;

export type TrialFeature = keyof typeof TRIAL_LIMITS;

const FEATURE_LABELS: Record<TrialFeature, string> = {
  analysis: "website analysis",
  competitors: "competitor discovery",
  personas: "persona generation",
  strategy: "marketing strategy generation",
  competitor_report: "competitor report generation",
};

export type TrialQuotaResult =
  | { allowed: true }
  | { allowed: false; message: string };

/**
 * Checks whether a project (still on the trial plan) has remaining quota for an
 * AI-costing feature, and if so, atomically consumes one unit of quota.
 * Paid plans (anything other than "trial") always pass.
 */
export async function consumeTrialQuota(
  projectId: number,
  feature: TrialFeature,
): Promise<TrialQuotaResult> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    return { allowed: false, message: "Project not found" };
  }
  if (project.plan !== "trial") {
    return { allowed: true };
  }

  const limit = TRIAL_LIMITS[feature];

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trialUsageTable)
      .where(and(eq(trialUsageTable.projectId, projectId), eq(trialUsageTable.feature, feature)))
      .for("update");

    const current = existing?.count ?? 0;
    if (current >= limit) {
      return {
        allowed: false,
        message: `Trial limit reached: ${FEATURE_LABELS[feature]} is limited to ${limit} time${limit === 1 ? "" : "s"} during your trial. Upgrade your plan to continue.`,
      } satisfies TrialQuotaResult;
    }

    if (existing) {
      await tx.update(trialUsageTable).set({ count: current + 1 }).where(eq(trialUsageTable.id, existing.id));
    } else {
      await tx.insert(trialUsageTable).values({ projectId, feature, count: 1 });
    }

    return { allowed: true } satisfies TrialQuotaResult;
  });
}

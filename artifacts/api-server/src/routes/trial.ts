import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { trialUsageTable } from "@workspace/db";
import { TRIAL_LIMITS } from "../lib/trialLimits.js";

const router: IRouter = Router();

router.get("/trial/usage/:projectId", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  try {
    const usageRows = await db.select().from(trialUsageTable).where(eq(trialUsageTable.projectId, projectId));
    const usageByFeature = Object.fromEntries(usageRows.map((row) => [row.feature, row.count]));

    res.json({
      analyses: usageByFeature.analysis ?? 0,
      competitors: usageByFeature.competitors ?? 0,
      personas: usageByFeature.personas ?? 0,
      strategies: usageByFeature.strategy ?? 0,
      competitorReports: usageByFeature.competitor_report ?? 0,
      socialPosts: usageByFeature.social_posts ?? 0,
      emailCampaigns: usageByFeature.email_campaigns ?? 0,
      videoBlueprints: usageByFeature.video_blueprints ?? 0,
      agentMessages: usageByFeature.agent_messages ?? 0,
      limits: {
        analyses: TRIAL_LIMITS.analysis,
        competitors: TRIAL_LIMITS.competitors,
        personas: TRIAL_LIMITS.personas,
        strategies: TRIAL_LIMITS.strategy,
        competitorReports: TRIAL_LIMITS.competitor_report,
        socialPosts: TRIAL_LIMITS.social_posts,
        emailCampaigns: TRIAL_LIMITS.email_campaigns,
        videoBlueprints: TRIAL_LIMITS.video_blueprints,
        agentMessages: TRIAL_LIMITS.agent_messages,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching trial usage");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

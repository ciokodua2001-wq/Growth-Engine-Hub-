import { Router, type IRouter } from "express";
import { eq, count, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  socialPostsTable,
  emailCampaignsTable,
  videosTable,
  agentMessagesTable,
  trialUsageTable,
} from "@workspace/db";
import { TRIAL_LIMITS } from "../lib/trialLimits.js";

const router: IRouter = Router();

router.get("/trial/usage/:projectId", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  try {
    const [
      usageRows,
      [socialPosts],
      [emailCampaigns],
      [videoBlueprints],
      [agentMessages],
    ] = await Promise.all([
      db.select().from(trialUsageTable).where(eq(trialUsageTable.projectId, projectId)),
      db.select({ count: count() }).from(socialPostsTable).where(eq(socialPostsTable.projectId, projectId)),
      db.select({ count: count() }).from(emailCampaignsTable).where(eq(emailCampaignsTable.projectId, projectId)),
      db.select({ count: count() }).from(videosTable).where(eq(videosTable.projectId, projectId)),
      db.select({ count: count() }).from(agentMessagesTable).where(
        and(eq(agentMessagesTable.projectId, projectId), eq(agentMessagesTable.role, "user"))
      ),
    ]);

    const usageByFeature = Object.fromEntries(usageRows.map((row) => [row.feature, row.count]));

    res.json({
      analyses: usageByFeature.analysis ?? 0,
      competitors: usageByFeature.competitors ?? 0,
      personas: usageByFeature.personas ?? 0,
      strategies: usageByFeature.strategy ?? 0,
      competitorReports: usageByFeature.competitor_report ?? 0,
      socialPosts: socialPosts.count,
      emailCampaigns: emailCampaigns.count,
      videoBlueprints: videoBlueprints.count,
      agentMessages: agentMessages.count,
      limits: {
        analyses: TRIAL_LIMITS.analysis,
        competitors: TRIAL_LIMITS.competitors,
        personas: TRIAL_LIMITS.personas,
        strategies: TRIAL_LIMITS.strategy,
        competitorReports: TRIAL_LIMITS.competitor_report,
        socialPosts: 5,
        emailCampaigns: 1,
        videoBlueprints: 1,
        agentMessages: 25,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching trial usage");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

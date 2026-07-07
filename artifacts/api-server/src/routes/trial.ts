import { Router, type IRouter } from "express";
import { eq, count, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  businessAnalysisTable,
  competitorsTable,
  marketingStrategyTable,
  socialPostsTable,
  emailCampaignsTable,
  videosTable,
  agentMessagesTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/trial/usage/:projectId", async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  try {
    const [
      [analyses],
      [competitors],
      [strategies],
      [socialPosts],
      [emailCampaigns],
      [videoBlueprints],
      [agentMessages],
    ] = await Promise.all([
      db.select({ count: count() }).from(businessAnalysisTable).where(eq(businessAnalysisTable.projectId, projectId)),
      db.select({ count: count() }).from(competitorsTable).where(eq(competitorsTable.projectId, projectId)),
      db.select({ count: count() }).from(marketingStrategyTable).where(eq(marketingStrategyTable.projectId, projectId)),
      db.select({ count: count() }).from(socialPostsTable).where(eq(socialPostsTable.projectId, projectId)),
      db.select({ count: count() }).from(emailCampaignsTable).where(eq(emailCampaignsTable.projectId, projectId)),
      db.select({ count: count() }).from(videosTable).where(eq(videosTable.projectId, projectId)),
      db.select({ count: count() }).from(agentMessagesTable).where(
        and(eq(agentMessagesTable.projectId, projectId), eq(agentMessagesTable.role, "user"))
      ),
    ]);

    res.json({
      analyses: analyses.count,
      competitors: competitors.count,
      strategies: strategies.count,
      socialPosts: socialPosts.count,
      emailCampaigns: emailCampaigns.count,
      videoBlueprints: videoBlueprints.count,
      agentMessages: agentMessages.count,
      limits: {
        analyses: 1,
        competitors: 3,
        strategies: 1,
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

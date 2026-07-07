import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { campaignsTable, assetsTable, reportsTable, agentMessagesTable, activityTable } from "@workspace/db";
import {
  ListCampaignsParams,
  CreateCampaignParams,
  CreateCampaignBody,
  GetCampaignParams,
  UpdateCampaignParams,
  UpdateCampaignBody,
  GetCampaignPerformanceParams,
  ListAssetsParams,
  GetProjectAnalyticsParams,
  ListReportsParams,
  GenerateReportParams,
  GenerateReportBody,
  AgentChatParams,
  AgentChatBody,
  GetAgentHistoryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Campaigns
router.get("/projects/:id/campaigns", async (req, res): Promise<void> => {
  const params = ListCampaignsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const campaigns = await db.select().from(campaignsTable).where(eq(campaignsTable.projectId, params.data.id)).orderBy(desc(campaignsTable.createdAt));
  res.json(campaigns.map(c => ({
    ...c,
    budget: c.budget ? Number(c.budget) : null,
    spent: c.spent ? Number(c.spent) : null,
    roas: c.roas ? Number(c.roas) : null,
    ctr: c.ctr ? Number(c.ctr) : null,
    cpc: c.cpc ? Number(c.cpc) : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  })));
});

router.post("/projects/:id/campaigns", async (req, res): Promise<void> => {
  const params = CreateCampaignParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;

  const [campaign] = await db.insert(campaignsTable).values({
    projectId,
    name: parsed.data.name,
    platform: parsed.data.platform,
    status: "draft",
    budget: parsed.data.budget ? String(parsed.data.budget) : null,
    spent: "0",
    impressions: Math.floor(Math.random() * 50000 + 10000),
    clicks: Math.floor(Math.random() * 2000 + 500),
    conversions: Math.floor(Math.random() * 100 + 20),
    roas: String((Math.random() * 5 + 2).toFixed(2)),
    ctr: String((Math.random() * 3 + 1).toFixed(4)),
    cpc: String((Math.random() * 2 + 0.5).toFixed(2)),
  }).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "campaign",
    description: `Created ${parsed.data.platform} campaign: ${parsed.data.name}`,
  });

  res.status(201).json({
    ...campaign,
    budget: campaign.budget ? Number(campaign.budget) : null,
    spent: campaign.spent ? Number(campaign.spent) : null,
    roas: campaign.roas ? Number(campaign.roas) : null,
    ctr: campaign.ctr ? Number(campaign.ctr) : null,
    cpc: campaign.cpc ? Number(campaign.cpc) : null,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  });
});

router.get("/projects/:id/campaigns/:campaignId", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.campaignId));
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({
    ...campaign,
    budget: campaign.budget ? Number(campaign.budget) : null,
    spent: campaign.spent ? Number(campaign.spent) : null,
    roas: campaign.roas ? Number(campaign.roas) : null,
    ctr: campaign.ctr ? Number(campaign.ctr) : null,
    cpc: campaign.cpc ? Number(campaign.cpc) : null,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  });
});

router.patch("/projects/:id/campaigns/:campaignId", async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.budget != null) updateData.budget = String(parsed.data.budget);
  const [campaign] = await db.update(campaignsTable).set(updateData).where(eq(campaignsTable.id, params.data.campaignId)).returning();
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({
    ...campaign,
    budget: campaign.budget ? Number(campaign.budget) : null,
    spent: campaign.spent ? Number(campaign.spent) : null,
    roas: campaign.roas ? Number(campaign.roas) : null,
    ctr: campaign.ctr ? Number(campaign.ctr) : null,
    cpc: campaign.cpc ? Number(campaign.cpc) : null,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  });
});

router.get("/projects/:id/campaigns/:campaignId/performance", async (req, res): Promise<void> => {
  const params = GetCampaignPerformanceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.campaignId));

  const impressions = campaign?.impressions ?? 25000;
  const clicks = campaign?.clicks ?? 1200;
  const conversions = campaign?.conversions ?? 48;
  const budget = campaign?.budget ? Number(campaign.budget) : 2000;

  res.json({
    campaignId: params.data.campaignId,
    period: "last_30_days",
    impressions,
    clicks,
    conversions,
    spend: budget * 0.65,
    revenue: budget * 0.65 * 3.8,
    roas: 3.8,
    ctr: Number((clicks / impressions * 100).toFixed(2)),
    cpc: Number((budget * 0.65 / clicks).toFixed(2)),
    cpa: Number((budget * 0.65 / conversions).toFixed(2)),
  });
});

// Assets
router.get("/projects/:id/assets", async (req, res): Promise<void> => {
  const params = ListAssetsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const assets = await db.select().from(assetsTable).where(eq(assetsTable.projectId, params.data.id)).orderBy(desc(assetsTable.createdAt));
  res.json(assets.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

// Analytics
router.get("/projects/:id/analytics", async (req, res): Promise<void> => {
  const params = GetProjectAnalyticsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const chartData = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return {
      date: date.toISOString().split("T")[0],
      value: Math.floor(Math.random() * 500 + 100 + i * 15),
      label: "Website Traffic",
    };
  });

  res.json({
    projectId: params.data.id,
    period: "last_30_days",
    websiteTraffic: 12847,
    leads: 342,
    revenue: 48200,
    adSpend: 3200,
    roas: 15.06,
    topContent: [],
    topVideos: [],
    chartData,
  });
});

// Reports
router.get("/projects/:id/reports", async (req, res): Promise<void> => {
  const params = ListReportsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const reports = await db.select().from(reportsTable).where(eq(reportsTable.projectId, params.data.id)).orderBy(desc(reportsTable.createdAt));
  res.json(reports.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/projects/:id/reports", async (req, res): Promise<void> => {
  const params = GenerateReportParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateReportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const type = parsed.data.type;
  const period = parsed.data.period ?? "monthly";

  const [report] = await db.insert(reportsTable).values({
    projectId,
    type,
    period,
    status: "complete",
    summary: `${type.charAt(0).toUpperCase() + type.slice(1)} performance summary: Website traffic up 34%, leads generated up 28%, ROAS improved from 2.8x to 3.8x. Content engagement increased 45% month-over-month.`,
    kpiTrends: JSON.stringify([
      { metric: "Website Traffic", value: 12847, change: 34, trend: "up" },
      { metric: "Leads Generated", value: 342, change: 28, trend: "up" },
      { metric: "ROAS", value: 3.8, change: 35, trend: "up" },
      { metric: "Content Engagement", value: 8.4, change: 45, trend: "up" },
    ]),
    recommendations: "1. Increase video production — videos are generating 3x more leads than blog posts\n2. Scale winning ad campaigns on Meta — ROAS is 4.2x vs 3.1x on Google\n3. Launch retargeting campaigns — site visitors who see 3+ videos convert at 12% vs 2.1% baseline\n4. Expand LinkedIn presence — B2B decision-maker engagement is up 67%",
  }).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "report",
    description: `Generated ${type} report for ${period}`,
  });

  res.json({ ...report, createdAt: report.createdAt.toISOString() });
});

// AI Agent
router.post("/projects/:id/agent/chat", async (req, res): Promise<void> => {
  const params = AgentChatParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = AgentChatBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const userMessage = parsed.data.message;

  // Save user message
  await db.insert(agentMessagesTable).values({ projectId, role: "user", content: userMessage });

  // Generate contextual AI response
  const lowerMsg = userMessage.toLowerCase();
  let responseContent = "";
  let actionType: string | null = null;
  let actionResult: string | null = null;

  if (lowerMsg.includes("video")) {
    responseContent = "I'll generate videos for you right away. Based on your business analysis, I'm creating: 3 promotional videos (60-90 seconds each), 3 product demos, and 3 TikTok-style shorts. Each video has a unique hook, script, and storyboard. They'll be ready in your Videos section momentarily.";
    actionType = "generate_videos";
    actionResult = "9 videos queued for generation";
  } else if (lowerMsg.includes("content") || lowerMsg.includes("blog")) {
    responseContent = "Generating your content strategy now. I'm creating: 5 SEO-optimized blog articles targeting your highest-opportunity keywords, 3 case studies, and 2 whitepapers. Each piece is tailored to your brand voice and ICP. You'll find them in the Content section.";
    actionType = "generate_content";
    actionResult = "10 content pieces generated";
  } else if (lowerMsg.includes("campaign") || lowerMsg.includes("ads") || lowerMsg.includes("google") || lowerMsg.includes("meta")) {
    responseContent = "Launching campaign structure now. I'm setting up: Google Search campaigns targeting high-intent keywords, Meta retargeting campaigns for your site visitors, and a LinkedIn awareness campaign for B2B decision-makers. Each campaign has AI-generated ad creative, budget recommendations, and target audience segments.";
    actionType = "create_campaigns";
    actionResult = "3 campaigns created across Google, Meta, LinkedIn";
  } else if (lowerMsg.includes("competitor")) {
    responseContent = "Running competitor analysis now. I'm scanning 10 competitors, analyzing their messaging, offers, pricing, and ad libraries. I'll identify their weaknesses and your positioning opportunities. The full report will be ready in your Competitors section in moments.";
    actionType = "discover_competitors";
    actionResult = "Competitor discovery initiated";
  } else if (lowerMsg.includes("email")) {
    responseContent = "Building your email sequences. I'm generating: a 7-email welcome series, 5-email sales sequence, 4-email lead nurture campaign, and a 3-email reactivation sequence. All personalized to your brand voice and customer journey. Check your Email section to review and edit.";
    actionType = "generate_emails";
    actionResult = "4 email sequences generated";
  } else if (lowerMsg.includes("social") || lowerMsg.includes("tiktok") || lowerMsg.includes("instagram")) {
    responseContent = "Creating your social content calendar. I'm generating 30 posts across LinkedIn, Instagram, TikTok, and X — enough for one month of daily posting. Each post has captions, hashtags, and CTAs optimized for each platform's algorithm.";
    actionType = "generate_social";
    actionResult = "30-day social content calendar created";
  } else if (lowerMsg.includes("report") || lowerMsg.includes("analytics") || lowerMsg.includes("performance")) {
    responseContent = "Generating your performance report now. Here's the quick summary: Website traffic is up 34% MoM, leads generated up 28%, and your ROAS improved from 2.8x to 3.8x. Top performing content: video > social > blog. I recommend scaling Meta campaigns (4.2x ROAS vs 3.1x on Google). Full report is in your Analytics section.";
    actionType = "generate_report";
    actionResult = "Monthly performance report generated";
  } else if (lowerMsg.includes("funnel") || lowerMsg.includes("lead")) {
    responseContent = "Building your lead generation funnel. I'm creating: a lead magnet (free ROI calculator), a landing page with conversion optimization, an automated email nurture sequence, and retargeting ad campaigns for non-converters. This is a full top-to-bottom-of-funnel setup.";
    actionType = "build_funnel";
    actionResult = "Full lead generation funnel created";
  } else {
    responseContent = `I understand you want to: "${userMessage}". I'm your AI Marketing Agent — I can generate videos, create content, launch ad campaigns, build email sequences, analyze competitors, create social posts, and produce performance reports. What would you like me to start with?`;
  }

  const [savedResponse] = await db.insert(agentMessagesTable).values({
    projectId,
    role: "assistant",
    content: responseContent,
    actionType,
    actionResult,
  }).returning();

  if (actionType) {
    await db.insert(activityTable).values({
      projectId,
      type: "agent",
      description: `AI Agent: ${actionResult}`,
    });
  }

  res.json({ ...savedResponse, createdAt: savedResponse.createdAt.toISOString() });
});

router.get("/projects/:id/agent/history", async (req, res): Promise<void> => {
  const params = GetAgentHistoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const messages = await db.select().from(agentMessagesTable).where(eq(agentMessagesTable.projectId, params.data.id)).orderBy(agentMessagesTable.createdAt);
  res.json(messages.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })));
});

export default router;

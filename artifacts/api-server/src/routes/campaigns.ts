import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { campaignsTable, assetsTable, reportsTable, agentMessagesTable, activityTable, competitorsTable, socialPostsTable, emailCampaignsTable, adCreativesTable, videosTable } from "@workspace/db";
import { consumeTrialQuota, TRIAL_MAX_VIDEO_BATCH, type TrialFeature } from "../lib/trialLimits.js";
import { generateJson } from "../lib/aiJson.js";
import { getGroundingContext, renderGroundingBlock, type GroundingContext } from "../lib/projectContext.js";
import {
  generateSocialPosts,
  generateEmailCampaign,
  generateVideoBlueprints,
  generateAdCreatives,
  generateCompetitors,
} from "../lib/contentGenerators.js";
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

  // kpiTrends stay algorithmically generated — there's no real ad platform/analytics
  // integration wired up, so these numbers can't be "real". The summary and
  // recommendations, however, are grounded in the project's actual business context
  // so they read as specific advice for this business rather than generic boilerplate.
  const kpiTrends = [
    { metric: "Website Traffic", value: 12847, change: 34, trend: "up" as const },
    { metric: "Leads Generated", value: 342, change: 28, trend: "up" as const },
    { metric: "ROAS", value: 3.8, change: 35, trend: "up" as const },
    { metric: "Content Engagement", value: 8.4, change: 45, trend: "up" as const },
  ];

  const ctx = await getGroundingContext(projectId);
  let summary = `${type.charAt(0).toUpperCase() + type.slice(1)} performance summary: Website traffic up 34%, leads generated up 28%, ROAS improved from 2.8x to 3.8x. Content engagement increased 45% month-over-month.`;
  let recommendations = "1. Increase video production\n2. Scale winning ad campaigns\n3. Launch retargeting campaigns\n4. Expand your best-performing channel";

  if (ctx) {
    try {
      const insights = await generateJson<{ summary: string; recommendations: string }>({
        system:
          "You are a marketing performance analyst. Write a report summary and recommendations that are " +
          "specific to the business described, referencing its real products/audience/positioning — not " +
          "generic marketing platitudes. Respond with ONLY a single JSON object, no prose.",
        prompt: `${renderGroundingBlock(ctx)}

This is a ${type} performance report for the ${period} period. Assume the underlying metrics show healthy
growth (traffic, leads, and ROAS trending up, content engagement rising) — you are not being given exact
numbers, so speak in terms of what to prioritize next given who this business serves and how it's positioned.
Return JSON:
{
  "summary": "2-4 sentence narrative summary of performance, grounded in this business's context",
  "recommendations": "3-5 numbered, specific, actionable recommendations tailored to this business's audience, products, and positioning"
}`,
      });
      summary = insights.summary;
      recommendations = insights.recommendations;
    } catch (err) {
      req.log.error({ err }, "Report insight generation failed, using fallback copy");
    }
  }

  const [report] = await db.insert(reportsTable).values({
    projectId,
    type,
    period,
    status: "complete",
    summary,
    kpiTrends: JSON.stringify(kpiTrends),
    recommendations,
  }).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "report",
    description: `Generated ${type} report for ${period}`,
  });

  res.json({ ...report, createdAt: report.createdAt.toISOString() });
});

// AI Agent
type AgentActionIntent = "competitors" | "social_posts" | "emails" | "videos" | "ads";
type AgentIntent = "chat" | AgentActionIntent;

const ACTION_FEATURES: Record<AgentActionIntent, TrialFeature> = {
  competitors: "competitors",
  social_posts: "social_posts",
  emails: "email_campaigns",
  videos: "video_blueprints",
  ads: "ads",
};

interface AgentClassification {
  intent: AgentIntent;
  responseMessage: string;
  quotaAmount: number;
  socialParams?: { platforms: string[]; perPlatform: number };
  emailParams?: { type: string };
  videoParams?: { count: number; type?: string };
  adParams?: { platform: string; count: number };
}

async function classifyAgentIntent(
  userMessage: string,
  ctx: GroundingContext | null,
  history: (typeof agentMessagesTable.$inferSelect)[],
  req: import("express").Request,
): Promise<AgentClassification> {
  const historyBlock = history
    .slice(0, -1)
    .map(m => `${m.role}: ${m.content}`)
    .join("\n") || "(no prior messages)";

  const contextBlock = ctx
    ? renderGroundingBlock(ctx)
    : "No business analysis has been run yet for this project — you do not have business context.";

  try {
    const result = await generateJson<AgentClassification>({
      system:
        "You are Forge, the AI marketing assistant inside GrowthForge AI, a marketing OS that turns a business " +
        "website into a full AI marketing department. You chat naturally with the user AND can trigger content " +
        "generation actions. Classify the user's latest message into exactly one intent and respond as Forge " +
        "would — friendly, concise, action-oriented. If the message is casual conversation, a question, or " +
        "doesn't clearly request one of the actions below, use intent 'chat' and just answer/chat normally. " +
        "Respond with ONLY a single JSON object, no prose.",
      prompt: `Business context:
${contextBlock}

Recent conversation:
${historyBlock}

Latest user message: "${userMessage}"

Available actions (only choose one of these if the user is clearly asking for it, otherwise use "chat"):
- "competitors": discover/analyze competitors
- "social_posts": write social media post(s) — infer platforms (linkedin/instagram/tiktok/x/facebook, default linkedin if unspecified) and how many per platform (default 2, cap 10)
- "emails": write an email campaign — infer type (welcome/sales/nurture/reactivation, default welcome)
- "videos": write video blueprint(s)/script(s) — infer count (default 3, cap 9) and type (promo/product/social, optional)
- "ads": write ad creative(s) — infer platform (Meta/Google/LinkedIn/TikTok, default Meta) and count (default 3, cap 6)

Return JSON:
{
  "intent": "chat" | "competitors" | "social_posts" | "emails" | "videos" | "ads",
  "responseMessage": "Forge's reply to the user. If intent is an action, WRITE THIS AS IF THE ACTION ALREADY SUCCEEDED (e.g. 'Done! I've written 6 LinkedIn posts...') — describe what was created and where to find it in the app (Social Media Hub / Email Marketing / Video Studio / Competitor Intelligence / Ad Creative Engine). If intent is 'chat', just write Forge's natural reply.",
  "quotaAmount": integer (only meaningful if intent is an action: for social_posts this is platforms.length * perPlatform total posts; for competitors/emails/videos/ads this is 1),
  "socialParams": { "platforms": ["linkedin"], "perPlatform": 2 },
  "emailParams": { "type": "welcome" },
  "videoParams": { "count": 3, "type": null },
  "adParams": { "platform": "Meta", "count": 3 }
}
Only include the params object relevant to the chosen intent; you may omit or null the others.`,
    });
    return result;
  } catch (err) {
    req.log.error({ err }, "Agent intent classification failed");
    return {
      intent: "chat",
      responseMessage: "I had trouble processing that — could you try rephrasing?",
      quotaAmount: 1,
    };
  }
}

async function performAgentAction(
  classification: AgentClassification,
  ctx: GroundingContext,
  projectId: number,
  req: import("express").Request,
): Promise<{ actionType: string; actionResult: string }> {
  switch (classification.intent) {
    case "competitors": {
      const results = await generateCompetitors(ctx);
      const inserted = await db.insert(competitorsTable).values(results.map(c => ({ ...c, projectId }))).returning();
      await db.insert(activityTable).values({ projectId, type: "competitors", description: `Forge discovered ${inserted.length} competitors in your market` });
      return { actionType: "discover_competitors", actionResult: `${inserted.length} competitors saved to Competitor Intelligence` };
    }
    case "social_posts": {
      const platforms = classification.socialParams?.platforms?.length ? classification.socialParams.platforms : ["linkedin"];
      const perPlatform = Math.min(classification.socialParams?.perPlatform ?? 2, 10);
      const results = await generateSocialPosts(ctx, { platforms, perPlatform });
      const inserted = await db.insert(socialPostsTable).values(
        results.map(p => ({ projectId, status: "draft" as const, platform: p.platform, caption: p.caption, hashtags: p.hashtags, cta: p.cta })),
      ).returning();
      await db.insert(activityTable).values({ projectId, type: "social", description: `Forge created ${inserted.length} social posts` });
      return { actionType: "generate_social", actionResult: `${inserted.length} posts saved to Social Media Hub` };
    }
    case "emails": {
      const type = classification.emailParams?.type ?? "welcome";
      const result = await generateEmailCampaign(ctx, { type });
      const [inserted] = await db.insert(emailCampaignsTable).values({
        projectId,
        type,
        status: "draft",
        openRate: String((Math.random() * 20 + 20).toFixed(1)),
        clickRate: String((Math.random() * 8 + 3).toFixed(1)),
        ...result,
      }).returning();
      await db.insert(activityTable).values({ projectId, type: "email", description: `Forge generated a ${type} email campaign` });
      return { actionType: "generate_emails", actionResult: `Email campaign saved to Email Marketing (id ${inserted.id})` };
    }
    case "videos": {
      const requested = Math.min(classification.videoParams?.count ?? 3, 9);
      const count = ctx.project.plan === "trial" ? Math.min(requested, TRIAL_MAX_VIDEO_BATCH) : requested;
      const results = await generateVideoBlueprints(ctx, { count, type: classification.videoParams?.type ?? undefined });
      const inserted = await db.insert(videosTable).values(results.map(t => ({ ...t, projectId, status: "complete" as const }))).returning();
      await db.insert(activityTable).values({ projectId, type: "videos", description: `Forge generated ${inserted.length} marketing videos` });
      return { actionType: "generate_videos", actionResult: `${inserted.length} videos saved to Video Studio` };
    }
    case "ads": {
      const platform = classification.adParams?.platform ?? "Meta";
      const count = Math.min(classification.adParams?.count ?? 3, 6);
      const results = await generateAdCreatives(ctx, { platform, count });
      const inserted = await db.insert(adCreativesTable).values(results.map(a => ({ ...a, projectId, platform, status: "active" as const }))).returning();
      await db.insert(activityTable).values({ projectId, type: "ads", description: `Forge built ${inserted.length} ${platform} ad creatives` });
      return { actionType: "create_campaign", actionResult: `${inserted.length} ${platform} ads saved to Ad Creative Engine` };
    }
    default:
      throw new Error(`performAgentAction called with non-action intent: ${classification.intent}`);
  }
}

router.post("/projects/:id/agent/chat", async (req, res): Promise<void> => {
  const params = AgentChatParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = AgentChatBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const userMessage = parsed.data.message;

  const quota = await consumeTrialQuota(projectId, "agent_messages", 1);
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  await db.insert(agentMessagesTable).values({ projectId, role: "user", content: userMessage });

  const ctx = await getGroundingContext(projectId);
  const history = await db
    .select()
    .from(agentMessagesTable)
    .where(eq(agentMessagesTable.projectId, projectId))
    .orderBy(desc(agentMessagesTable.createdAt))
    .limit(10);

  let responseContent = "";
  let actionType: string | null = null;
  let actionResult: string | null = null;

  const classification = await classifyAgentIntent(userMessage, ctx, history.reverse(), req);

  if (classification.intent !== "chat" && !ctx) {
    responseContent = "I'd love to build that, but I need to understand your business first. Run a business analysis (paste your website URL in onboarding or project setup) and I'll be able to generate content grounded in your real products, audience, and positioning.";
  } else if (classification.intent === "chat") {
    responseContent = classification.responseMessage;
  } else {
    // Every action intent consumes its own feature quota on top of the flat agent_messages
    // cap, closing off unlimited generation via chat once the message cap alone is spent.
    const feature = ACTION_FEATURES[classification.intent];
    const actionQuota = await consumeTrialQuota(projectId, feature, classification.quotaAmount);
    if (!actionQuota.allowed) {
      responseContent = `I can do that, but ${actionQuota.message}`;
    } else {
      try {
        const outcome = await performAgentAction(classification, ctx as GroundingContext, projectId, req);
        actionType = outcome.actionType;
        actionResult = outcome.actionResult;
        responseContent = classification.responseMessage;
      } catch (err) {
        req.log.error({ err }, "Agent action generation failed");
        responseContent = "I ran into an issue generating that just now — mind trying again in a moment?";
      }
    }
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
      description: `Forge: ${actionResult}`,
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

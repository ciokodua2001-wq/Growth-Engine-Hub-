import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { campaignsTable, assetsTable, reportsTable, agentMessagesTable, activityTable, competitorsTable, socialPostsTable, emailCampaignsTable, adCreativesTable, videosTable } from "@workspace/db";
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

  await db.insert(agentMessagesTable).values({ projectId, role: "user", content: userMessage });

  const lowerMsg = userMessage.toLowerCase();
  let responseContent = "";
  let actionType: string | null = null;
  let actionResult: string | null = null;

  if (lowerMsg.includes("competitor") || (lowerMsg.includes("analyz") && !lowerMsg.includes("website"))) {
    const competitorTemplates = [
      { name: "HubSpot Marketing", websiteUrl: "https://hubspot.com", industry: "Marketing Software", description: "All-in-one marketing platform for inbound marketing, sales, and service.", strengths: "Massive brand recognition, deep CRM integration, extensive marketplace", weaknesses: "High cost, complex setup, not AI-native", marketGaps: "AI-first workflows, video generation, competitor intelligence", pricingInsights: "Starts at $800/month", messagingInsights: "Inbound methodology, growth flywheel", hookStrength: 72, conversionPotential: 68, differentiationScore: 45 },
      { name: "Jasper AI", websiteUrl: "https://jasper.ai", industry: "AI Content", description: "AI writing assistant for marketing teams.", strengths: "Strong brand in AI writing, good integrations", weaknesses: "Content-only, no video, no campaign management", marketGaps: "Full marketing OS, video production, ad buying", pricingInsights: "$49-$125/month per seat", messagingInsights: "Creator-focused, brand voice customization", hookStrength: 65, conversionPotential: 58, differentiationScore: 62 },
      { name: "Lately AI", websiteUrl: "https://lately.ai", industry: "Social Media AI", description: "AI-powered social media content generation.", strengths: "Good social automation, analytics", weaknesses: "Limited to social, no ad creation, no video", marketGaps: "Full funnel, email, competitor analysis", pricingInsights: "$49-$199/month", messagingInsights: "Repurposing long-form content", hookStrength: 58, conversionPotential: 52, differentiationScore: 70 },
      { name: "Copy.ai", websiteUrl: "https://copy.ai", industry: "AI Copywriting", description: "AI platform for marketing copy and workflows.", strengths: "Good UX, workflow automation, broad templates", weaknesses: "No video, no ad buying, limited strategy", marketGaps: "Video production, campaign management, business intelligence", pricingInsights: "$36-$186/month", messagingInsights: "Workflow-first, team collaboration", hookStrength: 60, conversionPotential: 55, differentiationScore: 65 },
      { name: "Semrush", websiteUrl: "https://semrush.com", industry: "SEO & Marketing", description: "All-in-one digital marketing toolkit.", strengths: "Dominant in SEO data, huge feature set", weaknesses: "Not AI-native, expensive, no video", marketGaps: "AI content generation, video, autonomous campaigns", pricingInsights: "$120-$450/month", messagingInsights: "Data-driven marketing, competitive intelligence", hookStrength: 78, conversionPotential: 70, differentiationScore: 40 },
    ];
    await db.insert(competitorsTable).values(competitorTemplates.map(c => ({ ...c, projectId }))).returning();
    await db.insert(activityTable).values({ projectId, type: "competitors", description: "Forge discovered 5 competitors in your market" });
    actionType = "discover_competitors";
    actionResult = "5 competitors saved to Competitor Intelligence";
    responseContent = "Done! I've analyzed your competitive landscape and discovered 5 key competitors: HubSpot, Jasper AI, Lately, Copy.ai, and Semrush.\n\nFor each competitor I've mapped:\n- Messaging strategy & hooks\n- Pricing insights\n- Core weaknesses you can exploit\n- Market gaps you can own\n\nYour biggest opportunity: none of them offer a fully autonomous AI marketing OS. That's your wedge. Head to your Competitor Intelligence section to review everything.";
  } else if (lowerMsg.includes("linkedin") || lowerMsg.includes("post") || (lowerMsg.includes("social") && !lowerMsg.includes("sequence"))) {
    const platform = lowerMsg.includes("instagram") ? "Instagram" : lowerMsg.includes("tiktok") ? "TikTok" : lowerMsg.includes("twitter") || lowerMsg.includes(" x ") ? "X" : "LinkedIn";
    const countMatch = lowerMsg.match(/(\d+)/);
    const actualCount = countMatch ? Math.min(parseInt(countMatch[1]), 30) : 10;
    const linkedinTemplates = [
      { caption: "Most businesses spend 80% of their marketing budget on agency fees. We built an AI that replaces all of that for a fraction of the cost. Paste your URL. Get your marketing department.", hashtags: "#AI #Marketing #Growth #StartUp #SaaS", cta: "Try it free — link in bio" },
      { caption: "We analyzed 1,000 competitor websites so you don't have to. Our AI identifies market gaps, competitor weaknesses, and your best positioning opportunities in minutes.", hashtags: "#CompetitorAnalysis #MarketingStrategy #AI #GrowthHacking", cta: "Get your competitor report free" },
      { caption: "Hot take: In 2 years, 80% of SMBs won't have a marketing team. They'll have an AI platform that does it all — content, videos, ads, strategy, analytics — automatically.", hashtags: "#AIMarketing #FutureOfWork #SaaS #Entrepreneurship", cta: "See what's possible" },
      { caption: "Here's what our AI does in the time it takes to drink your morning coffee:\n\n- Analyzes your website\n- Maps 10 competitors\n- Generates a marketing strategy\n- Creates 30 days of content\n- Writes 9 video scripts\n- Builds email sequences\n\nAll from one URL.", hashtags: "#AI #MarketingAutomation #GrowthHacking #Productivity", cta: "Start your free analysis" },
      { caption: "The ROI of AI marketing:\n\n$299/month for our platform vs. $8,000+/month for an agency.\n\nWe're not just cheaper — we're faster, always on, and never miss a deadline.", hashtags: "#ROI #MarketingBudget #AITools #StartupGrowth", cta: "Calculate your savings" },
      { caption: "Unpopular opinion: Your marketing agency is selling you a subscription to their learning curve. AI already knows your industry, your competitors, and your customers.", hashtags: "#MarketingAgency #AIMarketing #DigitalMarketing", cta: "See the alternative" },
      { caption: "Our AI generated 9 marketing videos for a SaaS company in 12 minutes. Complete with hooks, full scripts, and storyboards. The same thing took their agency 3 weeks.", hashtags: "#VideoMarketing #AI #ContentCreation #MarketingTips", cta: "Generate your videos" },
      { caption: "The marketing stack killing SMBs:\n\nCanva + Mailchimp + Semrush + Hootsuite + Jasper + Agency retainer = $100K+/year.\n\nOr: One AI platform that does all of it.", hashtags: "#MarTech #MarketingStack #SaaS #CostSavings", cta: "Switch to GrowthForge AI" },
      { caption: "We gave our AI a challenge: build a complete marketing funnel from scratch in under 10 minutes.\n\nBusiness analysis, competitor report, content calendar, videos, email sequences, ad campaigns. Challenge won.", hashtags: "#AIMarketing #GrowthHacking #MarketingFunnel #Innovation", cta: "Take the challenge yourself" },
      { caption: "The best marketing hire you'll ever make doesn't take sick days, doesn't need a benefits package, and works at 3am. Meet your new AI marketing department.", hashtags: "#FutureOfWork #AIMarketing #Hiring #Automation", cta: "Try it free" },
    ];
    const toInsert = [];
    for (let i = 0; i < actualCount; i++) {
      const t = linkedinTemplates[i % linkedinTemplates.length];
      toInsert.push({ projectId, platform, status: "draft" as const, ...t });
    }
    await db.insert(socialPostsTable).values(toInsert);
    await db.insert(activityTable).values({ projectId, type: "social", description: `Forge created ${actualCount} ${platform} posts` });
    actionType = "generate_social";
    actionResult = `${actualCount} posts saved to Social Media Hub`;
    responseContent = `Done! I've written ${actualCount} ${platform} posts — enough for a full month of daily content.\n\nEach post includes:\n- Platform-optimized caption\n- Hashtag strategy\n- Clear CTA\n\nTopics covered: competitor comparison, ROI proof points, product demos, thought leadership, and social proof. Head to your Social Media Hub to review, edit, and schedule them.`;
  } else if (lowerMsg.includes("email") || lowerMsg.includes("sequence") || lowerMsg.includes("welcome")) {
    const emailType = lowerMsg.includes("sales") ? "sales" : lowerMsg.includes("nurture") ? "nurture" : "welcome";
    const welcomeTemplates = [
      { subject: "Welcome to the future of marketing", previewText: "Your AI marketing department is ready", body: "Hi,\n\nWelcome to GrowthForge AI. You've just made one of the best decisions for your business.\n\nHere's what's waiting for you right now:\n\n- Your website is being analyzed\n- Your competitor intelligence report is generating\n- Your 30-day content calendar is being built\n\nBy the time you finish this email, your AI will have done more marketing work than most agencies do in a week.\n\nLog in and see what's been created for you.\n\n[See My Marketing Dashboard]\n\nTo your growth,\nThe Forge Team", openRate: "62", clickRate: "28" },
      { subject: "Your first AI marketing win (3 steps)", previewText: "Quick wins to get you started right", body: "Hi,\n\nNow that your AI is analyzing your business, here are the 3 highest-impact things to do first:\n\n1. Review your Competitor Intelligence Report — 5 competitors mapped with weaknesses identified.\n\n2. Approve your Content Calendar — 30 days of posts ready to schedule.\n\n3. Launch your first Ad Campaign — Meta + Google campaigns built and ready to publish.\n\n[Go to Dashboard]\n\nForge", openRate: "48", clickRate: "22" },
      { subject: "Your competitors are already using AI", previewText: "Don't fall behind — here's what to do", body: "Hi,\n\n67% of your competitors are already using some form of AI in their marketing. The ones who aren't? They're losing ground every day.\n\nHere's what Forge is doing for you right now, in the background:\n\n- Monitoring competitor messaging changes\n- Identifying new content opportunities\n- Optimizing your ad performance\n- Building your authority content\n\nYou don't have to do anything. Your AI marketing department runs 24/7.\n\n[Log in to see today's activity]\n\nForge", openRate: "55", clickRate: "19" },
    ];
    const salesTemplates = [
      { subject: "Here's the ROI breakdown you asked for", previewText: "The numbers that make the decision easy", body: "Hi,\n\nYou're evaluating GrowthForge AI. Here's the honest ROI breakdown:\n\nWhat you're paying now (average customer before us):\n- Marketing agency: $5,000-$15,000/month\n- Content team: $3,000-$8,000/month\n- SEO tools: $200-$500/month\n- Design tools: $100-$300/month\nTotal: $8,300-$23,800/month\n\nGrowthForge AI: From $299/month\n\nThat's a 96% cost reduction. With better output.\n\n[Start your free trial]\n\nForge", openRate: "44", clickRate: "31" },
      { subject: "What happens if you don't start today", previewText: "The cost of waiting (it's higher than you think)", body: "Hi,\n\nEvery day you wait is a day your competitors get further ahead.\n\nHere's what they're likely doing right now:\n- Publishing 3-5 pieces of content per week\n- Running A/B tests on 4 ad variations simultaneously\n- Building retargeting audiences\n- Automating follow-up sequences for every lead\n\nYou could be doing all of this — automatically — starting today.\n\n[Start free, no credit card required]\n\nForge", openRate: "38", clickRate: "24" },
    ];
    const templates = emailType === "sales" ? salesTemplates : welcomeTemplates;
    await db.insert(emailCampaignsTable).values(templates.map(t => ({ projectId, type: emailType, ...t })));
    await db.insert(activityTable).values({ projectId, type: "email", description: `Forge generated ${templates.length}-email ${emailType} sequence` });
    actionType = "generate_emails";
    actionResult = `${templates.length}-email ${emailType} sequence saved to Email Marketing`;
    responseContent = `Done! I've written a ${templates.length}-email ${emailType} sequence optimized for your funnel stage.\n\nEach email includes:\n- High-converting subject line\n- Preview text for maximum open rates\n- Full body copy with clear CTAs\n- Predicted open rate and click-through rate\n\nThe sequence is designed to move subscribers from awareness to trust to action. Check your Email Marketing section to review and customize.`;
  } else if (lowerMsg.includes("video") || lowerMsg.includes("demo")) {
    const isDemoFocused = lowerMsg.includes("demo") || lowerMsg.includes("product");
    const videoTemplates = isDemoFocused ? [
      { title: "Product Demo — From URL to Marketing Department", type: "product" as const, script: "HOOK: Watch me turn this website URL into a full marketing department in 5 minutes.\n\nDEMO FLOW:\n1. Paste URL\n2. AI analyzes business\n3. Competitor report generated\n4. Content calendar: 30 days ready\n5. 9 videos scripted\n6. Email sequences written\n7. Ad campaigns built\n\nCTA: Your turn — try it free.", storyboard: "Screen recording: paste URL\nAI scanning animation\nDashboard populating in real time\nVideo thumbnails appearing\nEmail sequences generating\nAd creatives building\nCTA overlay", duration: 90, hookStrength: 87, engagementPotential: 85, viralPotential: 78 },
      { title: "Feature Spotlight — Competitor Intelligence", type: "product" as const, script: "HOOK: Your competitors have a marketing team. You have something better.\n\nGrowthForge finds your top competitors, analyzes their messaging, maps their weaknesses, and tells you exactly how to win against each one.\n\nAll from your URL. In minutes.\n\nCTA: Get your free competitor report.", storyboard: "Competitor logos loading\nAI scanning competitor websites\nWeaknesses highlighted in red\nMarket gaps in green\nYour positioning advantage revealed\nCTA screen", duration: 60, hookStrength: 83, engagementPotential: 80, viralPotential: 75 },
      { title: "Demo Reel — The Full Platform in 60 Seconds", type: "product" as const, script: "[0:00] Paste your URL\n[0:08] AI analyzes your business\n[0:15] Competitor report: 5 competitors mapped\n[0:22] Marketing strategy generated\n[0:30] Content calendar: 30 days ready\n[0:38] Email sequences written\n[0:45] 9 videos scripted\n[0:52] Ad campaigns built\n[0:58] You're live", storyboard: "Fast-paced screen recording\nTimestamps as text overlays\nEach section populating rapidly\nFull dashboard overview\nCTA: Start your free analysis", duration: 60, hookStrength: 91, engagementPotential: 89, viralPotential: 85 },
    ] : [
      { title: "Brand Story — Why We Built This", type: "promo" as const, script: "HOOK: Most founders spend 80% of their time on marketing, not building.\n\nPROBLEM: Traditional marketing requires a team of 5-10 people and costs $150K+ per year.\n\nSOLUTION: We built an AI that replaces that entire team.\n\nCTA: Try it free today.", storyboard: "Busy founder at laptop\nStack of agency invoices\nAI analyzing website\nDashboard filling with content\nFounder smiling, metrics rising\nCTA screen", duration: 60, hookStrength: 91, engagementPotential: 88, viralPotential: 84 },
      { title: "TikTok — Stop Paying Agency Fees", type: "social" as const, script: "POV: You just canceled your $8,000/month marketing agency.\n\nYou switched to an AI that:\n- Analyzes your competitors\n- Creates your content\n- Makes your videos\n- Runs your ads\n- Tracks your growth\n\nAll from your website URL.", storyboard: "Fast-cut TikTok style\nText overlays on dark background\nScreen recordings of dashboard\nBefore/after metrics\nStrong CTA end card", duration: 30, hookStrength: 94, engagementPotential: 92, viralPotential: 91 },
      { title: "YouTube Short — 9 Videos in One Click", type: "promo" as const, script: "What if you could generate 9 professional marketing videos in a single click?\n\n3 promotional videos. 3 product demos. 3 social shorts.\n\nAll tailored to your brand. All ready to publish.", storyboard: "9 video thumbnails populating\nEach type highlighted\nDashboard overview\nPublish button click\nCTA screen", duration: 45, hookStrength: 89, engagementPotential: 87, viralPotential: 85 },
    ];
    await db.insert(videosTable).values(videoTemplates.map(t => ({ ...t, projectId, status: "complete" as const })));
    await db.insert(activityTable).values({ projectId, type: "videos", description: `Forge generated ${videoTemplates.length} marketing videos` });
    actionType = "generate_videos";
    actionResult = `${videoTemplates.length} videos saved to Video Studio`;
    responseContent = `Done! I've created ${videoTemplates.length} ${isDemoFocused ? "product demo" : "marketing"} videos — complete scripts, storyboards, and production notes.\n\nEach video includes:\n- A high-impact hook (first 3 seconds)\n- Full script with scene breaks\n- Visual storyboard\n- Hook strength, engagement & viral potential scores\n\nPlatform versions covered: YouTube, TikTok, Instagram Reels. Head to your Video Studio to review and adapt them.`;
  } else if (lowerMsg.includes("facebook") || lowerMsg.includes("campaign") || lowerMsg.includes("ads") || lowerMsg.includes("meta") || lowerMsg.includes("google")) {
    const platform = lowerMsg.includes("google") ? "Google" : lowerMsg.includes("linkedin") ? "LinkedIn" : lowerMsg.includes("tiktok") ? "TikTok" : "Meta";
    const adTemplates = [
      { platform, type: "image" as const, headline: "Stop Paying $10K/Month for Marketing", description: "GrowthForge AI replaces your entire marketing team. One URL. Full marketing department in minutes.", cta: "Try Free for 14 Days", status: "active" as const, hookStrength: 88, conversionPotential: 82 },
      { platform, type: "video" as const, headline: "Your Competitors Are Using AI. Are You?", description: "Join 10,000+ businesses using AI to create content, run ads, and grow faster with less effort.", cta: "Start Free Analysis", status: "active" as const, hookStrength: 85, conversionPotential: 79 },
      { platform, type: "carousel" as const, headline: "One URL — Entire Marketing Department", description: "Business analysis. Competitor intelligence. Content calendar. Videos. Email sequences. Ad campaigns. All AI-generated.", cta: "See How It Works", status: "active" as const, hookStrength: 81, conversionPotential: 76 },
      { platform, type: "image" as const, headline: "From $15K/Month Agency to $299 AI", description: "Real businesses are switching and getting better results. No contracts. No setup fees. Cancel anytime.", cta: "Get Started", status: "active" as const, hookStrength: 90, conversionPotential: 85 },
    ];
    await db.insert(adCreativesTable).values(adTemplates.map(t => ({ ...t, projectId })));
    await db.insert(activityTable).values({ projectId, type: "ads", description: `Forge built 4 ${platform} ad creatives` });
    actionType = "create_campaign";
    actionResult = `4 ${platform} ads saved to Ad Creative Engine`;
    responseContent = `Done! I've built 4 high-converting ${platform} ad creatives optimized for your target audience.\n\nAd formats created:\n- 2x Image ads (direct response)\n- 1x Video ad (awareness + retargeting)\n- 1x Carousel ad (feature showcase)\n\nEach creative has a performance score for hook strength and conversion potential. I recommend starting with the image ad (90/100 conversion score) — it's your highest-probability winner.\n\nFind them in your Ad Creative Engine section.`;
  } else {
    responseContent = `Here's what I can build for you right now:\n\nIntelligence\n- "Analyze my competitors" — discover 5 competitors with full messaging analysis\n- "Run a business analysis" — extract your ICP, positioning, and market opportunities\n\nContent\n- "Create 30 LinkedIn posts" — a full month of platform-optimized posts\n- "Generate a blog strategy" — SEO-optimized articles\n\nEmail\n- "Generate a welcome sequence" — multi-email onboarding flow\n- "Build a sales email sequence" — conversion-focused nurture series\n\nVideo\n- "Create a product demo video" — full script + storyboard\n- "Generate 9 marketing videos" — full video production pack\n\nAds\n- "Build a Facebook campaign" — 4 ad creatives ready to launch\n- "Create Google ads" — search-optimized ad variations\n\nWhat should I build first?`;
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

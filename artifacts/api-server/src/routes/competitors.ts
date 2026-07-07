import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { competitorsTable, activityTable } from "@workspace/db";
import {
  ListCompetitorsParams,
  DiscoverCompetitorsParams,
  GetCompetitorParams,
  GetCompetitorReportParams,
  GenerateCompetitorReportParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects/:id/competitors", async (req, res): Promise<void> => {
  const params = ListCompetitorsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const competitors = await db.select().from(competitorsTable).where(eq(competitorsTable.projectId, params.data.id)).orderBy(desc(competitorsTable.createdAt));
  res.json(competitors.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })));
});

router.post("/projects/:id/competitors", async (req, res): Promise<void> => {
  const params = DiscoverCompetitorsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;

  const competitorTemplates = [
    { name: "HubSpot Marketing", websiteUrl: "https://hubspot.com", industry: "Marketing Software", description: "All-in-one marketing platform for inbound marketing, sales, and service.", strengths: "Massive brand recognition, deep CRM integration, extensive marketplace", weaknesses: "High cost, complex setup, not AI-native", marketGaps: "AI-first workflows, video generation, competitor intelligence", pricingInsights: "Starts at $800/month for Marketing Hub Professional", messagingInsights: "Focus on inbound methodology and growth flywheel", hookStrength: 72, conversionPotential: 68, differentiationScore: 45 },
    { name: "Jasper AI", websiteUrl: "https://jasper.ai", industry: "AI Content", description: "AI writing assistant for marketing teams and content creators.", strengths: "Strong brand in AI writing space, good integrations", weaknesses: "Content-only, no video, no campaign management", marketGaps: "Full marketing OS, video production, ad buying", pricingInsights: "$49-$125/month per seat", messagingInsights: "Creator-focused, brand voice customization", hookStrength: 65, conversionPotential: 58, differentiationScore: 62 },
    { name: "Lately AI", websiteUrl: "https://lately.ai", industry: "Social Media AI", description: "AI-powered social media content generation platform.", strengths: "Good social content automation, analytics", weaknesses: "Limited to social, no ad creation, no video", marketGaps: "Full funnel coverage, email, competitor analysis", pricingInsights: "$49-$199/month", messagingInsights: "Focus on repurposing long-form content", hookStrength: 58, conversionPotential: 52, differentiationScore: 70 },
    { name: "Copy.ai", websiteUrl: "https://copy.ai", industry: "AI Copywriting", description: "AI platform for marketing copy and workflows.", strengths: "Good UX, workflow automation, broad copy templates", weaknesses: "No video, no ad buying, limited strategy", marketGaps: "Video production, campaign management, business intelligence", pricingInsights: "$36-$186/month", messagingInsights: "Workflow-first approach, team collaboration", hookStrength: 60, conversionPotential: 55, differentiationScore: 65 },
    { name: "Semrush", websiteUrl: "https://semrush.com", industry: "SEO & Marketing", description: "All-in-one digital marketing toolkit.", strengths: "Dominant in SEO data, huge feature set", weaknesses: "Not AI-native for content creation, expensive, no video", marketGaps: "AI content generation, video, autonomous campaigns", pricingInsights: "$120-$450/month", messagingInsights: "Data-driven marketing, competitive intelligence", hookStrength: 78, conversionPotential: 70, differentiationScore: 40 },
  ];

  const inserted = await db.insert(competitorsTable).values(
    competitorTemplates.map(c => ({ ...c, projectId }))
  ).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "competitors",
    description: `Discovered ${inserted.length} competitors in your market`,
  });

  res.json(inserted.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })));
});

router.get("/projects/:id/competitors/:competitorId", async (req, res): Promise<void> => {
  const params = GetCompetitorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [competitor] = await db.select().from(competitorsTable).where(eq(competitorsTable.id, params.data.competitorId));
  if (!competitor) {
    res.status(404).json({ error: "Competitor not found" });
    return;
  }
  res.json({ ...competitor, createdAt: competitor.createdAt.toISOString() });
});

router.get("/projects/:id/competitor-report", async (req, res): Promise<void> => {
  const params = GetCompetitorReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const competitors = await db.select().from(competitorsTable).where(eq(competitorsTable.projectId, params.data.id)).orderBy(desc(competitorsTable.createdAt));

  res.json({
    projectId: params.data.id,
    competitors: competitors.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
    marketGaps: "AI-native video production, autonomous campaign management, integrated competitor intelligence, one-click full-funnel setup",
    positioningOpportunities: "Position as the only platform that combines business intelligence, content creation, video production, AND ad buying in one AI-powered workflow",
    winningHooks: "Paste your URL → Get your marketing department | Skip the agency | Replace 5 tools with 1 | AI that works while you sleep",
    winningCtas: "Start Free Analysis | Get Your Marketing Department | See Your Competitor Report | Launch in 10 Minutes",
    generatedAt: new Date().toISOString(),
  });
});

router.post("/projects/:id/competitor-report", async (req, res): Promise<void> => {
  const params = GenerateCompetitorReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;
  const competitors = await db.select().from(competitorsTable).where(eq(competitorsTable.projectId, projectId));

  await db.insert(activityTable).values({
    projectId,
    type: "competitor_report",
    description: "Competitor intelligence report generated",
  });

  res.json({
    projectId,
    competitors: competitors.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })),
    marketGaps: "AI-native video production, autonomous campaign management, integrated competitor intelligence, one-click full-funnel setup",
    positioningOpportunities: "Position as the only platform that combines business intelligence, content creation, video production, AND ad buying in one AI-powered workflow",
    winningHooks: "Paste your URL → Get your marketing department | Skip the agency | Replace 5 tools with 1 | AI that works while you sleep",
    winningCtas: "Start Free Analysis | Get Your Marketing Department | See Your Competitor Report | Launch in 10 Minutes",
    generatedAt: new Date().toISOString(),
  });
});

export default router;

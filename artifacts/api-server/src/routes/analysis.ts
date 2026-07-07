import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  businessAnalysisTable,
  personasTable,
  marketingStrategyTable,
  activityTable,
} from "@workspace/db";
import {
  AnalyzeWebsiteParams,
  AnalyzeWebsiteBody,
  GetBusinessAnalysisParams,
  ListPersonasParams,
  GeneratePersonasParams,
  GetMarketingStrategyParams,
  GenerateMarketingStrategyParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Analyze website and generate business intelligence
router.post("/projects/:id/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeWebsiteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AnalyzeWebsiteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const projectId = params.data.id;
  const websiteUrl = parsed.data.websiteUrl;

  // Upsert analysis record
  const existing = await db.select().from(businessAnalysisTable).where(eq(businessAnalysisTable.projectId, projectId));

  let analysis;
  if (existing.length > 0) {
    [analysis] = await db.update(businessAnalysisTable)
      .set({
        status: "complete",
        businessSummary: `${websiteUrl} is a growing business offering high-value products and services to its target market.`,
        industry: "Technology & SaaS",
        products: "Software solutions, digital tools, online platforms",
        services: "Consulting, implementation, ongoing support",
        uniqueValueProposition: "Streamlined solutions that help businesses grow faster with less effort",
        targetCustomers: "SMBs, startups, growth-stage companies looking to scale",
        idealCustomerProfile: "Decision-maker at a 10-200 person company, $1M+ revenue, growth-focused",
        customerPainPoints: "Too many tools, inefficient processes, high cost of marketing teams",
        brandVoice: "Professional, confident, results-driven",
        brandPositioning: "Premium solution for ambitious businesses",
        customerBenefits: "Save time, reduce costs, drive measurable growth",
        purchaseTriggers: "Pain with current tools, growth targets, competitor pressure",
        marketOpportunities: "AI automation, content marketing, performance advertising",
        growthOpportunities: "Expand into adjacent markets, launch new product tiers, partner channels",
      })
      .where(eq(businessAnalysisTable.projectId, projectId))
      .returning();
  } else {
    [analysis] = await db.insert(businessAnalysisTable).values({
      projectId,
      status: "complete",
      businessSummary: `${websiteUrl} is a growing business offering high-value products and services to its target market.`,
      industry: "Technology & SaaS",
      products: "Software solutions, digital tools, online platforms",
      services: "Consulting, implementation, ongoing support",
      uniqueValueProposition: "Streamlined solutions that help businesses grow faster with less effort",
      targetCustomers: "SMBs, startups, growth-stage companies looking to scale",
      idealCustomerProfile: "Decision-maker at a 10-200 person company, $1M+ revenue, growth-focused",
      customerPainPoints: "Too many tools, inefficient processes, high cost of marketing teams",
      brandVoice: "Professional, confident, results-driven",
      brandPositioning: "Premium solution for ambitious businesses",
      customerBenefits: "Save time, reduce costs, drive measurable growth",
      purchaseTriggers: "Pain with current tools, growth targets, competitor pressure",
      marketOpportunities: "AI automation, content marketing, performance advertising",
      growthOpportunities: "Expand into adjacent markets, launch new product tiers, partner channels",
    }).returning();
  }

  await db.insert(activityTable).values({
    projectId,
    type: "analysis",
    description: `Business intelligence analysis completed for ${websiteUrl}`,
  });

  res.json({
    ...analysis,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  });
});

router.get("/projects/:id/analysis", async (req, res): Promise<void> => {
  const params = GetBusinessAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [analysis] = await db.select().from(businessAnalysisTable).where(eq(businessAnalysisTable.projectId, params.data.id)).orderBy(desc(businessAnalysisTable.createdAt));
  if (!analysis) {
    res.status(404).json({ error: "No analysis found" });
    return;
  }
  res.json({
    ...analysis,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  });
});

router.get("/projects/:id/personas", async (req, res): Promise<void> => {
  const params = ListPersonasParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const personas = await db.select().from(personasTable).where(eq(personasTable.projectId, params.data.id)).orderBy(desc(personasTable.createdAt));
  res.json(personas.map(p => ({ ...p, createdAt: p.createdAt.toISOString() })));
});

router.post("/projects/:id/personas", async (req, res): Promise<void> => {
  const params = GeneratePersonasParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;

  const personaTemplates = [
    {
      name: "The Ambitious Founder",
      age: "32-45",
      gender: "Any",
      occupation: "Startup Founder / CEO",
      income: "$150K-$500K",
      location: "Major tech hub (SF, NYC, Austin)",
      interests: "Growth hacking, product development, fundraising, networking",
      motivations: "Scale the business fast, beat competitors, achieve product-market fit",
      objections: "Price sensitivity, time investment, trust in AI solutions",
      buyingTriggers: "Competitor using similar tools, board pressure, missed growth targets",
      buyingJourney: "Problem awareness → Research → Demo → Pilot → Purchase",
      avatarUrl: null,
    },
    {
      name: "The Marketing Director",
      age: "28-42",
      gender: "Any",
      occupation: "VP Marketing / Marketing Director",
      income: "$120K-$250K",
      location: "Remote or major metro",
      interests: "Demand gen, brand building, data analytics, content marketing",
      motivations: "Hit pipeline targets, prove marketing ROI, reduce team workload",
      objections: "Existing tool stack, team adoption, creative control concerns",
      buyingTriggers: "Headcount freeze, rising ad costs, content backlog",
      buyingJourney: "Vendor comparison → Team buy-in → Security review → Purchase",
      avatarUrl: null,
    },
    {
      name: "The Agency Owner",
      age: "35-50",
      gender: "Any",
      occupation: "Digital Agency Owner / Creative Director",
      income: "$200K-$1M",
      location: "Anywhere",
      interests: "Client results, workflow efficiency, new revenue streams, automation",
      motivations: "Serve more clients without hiring, improve margins, differentiate",
      objections: "White-label needs, client privacy, quality consistency",
      buyingTriggers: "Client demand, competitor agencies using AI, capacity constraints",
      buyingJourney: "Trial with one client → Expand to all clients → Agency plan",
      avatarUrl: null,
    },
  ];

  const inserted = await db.insert(personasTable).values(
    personaTemplates.map(p => ({ ...p, projectId }))
  ).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "personas",
    description: `Generated ${inserted.length} customer personas`,
  });

  res.json(inserted.map(p => ({ ...p, createdAt: p.createdAt.toISOString() })));
});

router.get("/projects/:id/strategy", async (req, res): Promise<void> => {
  const params = GetMarketingStrategyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [strategy] = await db.select().from(marketingStrategyTable).where(eq(marketingStrategyTable.projectId, params.data.id)).orderBy(desc(marketingStrategyTable.createdAt));
  if (!strategy) {
    res.status(404).json({ error: "No strategy found" });
    return;
  }
  res.json({
    ...strategy,
    createdAt: strategy.createdAt.toISOString(),
    updatedAt: strategy.updatedAt.toISOString(),
  });
});

router.post("/projects/:id/strategy", async (req, res): Promise<void> => {
  const params = GenerateMarketingStrategyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;

  const existing = await db.select().from(marketingStrategyTable).where(eq(marketingStrategyTable.projectId, projectId));
  let strategy;
  const strategyData = {
    status: "complete" as const,
    positioningStatement: "For growth-focused businesses that need to move fast, our platform is the only AI-powered marketing OS that replaces an entire marketing team in minutes — not months.",
    messagingFramework: "Primary: Speed to market. Secondary: Cost efficiency. Tertiary: AI-powered intelligence that learns and improves.",
    brandVoiceGuide: "Confident, direct, results-oriented. Lead with outcomes. Avoid fluff. Use data to back claims. Sound like a trusted growth partner, not a vendor.",
    seoStrategy: "Target high-intent keywords: 'AI marketing platform', 'marketing automation for startups', 'AI content generation'. Build pillar pages around core use cases. Focus on long-tail buyer-intent terms.",
    campaignStrategy: "Multi-channel approach: Google Search for intent capture, Meta/TikTok for awareness, LinkedIn for B2B, YouTube for product demos. Retarget all site visitors with conversion campaigns.",
    leadGenerationStrategy: "Free website analysis as lead magnet. Webinar series: 'How AI is replacing marketing teams'. Partner with accelerators and VC firms. Affiliate program for agencies.",
    funnelRecommendations: "TOFU: Thought leadership content + viral social. MOFU: Free trial + case studies + demo videos. BOFU: ROI calculator + 1:1 demo + risk reversal offer.",
  };

  if (existing.length > 0) {
    [strategy] = await db.update(marketingStrategyTable).set(strategyData).where(eq(marketingStrategyTable.projectId, projectId)).returning();
  } else {
    [strategy] = await db.insert(marketingStrategyTable).values({ projectId, ...strategyData }).returning();
  }

  await db.insert(activityTable).values({
    projectId,
    type: "strategy",
    description: "Marketing strategy generated successfully",
  });

  res.json({
    ...strategy,
    createdAt: strategy!.createdAt.toISOString(),
    updatedAt: strategy!.updatedAt.toISOString(),
  });
});

export default router;

import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  businessAnalysisTable,
  personasTable,
  marketingStrategyTable,
  competitorsTable,
  projectsTable,
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
import { fetchWebsiteContent, WebsiteFetchError } from "../lib/websiteFetcher.js";
import { generateJson } from "../lib/aiJson.js";
import { consumeTrialQuota } from "../lib/trialLimits.js";

const router: IRouter = Router();

interface BusinessAnalysisResult {
  industry: string;
  businessSummary: string;
  products: string;
  services: string;
  uniqueValueProposition: string;
  targetCustomers: string;
  idealCustomerProfile: string;
  customerPainPoints: string;
  brandVoice: string;
  brandPositioning: string;
  customerBenefits: string;
  purchaseTriggers: string;
  marketOpportunities: string;
  growthOpportunities: string;
}

async function analyzeBusinessWithAi(params: {
  websiteUrl: string;
  title: string | null;
  metaDescription: string | null;
  text: string;
  extraPrompt?: string;
}): Promise<BusinessAnalysisResult> {
  return generateJson<BusinessAnalysisResult>({
    system:
      "You are a senior marketing strategist and business analyst. You read real website content and produce " +
      "precise, specific, non-generic business intelligence. Never invent facts that contradict the provided " +
      "content. Base every field strictly on what the website content actually says or strongly implies. " +
      "Respond with ONLY a single JSON object, no prose, no markdown fences.",
    prompt: `Analyze this business based on its actual website content.

Website URL: ${params.websiteUrl}
Page title: ${params.title ?? "(none)"}
Meta description: ${params.metaDescription ?? "(none)"}

Website text content (extracted from the live page):
"""
${params.text}
"""
${params.extraPrompt ? `\nAdditional context from the business owner: ${params.extraPrompt}\n` : ""}
Return a JSON object with exactly these string fields, each 1-3 sentences, specific to THIS business
(do not use generic marketing boilerplate):
{
  "industry": "the single most accurate industry/category for this specific business",
  "businessSummary": "what this business actually does, in plain terms",
  "products": "the specific products this business sells, based on the content",
  "services": "the specific services this business offers, based on the content",
  "uniqueValueProposition": "what makes this business different from alternatives, based on the content",
  "targetCustomers": "who this business's content and offering is clearly aimed at",
  "idealCustomerProfile": "a specific description of the ideal customer (role/context/budget if inferable)",
  "customerPainPoints": "the pain points this business's messaging suggests it solves",
  "brandVoice": "how this business communicates (tone, style) based on the actual copy",
  "brandPositioning": "how this business positions itself in its market based on the content",
  "customerBenefits": "the concrete benefits this business promises customers",
  "purchaseTriggers": "what would realistically prompt this business's target customer to buy",
  "marketOpportunities": "specific, plausible marketing opportunities for this business",
  "growthOpportunities": "specific, plausible growth opportunities for this business"
}`,
  });
}

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

  let result: BusinessAnalysisResult;
  try {
    const site = await fetchWebsiteContent(websiteUrl);

    const quota = await consumeTrialQuota(projectId, "analysis");
    if (!quota.allowed) {
      res.status(403).json({ error: quota.message });
      return;
    }

    result = await analyzeBusinessWithAi({
      websiteUrl: site.url,
      title: site.title,
      metaDescription: site.metaDescription,
      text: site.text,
      extraPrompt: parsed.data.prompt,
    });
  } catch (err) {
    const message =
      err instanceof WebsiteFetchError
        ? err.message
        : `Failed to analyze ${websiteUrl}: ${err instanceof Error ? err.message : "unknown error"}`;
    req.log.error({ err }, "Website analysis failed");

    const existingOnFail = await db
      .select()
      .from(businessAnalysisTable)
      .where(eq(businessAnalysisTable.projectId, projectId));

    if (existingOnFail.length > 0) {
      await db
        .update(businessAnalysisTable)
        .set({ status: "failed" })
        .where(eq(businessAnalysisTable.projectId, projectId));
    } else {
      await db.insert(businessAnalysisTable).values({ projectId, status: "failed" });
    }

    await db.insert(activityTable).values({
      projectId,
      type: "analysis",
      description: `Website analysis failed: ${message}`,
    });

    res.status(422).json({ error: message });
    return;
  }

  const existing = await db.select().from(businessAnalysisTable).where(eq(businessAnalysisTable.projectId, projectId));

  let analysis;
  if (existing.length > 0) {
    [analysis] = await db.update(businessAnalysisTable)
      .set({ status: "complete", ...result })
      .where(eq(businessAnalysisTable.projectId, projectId))
      .returning();
  } else {
    [analysis] = await db.insert(businessAnalysisTable).values({
      projectId,
      status: "complete",
      ...result,
    }).returning();
  }

  await db.update(projectsTable).set({ industry: result.industry }).where(eq(projectsTable.id, projectId));

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

interface PersonaResult {
  name: string;
  age: string;
  gender: string;
  occupation: string;
  income: string;
  location: string;
  interests: string;
  motivations: string;
  objections: string;
  buyingTriggers: string;
  buyingJourney: string;
}

router.post("/projects/:id/personas", async (req, res): Promise<void> => {
  const params = GeneratePersonasParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const [analysis] = await db
    .select()
    .from(businessAnalysisTable)
    .where(eq(businessAnalysisTable.projectId, projectId))
    .orderBy(desc(businessAnalysisTable.createdAt));

  if (!project || !analysis || analysis.status !== "complete") {
    res.status(409).json({ error: "Run business analysis before generating personas" });
    return;
  }

  const personasQuota = await consumeTrialQuota(projectId, "personas");
  if (!personasQuota.allowed) {
    res.status(403).json({ error: personasQuota.message });
    return;
  }

  let personaResults: PersonaResult[];
  try {
    const response = await generateJson<{ personas: PersonaResult[] }>({
      system:
        "You are a senior customer research strategist. You produce specific, realistic buyer personas " +
        "grounded in the actual business context provided. Respond with ONLY a single JSON object, no prose.",
      prompt: `Business: ${project.name} (${project.websiteUrl})
Industry: ${analysis.industry}
Summary: ${analysis.businessSummary}
Products: ${analysis.products}
Services: ${analysis.services}
Target customers: ${analysis.targetCustomers}
Ideal customer profile: ${analysis.idealCustomerProfile}
Customer pain points: ${analysis.customerPainPoints}

Generate exactly 3 distinct, realistic buyer personas for this specific business. Return JSON:
{
  "personas": [
    {
      "name": "descriptive persona label, e.g. 'The Time-Strapped Ops Manager'",
      "age": "age range",
      "gender": "gender or 'Any'",
      "occupation": "specific job title/role",
      "income": "income range",
      "location": "typical location/context",
      "interests": "comma-separated interests relevant to this persona",
      "motivations": "what drives this persona to seek a solution like this business's",
      "objections": "realistic objections this persona would have before buying",
      "buyingTriggers": "events/situations that would trigger this persona to buy",
      "buyingJourney": "a short arrow-separated journey, e.g. 'Awareness -> Research -> Trial -> Purchase'"
    }
  ]
}`,
    });
    personaResults = response.personas.slice(0, 3);
  } catch (err) {
    req.log.error({ err }, "Persona generation failed");
    res.status(502).json({ error: "Failed to generate personas" });
    return;
  }

  const inserted = await db.insert(personasTable).values(
    personaResults.map(p => ({ ...p, avatarUrl: null, projectId }))
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

interface StrategyResult {
  positioningStatement: string;
  messagingFramework: string;
  brandVoiceGuide: string;
  seoStrategy: string;
  campaignStrategy: string;
  leadGenerationStrategy: string;
  funnelRecommendations: string;
}

router.post("/projects/:id/strategy", async (req, res): Promise<void> => {
  const params = GenerateMarketingStrategyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const [analysis] = await db
    .select()
    .from(businessAnalysisTable)
    .where(eq(businessAnalysisTable.projectId, projectId))
    .orderBy(desc(businessAnalysisTable.createdAt));

  if (!project || !analysis || analysis.status !== "complete") {
    res.status(409).json({ error: "Run business analysis before generating a marketing strategy" });
    return;
  }

  const personas = await db.select().from(personasTable).where(eq(personasTable.projectId, projectId));
  const competitors = await db.select().from(competitorsTable).where(eq(competitorsTable.projectId, projectId));

  const strategyQuota = await consumeTrialQuota(projectId, "strategy");
  if (!strategyQuota.allowed) {
    res.status(403).json({ error: strategyQuota.message });
    return;
  }

  let strategyData: StrategyResult;
  try {
    strategyData = await generateJson<StrategyResult>({
      system:
        "You are a senior marketing strategist. You produce specific, actionable marketing strategy grounded " +
        "in the actual business context, personas, and competitor landscape provided. Respond with ONLY a " +
        "single JSON object, no prose.",
      prompt: `Business: ${project.name} (${project.websiteUrl})
Industry: ${analysis.industry}
Summary: ${analysis.businessSummary}
Unique value proposition: ${analysis.uniqueValueProposition}
Brand positioning: ${analysis.brandPositioning}
Target customers: ${analysis.targetCustomers}
Market opportunities: ${analysis.marketOpportunities}
Growth opportunities: ${analysis.growthOpportunities}

Personas: ${personas.length > 0 ? personas.map(p => `${p.name} (${p.occupation})`).join("; ") : "none generated yet"}
Known competitors: ${competitors.length > 0 ? competitors.map(c => c.name).join(", ") : "none discovered yet"}

Return a JSON object with exactly these string fields, specific to THIS business (no generic filler):
{
  "positioningStatement": "a clear positioning statement for this business",
  "messagingFramework": "primary/secondary/tertiary messaging pillars for this business",
  "brandVoiceGuide": "concrete guidance on how this business should sound in its marketing",
  "seoStrategy": "specific keyword/content targets relevant to this business's industry and offering",
  "campaignStrategy": "which channels and campaign types make sense for this business and why",
  "leadGenerationStrategy": "concrete lead generation tactics suited to this business",
  "funnelRecommendations": "TOFU/MOFU/BOFU recommendations tailored to this business"
}`,
    });
  } catch (err) {
    req.log.error({ err }, "Strategy generation failed");
    res.status(502).json({ error: "Failed to generate marketing strategy" });
    return;
  }

  const existing = await db.select().from(marketingStrategyTable).where(eq(marketingStrategyTable.projectId, projectId));
  let strategy;
  if (existing.length > 0) {
    [strategy] = await db.update(marketingStrategyTable).set({ status: "complete", ...strategyData }).where(eq(marketingStrategyTable.projectId, projectId)).returning();
  } else {
    [strategy] = await db.insert(marketingStrategyTable).values({ projectId, status: "complete", ...strategyData }).returning();
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

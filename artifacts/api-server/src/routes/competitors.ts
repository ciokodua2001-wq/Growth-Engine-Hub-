import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { competitorsTable, businessAnalysisTable, projectsTable, activityTable, competitorReportTable } from "@workspace/db";
import {
  ListCompetitorsParams,
  DiscoverCompetitorsParams,
  GetCompetitorParams,
  GetCompetitorReportParams,
  GenerateCompetitorReportParams,
} from "@workspace/api-zod";
import { generateJson } from "../lib/aiJson.js";
import { consumeTrialQuota } from "../lib/trialLimits.js";
import { requireProjectOwnershipParam } from "../lib/authz.js";
import { recordGeneratedBatch, recordGenerated, hashContent } from "../lib/contentIntegrity.js";

const router: IRouter = Router();

router.param("id", requireProjectOwnershipParam());

interface CompetitorResult {
  name: string;
  websiteUrl: string;
  industry: string;
  description: string;
  strengths: string;
  weaknesses: string;
  marketGaps: string;
  pricingInsights: string;
  messagingInsights: string;
  hookStrength: number;
  conversionPotential: number;
  differentiationScore: number;
}

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

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const [analysis] = await db
    .select()
    .from(businessAnalysisTable)
    .where(eq(businessAnalysisTable.projectId, projectId))
    .orderBy(desc(businessAnalysisTable.createdAt));

  if (!project || !analysis || analysis.status !== "complete") {
    res.status(409).json({ error: "Run business analysis before discovering competitors" });
    return;
  }

  const quota = await consumeTrialQuota(projectId, "competitors");
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  let competitorResults: CompetitorResult[];
  try {
    const response = await generateJson<{ competitors: CompetitorResult[] }>({
      system:
        "You are a competitive intelligence researcher. You identify REAL, currently-operating companies " +
        "(with real names and real website URLs you know to be accurate) that genuinely compete with the " +
        "business described. Never invent fictional companies. If you are not confident a company is real " +
        "and its URL correct, do not include it. Respond with ONLY a single JSON object, no prose.",
      prompt: `Business to find competitors for: ${project.name} (${project.websiteUrl})
Industry: ${analysis.industry}
Summary: ${analysis.businessSummary}
Products: ${analysis.products}
Services: ${analysis.services}
Unique value proposition: ${analysis.uniqueValueProposition}
Target customers: ${analysis.targetCustomers}

Identify up to 5 real, well-known companies that compete with this specific business in this specific
industry. Return JSON:
{
  "competitors": [
    {
      "name": "real company name",
      "websiteUrl": "https://real-domain.com",
      "industry": "their industry category",
      "description": "what they actually do, 1-2 sentences",
      "strengths": "their real competitive strengths",
      "weaknesses": "their real weaknesses relative to this business",
      "marketGaps": "gaps this company leaves open that ${project.name} could exploit",
      "pricingInsights": "what is publicly known/estimated about their pricing",
      "messagingInsights": "how they position/message themselves",
      "hookStrength": 0-100 integer estimate of their marketing hook strength,
      "conversionPotential": 0-100 integer estimate,
      "differentiationScore": 0-100 integer estimate of how differentiated ${project.name} could be from them
    }
  ]
}`,
    });
    competitorResults = response.competitors.slice(0, 5);
  } catch (err) {
    req.log.error({ err }, "Competitor discovery failed");
    res.status(502).json({ error: "Failed to discover competitors" });
    return;
  }

  const inserted = await db.insert(competitorsTable).values(
    competitorResults.map(c => ({ ...c, projectId }))
  ).returning();

  await recordGeneratedBatch({
    userId: req.project!.ownerId!,
    projectId,
    contentType: "competitors",
    items: inserted.map((c) => ({
      id: c.id,
      data: { name: c.name, websiteUrl: c.websiteUrl, strengths: c.strengths, weaknesses: c.weaknesses, marketGaps: c.marketGaps },
      summary: c.name,
    })),
  });

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

interface CompetitorReportInsights {
  marketGaps: string;
  positioningOpportunities: string;
  winningHooks: string;
  winningCtas: string;
}

async function generateReportInsights(
  projectId: number,
  competitors: (typeof competitorsTable.$inferSelect)[],
  req: import("express").Request,
): Promise<CompetitorReportInsights | null> {
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const [analysis] = await db
    .select()
    .from(businessAnalysisTable)
    .where(eq(businessAnalysisTable.projectId, projectId))
    .orderBy(desc(businessAnalysisTable.createdAt));

  if (!project || !analysis || competitors.length === 0) {
    return null;
  }

  try {
    return await generateJson<CompetitorReportInsights>({
      system:
        "You are a competitive intelligence strategist. Synthesize the competitor data into concrete, " +
        "specific insights for this exact business. Respond with ONLY a single JSON object, no prose.",
      prompt: `Business: ${project.name} (${project.websiteUrl})
Industry: ${analysis.industry}
Unique value proposition: ${analysis.uniqueValueProposition}

Competitors analyzed:
${competitors.map(c => `- ${c.name}: strengths="${c.strengths}", weaknesses="${c.weaknesses}"`).join("\n")}

Return JSON:
{
  "marketGaps": "specific gaps across these competitors that ${project.name} can exploit",
  "positioningOpportunities": "how ${project.name} should position itself against these specific competitors",
  "winningHooks": "3-5 pipe-separated marketing hooks tailored to this business and its competitive gaps",
  "winningCtas": "3-5 pipe-separated calls-to-action tailored to this business"
}`,
    });
  } catch (err) {
    req.log.error({ err }, "Competitor report synthesis failed");
    return null;
  }
}

function serializeReport(
  projectId: number,
  competitors: (typeof competitorsTable.$inferSelect)[],
  report: (typeof competitorReportTable.$inferSelect) | null,
) {
  return {
    projectId,
    competitors: competitors.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
    marketGaps: report?.marketGaps ?? null,
    positioningOpportunities: report?.positioningOpportunities ?? null,
    winningHooks: report?.winningHooks ?? null,
    winningCtas: report?.winningCtas ?? null,
    generatedAt: (report?.updatedAt ?? new Date()).toISOString(),
  };
}

// Returns the most recently generated report without calling the AI. A fresh report is only
// produced via POST (subject to trial quota) to avoid incurring AI cost on every page view.
router.get("/projects/:id/competitor-report", async (req, res): Promise<void> => {
  const params = GetCompetitorReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;
  const competitors = await db.select().from(competitorsTable).where(eq(competitorsTable.projectId, projectId)).orderBy(desc(competitorsTable.createdAt));
  const [report] = await db.select().from(competitorReportTable).where(eq(competitorReportTable.projectId, projectId));

  res.json(serializeReport(projectId, competitors, report ?? null));
});

router.post("/projects/:id/competitor-report", async (req, res): Promise<void> => {
  const params = GenerateCompetitorReportParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;
  const competitors = await db.select().from(competitorsTable).where(eq(competitorsTable.projectId, projectId)).orderBy(desc(competitorsTable.createdAt));

  if (competitors.length === 0) {
    res.status(409).json({ error: "Discover competitors before generating a report" });
    return;
  }

  const quota = await consumeTrialQuota(projectId, "competitor_report");
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  const insights = await generateReportInsights(projectId, competitors, req);

  const [existing] = await db.select().from(competitorReportTable).where(eq(competitorReportTable.projectId, projectId));
  let report: typeof competitorReportTable.$inferSelect;
  if (existing) {
    [report] = await db.update(competitorReportTable).set({ ...insights }).where(eq(competitorReportTable.projectId, projectId)).returning();
  } else {
    [report] = await db.insert(competitorReportTable).values({ projectId, ...insights }).returning();
  }

  await recordGenerated({
    userId: req.project!.ownerId!,
    projectId,
    contentType: "competitor_report",
    contentId: String(report.id),
    contentHash: hashContent(insights),
    summary: `Competitor intelligence report`,
  });

  await db.insert(activityTable).values({
    projectId,
    type: "competitor_report",
    description: "Competitor intelligence report generated",
  });

  res.json(serializeReport(projectId, competitors, report));
});

export default router;

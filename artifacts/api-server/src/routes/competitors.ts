import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { competitorsTable, businessAnalysisTable, projectsTable, activityTable, competitorReportTable } from "@workspace/db";
import {
  ListCompetitorsParams,
  DiscoverCompetitorsParams,
  GetCompetitorParams,
  GetCompetitorReportParams,
  GenerateCompetitorReportParams,
} from "@workspace/api-zod";
import { generateJson } from "../lib/aiJson.js";
import { consumeQuota } from "../lib/planLimits.js";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
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

router.post("/projects/:id/competitors", requireActiveSubscription, async (req, res): Promise<void> => {
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

  const quota = await consumeQuota(projectId, "competitors");
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

/* ── Competitor Report PDF ─────────────────────────────────── */

const PDF_GREEN = "#00E676";
const PDF_DARK = "#040B14";
const PDF_GRAY = "#7a8fa6";
const PDF_WHITE = "#ffffff";
const PDF_W = 595 - 120;

function buildPdfBuffer(builder: (doc: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: "A4" });
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on("data", (c) => chunks.push(c as Buffer));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    doc.pipe(stream);
    builder(doc);
    doc.end();
  });
}

router.get("/projects/:id/competitor-report/pdf", async (req, res): Promise<void> => {
  const params = GetCompetitorReportParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const projectId = params.data.id;
  const competitors = await db.select().from(competitorsTable)
    .where(eq(competitorsTable.projectId, projectId))
    .orderBy(desc(competitorsTable.createdAt));
  const [report] = await db.select().from(competitorReportTable)
    .where(eq(competitorReportTable.projectId, projectId));
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));

  if (competitors.length === 0) {
    res.status(404).json({ error: "No competitor data found" });
    return;
  }

  const buffer = await buildPdfBuffer((doc) => {
    const generated = new Date().toUTCString();

    // Header
    doc.rect(0, 0, 595, 72).fill(PDF_DARK);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(PDF_GREEN).text("GrowthForge AI", 60, 18);
    doc.font("Helvetica").fontSize(8).fillColor(PDF_GRAY).text("Strapli Technologies Inc. · UseGrowthForge.com", 60, 38);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(PDF_WHITE).text("COMPETITIVE INTELLIGENCE REPORT", 60, 54);

    let y = 88;
    doc.font("Helvetica").fontSize(9).fillColor(PDF_GRAY)
      .text(`${project?.name ?? "Project"} · Generated ${generated}`, 60, y);
    y += 20;

    const section = (label: string) => {
      if (y > 700) { doc.addPage(); y = 60; }
      doc.font("Helvetica-Bold").fontSize(10).fillColor(PDF_GREEN).text(label, 60, y);
      y += 14;
      doc.moveTo(60, y).lineTo(535, y).strokeColor(PDF_GREEN).lineWidth(0.4).stroke();
      y += 8;
    };

    const field = (label: string, value: string | null | undefined) => {
      if (!value) return;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(PDF_GRAY).text(label, 60, y);
      y += 12;
      doc.font("Helvetica").fontSize(8.5).fillColor(PDF_WHITE).text(value, 60, y, { width: PDF_W });
      y = doc.y + 8;
    };

    // Report-level insights
    if (report) {
      if (report.marketGaps) {
        section("MARKET GAPS");
        doc.font("Helvetica").fontSize(9).fillColor(PDF_WHITE).text(report.marketGaps, 60, y, { width: PDF_W });
        y = doc.y + 12;
      }
      if (report.positioningOpportunities) {
        section("POSITIONING OPPORTUNITIES");
        doc.font("Helvetica").fontSize(9).fillColor(PDF_WHITE).text(report.positioningOpportunities, 60, y, { width: PDF_W });
        y = doc.y + 12;
      }
      if (report.winningHooks) {
        section("WINNING HOOKS");
        const hooks = report.winningHooks.split("|").map(h => h.trim()).filter(Boolean);
        hooks.forEach(hook => {
          if (y > 700) { doc.addPage(); y = 60; }
          doc.font("Helvetica").fontSize(9).fillColor(PDF_WHITE).text(`• ${hook}`, 68, y, { width: PDF_W - 8 });
          y = doc.y + 4;
        });
        y += 8;
      }
    }

    // Per-competitor sections
    competitors.forEach((c, i) => {
      if (y > 660) { doc.addPage(); y = 60; }
      section(`COMPETITOR ${i + 1}: ${c.name.toUpperCase()}`);

      // Score bar
      const scores: [string, number | null][] = [
        ["Hook Strength", c.hookStrength],
        ["Conversion", c.conversionPotential],
        ["Differentiation Gap", c.differentiationScore],
      ];
      scores.forEach(([label, val]) => {
        if (val == null) return;
        doc.font("Helvetica").fontSize(8).fillColor(PDF_GRAY).text(`${label}: `, 60, y, { continued: true });
        doc.font("Helvetica-Bold").fillColor(PDF_GREEN).text(`${val}/100`);
        y = doc.y + 2;
      });
      y += 4;

      field("Website", c.websiteUrl);
      field("Description", c.description);
      field("Strengths", c.strengths);
      field("Weaknesses", c.weaknesses);
      field("Market Gaps", c.marketGaps);
      field("Pricing Insights", c.pricingInsights);
      field("Messaging Insights", c.messagingInsights);
      y += 4;
    });

    doc.font("Helvetica").fontSize(7).fillColor(PDF_GRAY)
      .text(`GrowthForge AI · Confidential · ${generated}`, 60, 820, { width: PDF_W, align: "center" });
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="competitor-report-${projectId}.pdf"`);
  res.send(buffer);
});

router.post("/projects/:id/competitor-report", requireActiveSubscription, async (req, res): Promise<void> => {
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

  const quota = await consumeQuota(projectId, "competitor_report");
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

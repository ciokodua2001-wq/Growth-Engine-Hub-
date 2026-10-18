import { Router, type IRouter } from "express";
import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import {
  businessAnalysisTable,
  personasTable,
  marketingStrategyTable,
  competitorsTable,
  projectsTable,
  activityTable,
  businessSourcesTable,
  analysisSourcesTable,
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
import { generateJson } from "../lib/aiJson.js";
import { consumeQuota } from "../lib/planLimits.js";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
import { recordGenerated, recordGeneratedBatch, hashContent } from "../lib/contentIntegrity.js";
import { notifyAnalysisComplete } from "../lib/emailNotifier.js";
import { projectIdentityLabel } from "../lib/projectContext.js";
import {
  ingestSource,
  buildGroundingText,
  isSufficientGrounding,
  dedupeSources,
  retrievedSourceFromDeclared,
  capGroundingText,
  type SourceType,
  type RetrievedSource,
} from "../lib/businessSourceIngestor.js";
import { retrieveMetaSourcesForProject } from "../lib/metaProfileRetrieval.js";
import { detectCrossBusinessMismatch } from "../lib/sourceIdentityGuard.js";

const router: IRouter = Router();

router.param("id", requireProjectOwnershipParam());

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

type OperatingModel = "business" | "creator" | "hybrid";

const FIELD_SEMANTICS: Record<OperatingModel, string> = {
  business: `{
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
  creator: `{
  "industry": "the creator's content niche (e.g. comedy, fashion, beauty, tech, education, lifestyle, music)",
  "businessSummary": "an overview of the creator and their channel/audience",
  "products": "digital products, merchandise, or offerings if mentioned, otherwise 'not-applicable'",
  "services": "sponsorships, brand collaborations, consulting, or services if mentioned, otherwise 'not-applicable'",
  "uniqueValueProposition": "the creator's unique value proposition (what makes their content distinctive)",
  "targetCustomers": "the creator's target audience",
  "idealCustomerProfile": "the ideal audience member or ideal brand-partner profile",
  "customerPainPoints": "the audience problems, interests, or unmet needs the creator addresses",
  "brandVoice": "the creator's personality and communication style",
  "brandPositioning": "how the creator differentiates from others in their niche",
  "customerBenefits": "the value the audience gets from the creator's content",
  "purchaseTriggers": "what motivates the audience to follow, engage, subscribe, or convert",
  "marketOpportunities": "audience and niche opportunities",
  "growthOpportunities": "creator growth and monetization opportunities"
}`,
  hybrid: `{
  "industry": "the primary niche/category spanning both the creator's content and their commercial offering",
  "businessSummary": "an overview of this creator-business (audience + products/services)",
  "products": "the specific products or digital goods they sell, or 'not-applicable'",
  "services": "services, sponsorships, or collaborations, or 'not-applicable'",
  "uniqueValueProposition": "what makes this creator-business distinctive",
  "targetCustomers": "the target audience and/or customers",
  "idealCustomerProfile": "the ideal audience member and/or buyer",
  "customerPainPoints": "audience problems and customer pain points addressed",
  "brandVoice": "the creator-business's personality and tone",
  "brandPositioning": "how it differentiates in its niche/market",
  "customerBenefits": "the value delivered to audience and customers",
  "purchaseTriggers": "what motivates the audience to engage, subscribe, or buy",
  "marketOpportunities": "audience, niche, and commercial opportunities",
  "growthOpportunities": "growth and monetization opportunities"
}`,
};

async function analyzeBusinessWithAi(params: {
  identity: string;
  title: string | null;
  metaDescription: string | null;
  text: string;
  extraPrompt?: string;
  operatingModel: OperatingModel;
  locale?: string;
}): Promise<BusinessAnalysisResult> {
  const model = params.operatingModel;
  const kind = model === "creator" ? "content creator" : model === "hybrid" ? "creator-business" : "business";
  return generateJson<BusinessAnalysisResult>({
    system:
      "You are a senior marketing strategist and analyst. You produce precise, specific, non-generic intelligence " +
      "grounded strictly in the provided content. Never invent products, services, sponsorships, revenue, or " +
      "audience statistics that are not stated or strongly implied. If a field genuinely does not apply, return " +
      "the exact string \"not-applicable\"; if it is unknowable from the content, return \"unknown\". " +
      "Respond with ONLY a single JSON object, no prose, no markdown fences.",
    prompt: `Analyze this ${kind} based on the actual content provided.

Identity: ${params.identity}
Page title: ${params.title ?? "(none)"}
Meta description: ${params.metaDescription ?? "(none)"}

Content (from the live source or the owner's manual description):
"""
${params.text}
"""
${params.extraPrompt ? `\nAdditional context from the owner: ${params.extraPrompt}\n` : ""}
Return a JSON object with exactly these string fields, each 1-3 sentences, specific to THIS ${kind} (do not use generic boilerplate):
${FIELD_SEMANTICS[model]}`,
    locale: params.locale,
  });
}

// Analyze website and generate business intelligence
router.post("/projects/:id/analyze", requireActiveSubscription, async (req, res): Promise<void> => {
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
  const project = req.project!;

  // Resolve the primary source from the request body, falling back to the
  // project's persisted source fields.
  const sourceType = (parsed.data.sourceType ?? project.sourceType ?? "website") as SourceType;
  const websiteUrl = parsed.data.websiteUrl ?? project.websiteUrl ?? null;
  const sourceUrl = parsed.data.sourceUrl ?? project.sourceUrl ?? null;
  let declaredContent = parsed.data.businessDescription?.trim() || null;

  // For social/manual projects (no website), fall back to the declared content
  // the owner supplied during onboarding so a creator or business without a
  // website can be analyzed without re-typing their description. The onboarding
  // flow persists this on business_sources.declared_content (and projects.description
  // carries goal + market + description), but the analyze request body only ever
  // receives it when the caller passes `businessDescription` - so resolve it here.
  if (!declaredContent && sourceType !== "website") {
    const [persistedSource] = await db
      .select({ declaredContent: businessSourcesTable.declaredContent })
      .from(businessSourcesTable)
      .where(
        and(
          eq(businessSourcesTable.projectId, projectId),
          eq(businessSourcesTable.sourceType, sourceType),
        ),
      )
      .orderBy(desc(businessSourcesTable.createdAt))
      .limit(1);
    declaredContent = persistedSource?.declaredContent ?? project.description ?? null;
  }

  if (sourceType === "website" && !websiteUrl) {
    res.status(400).json({ error: "A website URL is required for website analysis. Switch the project source to a social/manual source, or provide a business description." });
    return;
  }
  if (sourceType !== "website" && !sourceUrl && !declaredContent) {
    res.status(400).json({ error: "Add a profile URL/handle or describe your business so GrowthForge has something to analyze." });
    return;
  }

  // ── Multi-source grounding ────────────────────────────────────────────
  // Gather every usable source: the primary source (request body), authorized
  // Meta-retrieved profiles, and any other declared social/manual sources in
  // the ledger. A failed provider never blocks an otherwise valid analysis.
  const primary = await ingestSource({ sourceType, websiteUrl, sourceUrl, declaredContent });

  let metaSources: RetrievedSource[] = [];
  try {
    metaSources = await retrieveMetaSourcesForProject(projectId);
  } catch (err) {
    req.log.warn({ err, projectId }, "Meta profile retrieval failed; continuing without it");
  }

  const primaryValue = primary.sourceUrl ?? primary.sourceType;
  const ledger = await db
    .select()
    .from(businessSourcesTable)
    .where(and(eq(businessSourcesTable.projectId, projectId), eq(businessSourcesTable.status, "active")));

  const extraSources = ledger
    .filter((row) => {
      const rowValue = row.sourceValue ?? row.sourceType;
      const isPrimary = row.sourceType === primary.sourceType && rowValue === primaryValue;
      const isMeta = metaSources.some(
        (m) => m.sourceType === row.sourceType && (m.sourceUrl ?? m.sourceType) === rowValue,
      );
      return !isPrimary && !isMeta;
    })
    .map((row) => retrievedSourceFromDeclared(row.sourceType as SourceType, row.sourceUrl, row.declaredContent))
    .filter((s) => s.text && s.text.trim().length > 0);

  const allSources = dedupeSources([primary, ...metaSources, ...extraSources]);

  // Cross-business source safeguard: detect likely mixing and require explicit
  // confirmation before combining sources that appear to be different businesses.
  const mismatch = detectCrossBusinessMismatch(allSources, {
    projectName: project.name,
    websiteUrl: project.websiteUrl,
    sourceType: project.sourceType,
  });
  const confirmSources = (req.body as { confirmSources?: boolean } | undefined)?.confirmSources === true;
  if (mismatch.requiresConfirmation && !confirmSources) {
    res.status(409).json({
      error: "Sources may belong to different businesses. Review and confirm before continuing.",
      sourceMismatch: mismatch,
    });
    return;
  }

  const grounding = buildGroundingText(allSources);
  grounding.text = capGroundingText(grounding.text);
  if (!isSufficientGrounding(grounding.text)) {
    res.status(400).json({ error: "Not enough information to analyze. Provide a website, connect an authorized social profile, or add a longer business description." });
    return;
  }

  const quota = await consumeQuota(projectId, "analysis");
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  const operatingModel = (project.operatingModel ?? "business") as OperatingModel;

  let result: BusinessAnalysisResult;
  try {
    result = await analyzeBusinessWithAi({
      identity: projectIdentityLabel(project),
      title: grounding.title,
      metaDescription: grounding.metaDescription,
      text: grounding.text,
      extraPrompt: parsed.data.prompt,
      operatingModel,
      locale: project.detectedLocale ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    req.log.error({ err, projectId }, "Analysis failed");

    // Append-only: never overwrite prior successful history. Record a "failed"
    // marker only when no analysis row exists yet.
    const [anyAnalysis] = await db
      .select({ id: businessAnalysisTable.id })
      .from(businessAnalysisTable)
      .where(eq(businessAnalysisTable.projectId, projectId))
      .limit(1);
    if (!anyAnalysis) {
      await db.insert(businessAnalysisTable).values({ projectId, status: "failed" });
    }

    await db.insert(activityTable).values({
      projectId,
      type: "analysis",
      description: `Analysis failed: ${message}`,
    });

    res.status(422).json({ error: message });
    return;
  }

  // Append-only: every successful analysis creates a NEW version.
  const [analysis] = await db
    .insert(businessAnalysisTable)
    .values({ projectId, status: "complete", ...result })
    .returning();

  // Persist every grounding source into the ledger and link an immutable
  // analysis-source snapshot per source, so provenance stays per-source.
  const groundSources = allSources.filter((s) => s.text && s.text.trim().length > 0);
  for (const retrieved of groundSources) {
    const sourceValue = retrieved.sourceUrl ?? retrieved.sourceType;
    const [existingSource] = await db
      .select()
      .from(businessSourcesTable)
      .where(
        and(
          eq(businessSourcesTable.projectId, projectId),
          eq(businessSourcesTable.sourceType, retrieved.sourceType),
          eq(businessSourcesTable.sourceValue, sourceValue),
        ),
      )
      .limit(1);

    let sourceId: number;
    if (existingSource) {
      sourceId = existingSource.id;
      await db
        .update(businessSourcesTable)
        .set({
          sourceUrl: retrieved.sourceUrl,
          declaredContent: retrieved.declaredContent,
          retrievedContent: retrieved.retrievedContent,
          retrievalMethod: retrieved.retrievalMethod,
          retrievedAt: retrieved.retrievedAt,
          contentHash: hashContent(retrieved.text),
          status: "active",
        })
        .where(eq(businessSourcesTable.id, sourceId));
    } else {
      const [inserted] = await db
        .insert(businessSourcesTable)
        .values({
          projectId,
          sourceType: retrieved.sourceType,
          sourceUrl: retrieved.sourceUrl,
          sourceValue,
          displayLabel: retrieved.sourceUrl ?? retrieved.sourceType,
          authorizationStatus: retrieved.retrievalMethod === "meta_graph_api" ? "authorized" : "none",
          retrievalMethod: retrieved.retrievalMethod,
          retrievedAt: retrieved.retrievedAt,
          contentHash: hashContent(retrieved.text),
          declaredContent: retrieved.declaredContent,
          retrievedContent: retrieved.retrievedContent,
          status: "active",
        })
        .returning();
      sourceId = inserted.id;
    }

    await db.insert(analysisSourcesTable).values({
      analysisId: analysis.id,
      sourceId,
      snapshotContent: retrieved.text,
      snapshotHash: hashContent(retrieved.text),
    });
  }

  await db.update(projectsTable).set({ industry: result.industry }).where(eq(projectsTable.id, projectId));

  await recordGenerated({
    userId: project.ownerId!,
    projectId,
    contentType: "business_analysis",
    contentId: String(analysis.id),
    contentHash: hashContent(result),
    summary: `Business analysis for ${projectIdentityLabel(project)}`,
  });

  await db.insert(activityTable).values({
    projectId,
    type: "analysis",
    description: `Business intelligence analysis completed for ${projectIdentityLabel(project)}`,
  });

  notifyAnalysisComplete({ projectId, identityLabel: projectIdentityLabel(project) }).catch(err =>
    req.log.warn({ err }, "Failed to send analysis-complete notification (non-fatal)")
  );

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
  const personas = await db.select().from(personasTable).where(and(eq(personasTable.projectId, params.data.id), isNull(personasTable.supersededAt))).orderBy(desc(personasTable.createdAt));
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

router.post("/projects/:id/personas", requireActiveSubscription, async (req, res): Promise<void> => {
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

  const personasQuota = await consumeQuota(projectId, "personas");
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
      locale: project.detectedLocale ?? undefined,
      prompt: `Business: ${project.name} (${projectIdentityLabel(project)})
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

  await recordGeneratedBatch({
    userId: req.project!.ownerId!,
    projectId,
    contentType: "personas",
    items: inserted.map((p) => ({
      id: p.id,
      data: { name: p.name, occupation: p.occupation, motivations: p.motivations, objections: p.objections, buyingTriggers: p.buyingTriggers },
      summary: `${p.name} (${p.occupation})`,
    })),
  });

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

/* ── shared PDF helpers ─────────────────────────────────────── */

const PDF_GREEN = "#00E676";
const PDF_CYAN = "#00D4FF";
const PDF_DARK = "#040B14";
const PDF_GRAY = "#7a8fa6";
const PDF_WHITE = "#ffffff";
const PDF_W = 595 - 120; // usable width at 60px margins

function pdfHeader(doc: InstanceType<typeof PDFDocument>, title: string, subtitle: string, accentColor = PDF_GREEN, companyName = "GrowthForge AI", tagline = "Strapli Technologies Inc. · UseGrowthForge.com") {
  doc.rect(0, 0, 595, 72).fill(PDF_DARK);
  doc.font("Helvetica-Bold").fontSize(16).fillColor(accentColor).text(companyName, 60, 18);
  if (tagline) doc.font("Helvetica").fontSize(8).fillColor(PDF_GRAY).text(tagline, 60, 38);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(PDF_WHITE).text(title.toUpperCase(), 60, 54);
  doc.moveDown(0);
  let y = 88;
  doc.font("Helvetica").fontSize(9).fillColor(PDF_GRAY).text(subtitle, 60, y);
  return y + 20;
}

/**
 * Server-side mirror of the UI's parseSubsections parser.
 * Splits AI text on ALL-CAPS section labels (e.g. "PRIMARY PILLAR -", "TONE:", "TOFU (...):").
 */
function pdfParseSubsections(text: string): Array<{ label: string; body: string }> {
  const re = /\b([A-Z]{2,}(?:\s+[A-Z]{2,})*(?:\s+\d+)?(?:\s*\([^)]{1,100}\))?)\s*(?:-|:)\s*/g;
  const candidates: Array<{ index: number; end: number; label: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index).trim();
    if (m.index === 0 || /\.\s*$/.test(before)) {
      candidates.push({ index: m.index, end: m.index + m[0].length, label: m[1].trim() });
    }
  }
  if (candidates.length < 2) return [{ label: "", body: text.trim() }];
  const results: Array<{ label: string; body: string }> = [];
  if (candidates[0].index > 0) {
    const pre = text.slice(0, candidates[0].index).trim();
    if (pre) results.push({ label: "", body: pre });
  }
  for (let i = 0; i < candidates.length; i++) {
    const bodyEnd = candidates[i + 1]?.index ?? text.length;
    const body = text.slice(candidates[i].end, bodyEnd).trim();
    if (body) results.push({ label: candidates[i].label, body });
  }
  return results;
}

/** Renders a section title (large, colored) with a full-width underline rule. */
function pdfSection(doc: InstanceType<typeof PDFDocument>, label: string, y: number, accentColor = PDF_GREEN): number {
  if (y > 110) y += 16;
  if (y + 40 > doc.page.height - 55) { doc.addPage(); y = 55; }
  doc.font("Helvetica-Bold").fontSize(11).fillColor(accentColor).text(label, 60, y, { width: PDF_W });
  y = doc.y + 3;
  doc.moveTo(60, y).lineTo(535, y).strokeColor(accentColor).lineWidth(0.7).stroke();
  return y + 10;
}

/** Renders a labeled sub-section: left accent bar + bold label + body text. */
function pdfSubBlock(
  doc: InstanceType<typeof PDFDocument>,
  label: string,
  body: string,
  y: number,
  accentColor = PDF_GREEN,
): number {
  if (y + 50 > doc.page.height - 55) { doc.addPage(); y = 55; }
  if (label) {
    doc.rect(60, y + 1, 3, 10).fill(accentColor);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(accentColor)
      .text(label, 68, y, { width: PDF_W - 8 });
    y = doc.y + 3;
    doc.font("Helvetica").fontSize(9).fillColor("#b0c4d8")
      .text(body, 68, y, { width: PDF_W - 8 });
  } else {
    doc.font("Helvetica").fontSize(9).fillColor(PDF_WHITE)
      .text(body, 60, y, { width: PDF_W });
  }
  return doc.y + 12;
}

/** Renders a "Tools & Resources" footer block with clickable hyperlinks. */
function pdfResourceLinks(
  doc: InstanceType<typeof PDFDocument>,
  resources: Array<{ name: string; url: string; description: string }>,
  y: number,
): number {
  if (y + 30 > doc.page.height - 55) { doc.addPage(); y = 55; }
  y += 4;
  doc.moveTo(60, y).lineTo(535, y).strokeColor("#1e2e40").lineWidth(0.5).stroke();
  y += 6;
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#4a6070").text("TOOLS & RESOURCES", 60, y);
  y = doc.y + 4;
  for (const r of resources) {
    if (y + 12 > doc.page.height - 55) { doc.addPage(); y = 55; }
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#4488bb")
      .text(`↗ ${r.name}`, 60, y, { link: r.url, underline: true, continued: true });
    doc.font("Helvetica").fontSize(8).fillColor("#4a6070")
      .text(` - ${r.description}`, { underline: false, continued: false });
    y = doc.y + 2;
  }
  return y + 8;
}

function pdfBody(doc: InstanceType<typeof PDFDocument>, text: string, y: number): number {
  doc.font("Helvetica").fontSize(9).fillColor(PDF_WHITE).text(text, 60, y, { width: PDF_W });
  return doc.y + 12;
}

function buildPdfBuffer(builder: (doc: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: "A4" });

    // Draw dark background on every page so white text is visible
    const fillBackground = () => {
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill(PDF_DARK);
      doc.restore();
    };
    fillBackground(); // initial page
    doc.on("pageAdded", fillBackground);

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

/* ── Strategy PDF ──────────────────────────────────────────── */

const STRATEGY_PDF_RESOURCES: Record<string, Array<{ name: string; url: string; description: string }>> = {
  "POSITIONING STATEMENT": [
    { name: "Value Proposition Canvas", url: "https://www.strategyzer.com/canvas/value-proposition-canvas", description: "Map your value vs. customer needs" },
    { name: "Obviously Awesome (Book)", url: "https://www.aprildunford.com/obviously-awesome", description: "April Dunford's positioning framework" },
    { name: "HubSpot Positioning Templates", url: "https://offers.hubspot.com/brand-positioning-templates", description: "Free positioning worksheet" },
  ],
  "MESSAGING FRAMEWORK": [
    { name: "StoryBrand Framework", url: "https://storybrand.com/", description: "Clarify your brand message" },
    { name: "Copyhackers", url: "https://copyhackers.com/", description: "Conversion copywriting guides" },
    { name: "Swipe Files", url: "https://www.swipefiles.com/", description: "Best-in-class marketing copy examples" },
  ],
  "BRAND VOICE GUIDE": [
    { name: "Mailchimp Voice & Tone", url: "https://styleguide.mailchimp.com/voice-and-tone/", description: "Gold standard brand voice guide" },
    { name: "Grammarly Style Guide Builder", url: "https://www.grammarly.com/business/learn/how-to-create-brand-style-guide/", description: "Build your content style guide" },
  ],
  "SEO STRATEGY": [
    { name: "Google Search Console", url: "https://search.google.com/search-console", description: "Monitor your site's search performance" },
    { name: "Ahrefs Free Tools", url: "https://ahrefs.com/free-seo-tools", description: "Keyword research & site audit" },
    { name: "Answer the Public", url: "https://answerthepublic.com/", description: "Questions your audience is searching" },
    { name: "Google Keyword Planner", url: "https://ads.google.com/home/tools/keyword-planner/", description: "Search volume & keyword ideas" },
  ],
  "CAMPAIGN STRATEGY": [
    { name: "Meta Ads Manager", url: "https://www.facebook.com/adsmanager", description: "Run Facebook & Instagram campaigns" },
    { name: "Meta Ads Library", url: "https://www.facebook.com/ads/library", description: "Research competitor ad creatives" },
    { name: "LinkedIn Campaign Manager", url: "https://www.linkedin.com/campaignmanager", description: "B2B audience targeting" },
    { name: "Reddit Ads", url: "https://ads.reddit.com/", description: "Reach niche communities organically" },
  ],
  "LEAD GENERATION STRATEGY": [
    { name: "HubSpot CRM (Free)", url: "https://www.hubspot.com/products/crm", description: "Track and manage leads" },
    { name: "Mailchimp", url: "https://mailchimp.com/", description: "Email list building & automation" },
    { name: "ConvertKit", url: "https://convertkit.com/", description: "Creator-focused email marketing" },
    { name: "Hunter.io", url: "https://hunter.io/", description: "Find and verify business emails" },
  ],
  "FUNNEL RECOMMENDATIONS": [
    { name: "Google Analytics 4", url: "https://analytics.google.com/", description: "Track traffic and conversions" },
    { name: "Hotjar", url: "https://www.hotjar.com/", description: "Heatmaps & session recordings" },
    { name: "Microsoft Clarity", url: "https://clarity.microsoft.com/", description: "Free heatmaps and user recordings" },
    { name: "Mixpanel", url: "https://mixpanel.com/", description: "Product & funnel analytics" },
  ],
};

router.get("/projects/:id/strategy/pdf", async (req, res): Promise<void> => {
  const params = GetMarketingStrategyParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [strategy] = await db.select().from(marketingStrategyTable)
    .where(eq(marketingStrategyTable.projectId, params.data.id))
    .orderBy(desc(marketingStrategyTable.createdAt));
  if (!strategy) { res.status(404).json({ error: "No strategy found" }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));

  const isWhiteLabel = (project?.plan === "growth" || project?.plan === "agency") && !!project?.brandingCompanyName;
  const wlCompany = isWhiteLabel ? (project!.brandingCompanyName ?? "") : "GrowthForge AI";
  const wlTagline = isWhiteLabel ? "" : "Strapli Technologies Inc. · UseGrowthForge.com";
  const wlAccent = isWhiteLabel && project?.brandingAccentColor ? project.brandingAccentColor : PDF_GREEN;
  const wlFooter = isWhiteLabel ? `${wlCompany} · Confidential` : "GrowthForge AI · Confidential";

  const buffer = await buildPdfBuffer((doc) => {
    const generated = new Date().toUTCString();
    let y = pdfHeader(doc, "Marketing Strategy", `${project?.name ?? "Project"} · Generated ${generated}`, wlAccent, wlCompany, wlTagline);

    const sections: [string, string | null][] = [
      ["POSITIONING STATEMENT", strategy.positioningStatement],
      ["MESSAGING FRAMEWORK", strategy.messagingFramework],
      ["BRAND VOICE GUIDE", strategy.brandVoiceGuide],
      ["SEO STRATEGY", strategy.seoStrategy],
      ["CAMPAIGN STRATEGY", strategy.campaignStrategy],
      ["LEAD GENERATION STRATEGY", strategy.leadGenerationStrategy],
      ["FUNNEL RECOMMENDATIONS", strategy.funnelRecommendations],
    ];

    for (const [sectionLabel, content] of sections) {
      if (!content) continue;
      y = pdfSection(doc, sectionLabel, y, wlAccent);
      const subsections = pdfParseSubsections(content);
      for (const { label, body } of subsections) {
        y = pdfSubBlock(doc, label, body, y, wlAccent);
      }
      const sectionResources = STRATEGY_PDF_RESOURCES[sectionLabel];
      if (sectionResources) y = pdfResourceLinks(doc, sectionResources, y);
    }

    doc.font("Helvetica").fontSize(7).fillColor(PDF_GRAY)
      .text(`${wlFooter} · ${generated}`, 60, 820, { width: PDF_W, align: "center" });
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="strategy-${params.data.id}.pdf"`);
  res.send(buffer);
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

router.post("/projects/:id/strategy", requireActiveSubscription, async (req, res): Promise<void> => {
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

  const strategyQuota = await consumeQuota(projectId, "strategy");
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
      locale: project.detectedLocale ?? undefined,
      prompt: `Business: ${project.name} (${projectIdentityLabel(project)})
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

  if (strategy) {
    await recordGenerated({
      userId: req.project!.ownerId!,
      projectId,
      contentType: "marketing_strategy",
      contentId: String(strategy.id),
      contentHash: hashContent(strategyData),
      summary: `Marketing strategy`,
    });
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

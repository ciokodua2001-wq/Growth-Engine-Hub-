import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { seoStrategiesTable, projectsTable } from "@workspace/db";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
import { consumeQuota, meetsMinPlan } from "../lib/planLimits.js";
import { getGroundingContext, renderGroundingBlock } from "../lib/projectContext.js";
import { generateJson } from "../lib/aiJson.js";

const router: IRouter = Router();

router.param("id", requireProjectOwnershipParam());

// ── GET current SEO strategy ──────────────────────────────────────────────────

router.get("/projects/:id/seo-strategy", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [row] = await db
    .select()
    .from(seoStrategiesTable)
    .where(eq(seoStrategiesTable.projectId, id));

  res.json(row ?? null);
});

// ── POST generate / regenerate SEO strategy ───────────────────────────────────

router.post(
  "/projects/:id/seo-strategy/generate",
  requireActiveSubscription,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

    const [project] = await db
      .select({ plan: projectsTable.plan })
      .from(projectsTable)
      .where(eq(projectsTable.id, id));

    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    if (!req.isPlatformOwner && !meetsMinPlan(project.plan, "starter")) {
      res.status(403).json({
        error: "AI SEO Strategy Builder requires a paid plan. Upgrade to unlock.",
      });
      return;
    }

    const quota = await consumeQuota(id, "seo_strategy");
    if (!quota.allowed) { res.status(403).json({ error: quota.message }); return; }

    const ctx = await getGroundingContext(id);
    if (!ctx) {
      res.status(409).json({
        error: "Business analysis must be complete before generating an SEO strategy. Run the website analysis first.",
      });
      return;
    }

    const businessName = ctx.project.name ?? "this business";

    // NOTE: Keep this prompt concise. The Vertex AI proxy has a 3-minute hard
    // timeout. maxTokens is capped at 4000 and every list is a fixed length to
    // ensure the response completes well within that window.
    const prompt = `You are an elite SEO and GEO (Generative Engine Optimization) strategist.

${renderGroundingBlock(ctx)}

Generate a specific SEO strategy for ${businessName}. Keep every string value to one concise sentence.

Return ONLY a raw JSON object — no markdown, no code fences, no text outside the JSON:
{
  "overallScore": <integer 0-100>,
  "summary": "<2 sentence executive summary of the top SEO opportunity>",
  "priorityActions": ["<action 1>", "<action 2>", "<action 3>", "<action 4>", "<action 5>"],
  "traditionalSeo": {
    "strengths": ["<strength 1>", "<strength 2>"],
    "gaps": ["<gap 1>", "<gap 2>", "<gap 3>"],
    "keywordOpportunities": [
      { "keyword": "<phrase>", "intent": "informational|commercial|transactional|navigational", "difficulty": "low|medium|high", "opportunity": "<one sentence>" },
      { "keyword": "<phrase>", "intent": "informational|commercial|transactional|navigational", "difficulty": "low|medium|high", "opportunity": "<one sentence>" },
      { "keyword": "<phrase>", "intent": "informational|commercial|transactional|navigational", "difficulty": "low|medium|high", "opportunity": "<one sentence>" },
      { "keyword": "<phrase>", "intent": "informational|commercial|transactional|navigational", "difficulty": "low|medium|high", "opportunity": "<one sentence>" },
      { "keyword": "<phrase>", "intent": "informational|commercial|transactional|navigational", "difficulty": "low|medium|high", "opportunity": "<one sentence>" }
    ],
    "contentGapAnalysis": ["<topic 1>", "<topic 2>", "<topic 3>"],
    "topicClusters": [
      { "pillar": "<pillar 1>", "spokes": ["<spoke>", "<spoke>", "<spoke>"] },
      { "pillar": "<pillar 2>", "spokes": ["<spoke>", "<spoke>", "<spoke>"] },
      { "pillar": "<pillar 3>", "spokes": ["<spoke>", "<spoke>", "<spoke>"] }
    ],
    "localSeo": {
      "applicable": <true|false>,
      "recommendations": ["<recommendation>", "<recommendation>"]
    },
    "technicalChecklist": ["<item 1>", "<item 2>", "<item 3>"],
    "linkBuildingOpportunities": ["<opportunity 1>", "<opportunity 2>"]
  },
  "geoStrategy": {
    "readinessScore": <integer 0-100>,
    "readinessSummary": "<2 sentence assessment>",
    "eatSignals": {
      "expertise": "<one sentence>",
      "authority": "<one sentence>",
      "trustworthiness": "<one sentence>"
    },
    "contentStructureRecommendations": ["<recommendation 1>", "<recommendation 2>"],
    "aiCitationRecommendations": ["<recommendation 1>", "<recommendation 2>"],
    "platformSpecific": {
      "chatgpt": ["<tip 1>", "<tip 2>"],
      "perplexity": ["<tip 1>", "<tip 2>"],
      "gemini": ["<tip 1>", "<tip 2>"],
      "claude": ["<tip 1>", "<tip 2>"]
    },
    "schemaMarkupPriorities": ["<schema type 1>", "<schema type 2>"],
    "faqOpportunities": ["<faq topic 1>", "<faq topic 2>"]
  },
  "competitorVisibility": {
    "likelyGaps": ["<gap 1>", "<gap 2>"],
    "opportunities": ["<opportunity 1>", "<opportunity 2>"]
  },
  "authorityBuilding": ["<recommendation 1>", "<recommendation 2>"],
  "ninetyDayRoadmap": [
    { "phase": "Days 1-30", "theme": "<theme>", "actions": ["<action>", "<action>", "<action>"] },
    { "phase": "Days 31-60", "theme": "<theme>", "actions": ["<action>", "<action>", "<action>"] },
    { "phase": "Days 61-90", "theme": "<theme>", "actions": ["<action>", "<action>", "<action>"] }
  ]
}`;

    try {
      const strategy = await generateJson<Record<string, unknown>>({
        system: "You are an elite SEO and GEO strategist. Return ONLY a raw JSON object — no markdown, no code fences, no text outside the JSON braces. Keep every string value to one concise sentence. Replace every placeholder with real, specific content for this business.",
        prompt,
        maxTokens: 4000,
      });

      const [saved] = await db
        .insert(seoStrategiesTable)
        .values({ projectId: id, status: "complete", strategy })
        .onConflictDoUpdate({
          target: seoStrategiesTable.projectId,
          set: { status: "complete", strategy, errorMessage: null, updatedAt: new Date() },
        })
        .returning();

      res.json(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      await db
        .insert(seoStrategiesTable)
        .values({ projectId: id, status: "failed", errorMessage: msg })
        .onConflictDoUpdate({
          target: seoStrategiesTable.projectId,
          set: { status: "failed", errorMessage: msg, updatedAt: new Date() },
        })
        .catch(() => {});
      res.status(500).json({ error: "Failed to generate SEO strategy. Please try again." });
    }
  },
);

export default router;

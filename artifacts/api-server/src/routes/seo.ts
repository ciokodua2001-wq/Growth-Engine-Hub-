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

    if (!meetsMinPlan(project.plan, "starter")) {
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

    const prompt = `You are an elite SEO and GEO (Generative Engine Optimization) strategist with deep expertise in both traditional search engines and AI-powered discovery platforms.

${renderGroundingBlock(ctx)}

Generate a comprehensive, highly specific SEO strategy for ${businessName}.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{
  "overallScore": <integer 0-100, current estimated SEO maturity based on business context>,
  "summary": "<2-3 sentence executive summary of the biggest SEO opportunity for this business>",
  "priorityActions": ["<most impactful action>", "<second>", "<third>", "<fourth>", "<fifth>"],
  "traditionalSeo": {
    "strengths": ["<inferred strength based on business type>"],
    "gaps": ["<likely gap for this industry>"],
    "keywordOpportunities": [
      { "keyword": "<specific keyword phrase>", "intent": "informational|commercial|transactional|navigational", "difficulty": "low|medium|high", "opportunity": "<one sentence why this is valuable>" }
    ],
    "contentGapAnalysis": ["<specific content topic they are likely missing>"],
    "topicClusters": [
      { "pillar": "<main pillar topic>", "spokes": ["<spoke 1>", "<spoke 2>", "<spoke 3>", "<spoke 4>"] }
    ],
    "localSeo": {
      "applicable": <true if business has local/geographic relevance, otherwise false>,
      "recommendations": ["<specific local SEO action>"]
    },
    "technicalChecklist": ["<technical SEO item to implement>"],
    "linkBuildingOpportunities": ["<specific link building opportunity for this industry>"]
  },
  "geoStrategy": {
    "readinessScore": <integer 0-100, readiness for AI search discovery>,
    "readinessSummary": "<2 sentence assessment of AI search readiness>",
    "eatSignals": {
      "expertise": "<how to demonstrate expertise for AI crawlers and LLMs>",
      "authority": "<how to build domain authority for AI citation>",
      "trustworthiness": "<trust signals to implement>"
    },
    "contentStructureRecommendations": ["<how to structure content for LLM consumption>"],
    "aiCitationRecommendations": ["<what makes content citable and quotable by AI models>"],
    "platformSpecific": {
      "chatgpt": ["<optimization tip for ChatGPT/Bing AI discovery>", "<second tip>"],
      "perplexity": ["<optimization tip for Perplexity>", "<second tip>"],
      "gemini": ["<optimization tip for Google Gemini/AI Overviews>", "<second tip>"],
      "claude": ["<optimization tip for Claude and Anthropic AI>", "<second tip>"]
    },
    "schemaMarkupPriorities": ["<schema.org type most important for this business>"],
    "faqOpportunities": ["<FAQ topic that AI platforms frequently answer for this niche>"]
  },
  "competitorVisibility": {
    "likelyGaps": ["<area where competitors may be outranking based on industry>"],
    "opportunities": ["<specific opportunity to outperform competitors in search>"]
  },
  "authorityBuilding": ["<specific authority-building recommendation for this industry>"],
  "ninetyDayRoadmap": [
    { "phase": "Days 1–30", "theme": "<focus theme>", "actions": ["<specific action>", "<specific action>", "<specific action>"] },
    { "phase": "Days 31–60", "theme": "<focus theme>", "actions": ["<specific action>", "<specific action>", "<specific action>"] },
    { "phase": "Days 61–90", "theme": "<focus theme>", "actions": ["<specific action>", "<specific action>", "<specific action>"] }
  ]
}

Requirements:
- Minimum 6 keyword opportunities with varied intent types
- Minimum 3 topic clusters with 4 spokes each
- Minimum 2 tips per GEO platform
- All recommendations must be specific to ${businessName}'s industry and business model
- The 90-day roadmap must be sequenced so early phases enable later ones`;

    try {
      const strategy = await generateJson<Record<string, unknown>>({
        system: "You are an elite SEO and GEO strategist. Return only valid JSON with no markdown or code fences. Every recommendation must be specific and actionable based on the provided business context.",
        prompt,
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

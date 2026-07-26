import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  seoBlogPostsTable,
  seoMetaTagsTable,
  seoSchemaMarkupTable,
  seoSitemapTable,
  seoWatchdogTable,
  projectsTable,
} from "@workspace/db";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
import { consumeQuota, meetsMinPlan } from "../lib/planLimits.js";
import { getGroundingContext, renderGroundingBlock } from "../lib/projectContext.js";
import { generateJson } from "../lib/aiJson.js";

const router: IRouter = Router();

router.param("id", requireProjectOwnershipParam());

/* ─────────────────────────────────────────────────────────────────────────
   SEO Blog Posts
───────────────────────────────────────────────────────────────────────── */

router.get("/projects/:id/seo/blog-posts", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const posts = await db
    .select()
    .from(seoBlogPostsTable)
    .where(eq(seoBlogPostsTable.projectId, id))
    .orderBy(desc(seoBlogPostsTable.createdAt));
  res.json(posts);
});

router.post(
  "/projects/:id/seo/blog-posts/generate",
  requireActiveSubscription,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

    const [project] = await db.select({ plan: projectsTable.plan }).from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!req.isPlatformOwner && !meetsMinPlan(project.plan, "starter")) {
      res.status(403).json({ error: "SEO Blog Post Generator requires a paid plan. Upgrade to unlock." });
      return;
    }

    const quota = await consumeQuota(id, "seo_blog_posts");
    if (!quota.allowed) { res.status(403).json({ error: quota.message }); return; }

    const ctx = await getGroundingContext(id);
    if (!ctx) {
      res.status(409).json({ error: "Business analysis must be complete before generating SEO content." });
      return;
    }

    const body = req.body as { keyword?: string; tone?: string };
    const keyword = body.keyword?.trim() || "business growth strategies";
    const tone = body.tone || "professional";
    const businessName = ctx.project.name ?? "this business";

    const prompt = `You are an elite SEO content writer and strategist.

${renderGroundingBlock(ctx)}

Write a complete, publication-ready SEO blog article for ${businessName} targeting this keyword: "${keyword}"

The article must:
- Be 900-1200 words
- Naturally include the target keyword in the title, first paragraph, 2-3 subheadings, and conclusion
- Use a ${tone} tone
- Include a strong introduction that hooks the reader in the first 2 sentences
- Have 4-6 H2 subheadings that include LSI (related) keywords
- End with a clear call-to-action that fits ${businessName}'s business
- Be written for humans first, search engines second — no keyword stuffing

Return ONLY valid JSON (no markdown, no code fences):
{
  "title": "<SEO-optimized title including keyword, 50-60 chars>",
  "metaTitle": "<meta title for browser tab, 50-60 chars>",
  "metaDescription": "<compelling meta description with keyword, 150-160 chars>",
  "content": "<full article in markdown with ## for H2 subheadings>",
  "wordCount": <integer>,
  "lsiKeywords": ["<related keyword 1>", "<related keyword 2>", "<related keyword 3>"]
}`;

    try {
      const result = await generateJson<Record<string, unknown>>({
        system: "You are an elite SEO content strategist and writer. Return only valid JSON with no markdown or code fences.",
        prompt,
        maxTokens: 3000,
      });

      const [saved] = await db
        .insert(seoBlogPostsTable)
        .values({
          projectId: id,
          keyword,
          title: String(result.title ?? keyword),
          content: String(result.content ?? ""),
          metaTitle: result.metaTitle ? String(result.metaTitle) : null,
          metaDescription: result.metaDescription ? String(result.metaDescription) : null,
          wordCount: typeof result.wordCount === "number" ? result.wordCount : 0,
          status: "complete",
        })
        .returning();

      res.json(saved);
    } catch (err) {
      req.log.error({ err }, "SEO blog post generation failed");
      res.status(500).json({ error: "Failed to generate blog post. Please try again." });
    }
  },
);

router.delete("/projects/:id/seo/blog-posts/:postId", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  const postId = parseInt(String(req.params["postId"] ?? ""), 10);
  if (isNaN(id) || isNaN(postId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db
    .delete(seoBlogPostsTable)
    .where(eq(seoBlogPostsTable.id, postId))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Post not found" }); return; }
  res.json({ deleted: true });
});

/* ─────────────────────────────────────────────────────────────────────────
   SEO Meta Tags
───────────────────────────────────────────────────────────────────────── */

router.get("/projects/:id/seo/meta-tags", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const [row] = await db.select().from(seoMetaTagsTable).where(eq(seoMetaTagsTable.projectId, id));
  res.json(row ?? null);
});

router.post(
  "/projects/:id/seo/meta-tags/generate",
  requireActiveSubscription,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

    const [project] = await db.select({ plan: projectsTable.plan }).from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!req.isPlatformOwner && !meetsMinPlan(project.plan, "starter")) {
      res.status(403).json({ error: "Meta Tags Generator requires a paid plan." });
      return;
    }

    const ctx = await getGroundingContext(id);
    if (!ctx) {
      res.status(409).json({ error: "Business analysis must be complete before generating meta tags." });
      return;
    }

    const businessName = ctx.project.name ?? "this business";
    const body = req.body as { pages?: string[] };
    const customPages = body.pages ?? [];

    const prompt = `You are an expert SEO strategist specializing in on-page optimization.

${renderGroundingBlock(ctx)}

Generate optimized meta titles and descriptions for ${businessName}'s key website pages.

Standard pages to cover: Home, About, Contact, Services/Products (use actual product/service names from the business context).
${customPages.length > 0 ? `Additional pages requested: ${customPages.join(", ")}` : ""}

Rules:
- Meta title: 50-60 characters, include primary keyword naturally
- Meta description: 150-160 characters, include a call to action, include keyword
- OG title: can be slightly more creative/emotional than meta title
- OG description: 2 sentences, more conversational than meta description

Return ONLY valid JSON (no markdown, no code fences):
{
  "pages": [
    {
      "pageName": "<page name e.g. Home>",
      "pageType": "<home|about|services|contact|product|blog|custom>",
      "metaTitle": "<50-60 char SEO title>",
      "metaDescription": "<150-160 char meta description>",
      "ogTitle": "<open graph title>",
      "ogDescription": "<open graph description>",
      "primaryKeyword": "<the target keyword for this page>",
      "htmlSnippet": "<the complete <head> HTML snippet with all meta tags ready to paste>"
    }
  ]
}`;

    try {
      const result = await generateJson<{ pages: unknown[] }>({
        system: "You are an expert on-page SEO strategist. Return only valid JSON. Meta tags must be specific to the actual business, not generic.",
        prompt,
        maxTokens: 2500,
      });

      const [saved] = await db
        .insert(seoMetaTagsTable)
        .values({ projectId: id, pages: result.pages ?? [] })
        .onConflictDoUpdate({
          target: seoMetaTagsTable.projectId,
          set: { pages: result.pages ?? [], updatedAt: new Date() },
        })
        .returning();

      res.json(saved);
    } catch (err) {
      req.log.error({ err }, "Meta tags generation failed");
      res.status(500).json({ error: "Failed to generate meta tags. Please try again." });
    }
  },
);

/* ─────────────────────────────────────────────────────────────────────────
   SEO Schema Markup
───────────────────────────────────────────────────────────────────────── */

router.get("/projects/:id/seo/schema", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const [row] = await db.select().from(seoSchemaMarkupTable).where(eq(seoSchemaMarkupTable.projectId, id));
  res.json(row ?? null);
});

router.post(
  "/projects/:id/seo/schema/generate",
  requireActiveSubscription,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

    const [project] = await db.select({ plan: projectsTable.plan }).from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!req.isPlatformOwner && !meetsMinPlan(project.plan, "starter")) {
      res.status(403).json({ error: "Schema Markup Generator requires a paid plan." });
      return;
    }

    const ctx = await getGroundingContext(id);
    if (!ctx) {
      res.status(409).json({ error: "Business analysis must be complete before generating schema markup." });
      return;
    }

    const businessName = ctx.project.name ?? "this business";
    const websiteUrl = ctx.project.websiteUrl ?? "https://example.com";

    const prompt = `You are a technical SEO expert specializing in structured data and schema.org markup.

${renderGroundingBlock(ctx)}

Generate exactly 3 JSON-LD schema blocks for ${businessName} (website: ${websiteUrl}): Organization, WebSite, and the single most relevant third type for this business (e.g. LocalBusiness, SoftwareApplication, Product, or Service — pick one).

For each schema provide one short installation note per platform (1 sentence max).

Return ONLY valid JSON (no markdown, no code fences):
{
  "schemas": [
    {
      "type": "<schema type>",
      "priority": "essential|recommended|optional",
      "description": "<one sentence why this schema matters>",
      "jsonLd": "<complete JSON-LD script tag, ready to paste>",
      "platforms": {
        "wordpress": "<1-sentence install note>",
        "shopify": "<1-sentence install note>",
        "squarespace": "<1-sentence install note>",
        "wix": "<1-sentence install note>"
      }
    }
  ]
}`;

    try {
      const result = await generateJson<{ schemas: unknown[] }>({
        system: "You are a technical SEO expert. Return only valid JSON. Every JSON-LD block must be valid and production-ready with real business values.",
        prompt,
        maxTokens: 3000,
      });

      const [saved] = await db
        .insert(seoSchemaMarkupTable)
        .values({ projectId: id, schemas: result.schemas ?? [] })
        .onConflictDoUpdate({
          target: seoSchemaMarkupTable.projectId,
          set: { schemas: result.schemas ?? [], updatedAt: new Date() },
        })
        .returning();

      res.json(saved);
    } catch (err) {
      req.log.error({ err }, "Schema markup generation failed");
      res.status(500).json({ error: "Failed to generate schema markup. Please try again." });
    }
  },
);

/* ─────────────────────────────────────────────────────────────────────────
   Sitemap Generator
───────────────────────────────────────────────────────────────────────── */

router.post(
  "/projects/:id/seo/sitemap/generate",
  requireActiveSubscription,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

    const [project] = await db.select({ plan: projectsTable.plan }).from(projectsTable).where(eq(projectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!req.isPlatformOwner && !meetsMinPlan(project.plan, "starter")) {
      res.status(403).json({ error: "Sitemap Generator requires a paid plan." });
      return;
    }

    const ctx = await getGroundingContext(id);
    if (!ctx) {
      res.status(409).json({ error: "Business analysis must be complete before generating a sitemap." });
      return;
    }

    const websiteUrl = (ctx.project.websiteUrl ?? "https://example.com").replace(/\/$/, "");
    const businessName = ctx.project.name ?? "this business";
    const today = new Date().toISOString().split("T")[0];

    const prompt = `You are an SEO expert. Based on this business context, generate a realistic sitemap.xml for ${businessName}.

${renderGroundingBlock(ctx)}

Website: ${websiteUrl}

Generate the pages that a business like this would realistically have. Include:
- Homepage
- About / About Us
- Services or Products pages (use actual service/product names from the context)
- Blog or Resources (if applicable)
- Contact
- Any industry-specific pages (pricing, FAQ, case studies, testimonials, etc.)

Assign appropriate changefreq and priority values.

Return ONLY valid JSON (no markdown, no code fences):
{
  "pages": [
    {
      "url": "<full URL>",
      "lastmod": "${today}",
      "changefreq": "daily|weekly|monthly|yearly",
      "priority": "<0.1 to 1.0 as string>",
      "pageName": "<human-readable page name>"
    }
  ],
  "submissionInstructions": {
    "googleSearchConsole": "<step by step how to submit this sitemap to Google Search Console>",
    "bingWebmaster": "<step by step for Bing Webmaster Tools>"
  }
}`;

    try {
      const result = await generateJson<{ pages: unknown[]; submissionInstructions: unknown }>({
        system: "You are an SEO expert. Return only valid JSON. URLs must use the actual website URL provided.",
        prompt,
      });

      const pages = result.pages as Array<{ url: string; lastmod: string; changefreq: string; priority: string }>;
      const xmlLines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...pages.map((p) =>
          `  <url>\n    <loc>${p.url}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
        ),
        "</urlset>",
      ];

      const xml = xmlLines.join("\n");

      // Persist so the public endpoint can serve it without auth
      await db
        .insert(seoSitemapTable)
        .values({ projectId: id, xml, pageCount: pages.length })
        .onConflictDoUpdate({
          target: seoSitemapTable.projectId,
          set: { xml, pageCount: pages.length, updatedAt: new Date() },
        });

      // Use hardcoded canonical host — req.hostname returns "localhost" behind the proxy
      const canonicalHost = process.env["CANONICAL_HOST"] ?? "usegrowthforge.com";
      const sitemapUrl = `https://${canonicalHost}/api/sitemap/${id}/sitemap.xml`;

      res.json({
        xml,
        pages: result.pages,
        pageCount: pages.length,
        sitemapUrl,
        submissionInstructions: result.submissionInstructions,
      });
    } catch (err) {
      req.log.error({ err }, "Sitemap generation failed");
      res.status(500).json({ error: "Failed to generate sitemap. Please try again." });
    }
  },
);

/* ─────────────────────────────────────────────────────────────────────────
   GET stored sitemap — authenticated, returns JSON with xml + sitemapUrl
───────────────────────────────────────────────────────────────────────── */

router.get("/projects/:id/seo/sitemap", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

  const [row] = await db.select().from(seoSitemapTable).where(eq(seoSitemapTable.projectId, id));
  if (!row) { res.json(null); return; }

  const canonicalHost = process.env["CANONICAL_HOST"] ?? "usegrowthforge.com";
  res.json({
    xml: row.xml,
    pageCount: row.pageCount,
    sitemapUrl: `https://${canonicalHost}/api/sitemap/${id}/sitemap.xml`,
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Public sitemap endpoint — no auth required, served as application/xml
   URL: GET /api/sitemap/:projectId/sitemap.xml
   Submit this URL directly to Google Search Console / Bing Webmaster Tools.
───────────────────────────────────────────────────────────────────────── */

router.get("/sitemap/:projectId/sitemap.xml", async (req, res): Promise<void> => {
  const projectId = parseInt(String(req.params["projectId"] ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).send("Invalid project id"); return; }

  const [row] = await db
    .select({ xml: seoSitemapTable.xml })
    .from(seoSitemapTable)
    .where(eq(seoSitemapTable.projectId, projectId));

  if (!row) {
    res.status(404).send("Sitemap not found. Generate one from the GrowthForge SEO dashboard.");
    return;
  }

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(row.xml);
});

/* ─────────────────────────────────────────────────────────────────────────
   SEO Watchdog Coach
───────────────────────────────────────────────────────────────────────── */

router.get("/projects/:id/seo/watchdog", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }
  const [row] = await db.select().from(seoWatchdogTable).where(eq(seoWatchdogTable.projectId, id));
  res.json(row ?? null);
});

router.post(
  "/projects/:id/seo/watchdog/generate",
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params["id"] ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid project id" }); return; }

    const quota = await consumeQuota(id, "seo_watchdog");
    if (!quota.allowed) { res.status(403).json({ error: quota.message }); return; }

    const ctx = await getGroundingContext(id);
    if (!ctx) {
      res.status(409).json({ error: "Business analysis must be complete before using the SEO Coach." });
      return;
    }

    // Gather what the user has already done so the coach can be contextual
    const [seoStrategy] = await db
      .select({ status: seoSchemaMarkupTable.projectId })
      .from(seoSchemaMarkupTable)
      .where(eq(seoSchemaMarkupTable.projectId, id));
    const [metaTags] = await db
      .select({ id: seoMetaTagsTable.id })
      .from(seoMetaTagsTable)
      .where(eq(seoMetaTagsTable.projectId, id));
    const blogPosts = await db
      .select({ id: seoBlogPostsTable.id, keyword: seoBlogPostsTable.keyword })
      .from(seoBlogPostsTable)
      .where(eq(seoBlogPostsTable.projectId, id));

    const doneItems = [
      seoStrategy ? "✅ Schema markup generated" : "❌ Schema markup not yet done",
      metaTags ? "✅ Meta tags generated for all pages" : "❌ Meta tags not yet done",
      blogPosts.length > 0
        ? `✅ ${blogPosts.length} SEO blog post(s) written (keywords: ${blogPosts.map((b) => b.keyword).join(", ")})`
        : "❌ No SEO blog posts written yet",
    ].join("\n");

    const businessName = ctx.project.name ?? "this business";
    const weekOf = new Date().toISOString().split("T")[0] ?? "today";

    const prompt = `You are a personal SEO coach and watchdog for ${businessName}. Your job is to tell the business owner EXACTLY what to do this week to improve their search rankings — no fluff, no generalities.

${renderGroundingBlock(ctx)}

What has already been done:
${doneItems}

Today's date: ${weekOf}

Generate a highly specific, actionable weekly SEO action plan. Be direct and personal — like a coach who knows their business. Tell them WHY each action matters in plain language, HOW to do it step by step, and what result to expect.

Return ONLY valid JSON (no markdown, no code fences):
{
  "weekOf": "${weekOf}",
  "headline": "<motivating 1-sentence summary of this week's focus, e.g. 'This week: win your first Google Featured Snippet'>",
  "summary": "<2-3 sentence coach message to the business owner — personal, direct, encouraging>",
  "progressNote": "<honest assessment of where they stand and what's been done well or needs attention>",
  "actions": [
    {
      "priority": "critical|high|medium",
      "category": "technical|content|links|local|social|monitoring",
      "action": "<specific, one-sentence task title>",
      "why": "<1-2 sentences: why this matters for their specific business and rankings>",
      "how": ["<step 1>", "<step 2>", "<step 3>"],
      "estimatedTime": "<e.g. 30 minutes, 2 hours>",
      "expectedResult": "<what improvement to expect and roughly when>"
    }
  ]
}

Requirements:
- 5-7 actions total, at least 2 marked critical
- Every action must be specific to ${businessName} — no generic advice
- Mix quick wins (< 1 hour) with medium tasks (1-3 hours)
- Actions must be completable by a non-technical business owner`;

    try {
      const result = await generateJson<Record<string, unknown>>({
        system: "You are a personal SEO coach. Return only valid JSON. Be specific, direct, and encouraging. Never give generic advice.",
        prompt,
      });

      const [saved] = await db
        .insert(seoWatchdogTable)
        .values({
          projectId: id,
          weekOf: String(result.weekOf ?? weekOf),
          headline: String(result.headline ?? "Your SEO actions for this week"),
          summary: String(result.summary ?? ""),
          actions: result.actions ?? [],
          progressNote: result.progressNote ? String(result.progressNote) : null,
        })
        .onConflictDoUpdate({
          target: seoWatchdogTable.projectId,
          set: {
            weekOf: String(result.weekOf ?? weekOf),
            headline: String(result.headline ?? ""),
            summary: String(result.summary ?? ""),
            actions: result.actions ?? [],
            progressNote: result.progressNote ? String(result.progressNote) : null,
            updatedAt: new Date(),
          },
        })
        .returning();

      res.json(saved);
    } catch (err) {
      req.log.error({ err }, "SEO watchdog generation failed");
      res.status(500).json({ error: "Failed to generate SEO coaching plan. Please try again." });
    }
  },
);

export default router;

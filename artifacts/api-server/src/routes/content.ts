import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { contentTable, socialPostsTable, emailCampaignsTable, adCreativesTable, activityTable } from "@workspace/db";
import { consumeTrialQuota } from "../lib/trialLimits.js";
import { getGroundingContext } from "../lib/projectContext.js";
import { generateSocialPosts, generateEmailCampaign, type SocialPostResult, type EmailResult } from "../lib/contentGenerators.js";
import {
  ListContentParams,
  GenerateContentParams,
  GenerateContentBody,
  GetContentParams,
  DeleteContentParams,
  ListSocialPostsParams,
  GenerateSocialPostsParams,
  GenerateSocialPostsBody,
  GetContentCalendarParams,
  ListEmailsParams,
  GenerateEmailsParams,
  GenerateEmailsBody,
  SendEmailParams,
  SendEmailBody,
  ListAdsParams,
  GenerateAdsParams,
  GenerateAdsBody,
} from "@workspace/api-zod";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
import { recordGeneratedBatch, recordGenerated, hashContent } from "../lib/contentIntegrity.js";
import { Resend } from "resend";

const router: IRouter = Router();

router.param("id", requireProjectOwnershipParam());

// Content
router.get("/projects/:id/content", async (req, res): Promise<void> => {
  const params = ListContentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const items = await db.select().from(contentTable).where(eq(contentTable.projectId, params.data.id)).orderBy(desc(contentTable.createdAt));
  res.json(items.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })));
});

router.post("/projects/:id/content", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = GenerateContentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateContentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const type = parsed.data.type;
  const count = parsed.data.count ?? 3;

  const templates: Record<string, Array<{ title: string; body: string; metaDescription: string; seoKeywords: string }>> = {
    blog: [
      { title: "10 Ways AI is Replacing Traditional Marketing Teams", body: "## Introduction\n\nThe marketing landscape is undergoing a seismic shift. AI-powered platforms are now capable of executing tasks that once required entire departments...", metaDescription: "Discover how AI marketing tools are transforming how businesses grow in 2024.", seoKeywords: "AI marketing, marketing automation, AI content generation, replace marketing team" },
      { title: "The Complete Guide to AI-Powered Video Marketing in 2024", body: "## Why Video Marketing Wins\n\nVideo content generates 1200% more shares than text and image content combined...", metaDescription: "Learn how to use AI to create professional marketing videos at scale without a production team.", seoKeywords: "AI video marketing, video generation AI, automated video creation" },
      { title: "How to Build a Full Marketing Funnel with AI in 30 Minutes", body: "## From Zero to Full Funnel\n\nBuilding a marketing funnel used to take weeks and cost thousands of dollars...", metaDescription: "Step-by-step guide to building a complete marketing funnel using AI tools.", seoKeywords: "AI marketing funnel, automated marketing, AI lead generation" },
    ],
    whitepaper: [
      { title: "The Future of B2B Marketing: AI-Driven Growth Strategies", body: "## Executive Summary\n\nThis whitepaper examines how forward-thinking B2B companies are leveraging artificial intelligence to compress the traditional marketing timeline from months to minutes...", metaDescription: "In-depth analysis of AI-driven growth strategies for B2B companies.", seoKeywords: "B2B AI marketing, AI growth strategy, B2B automation" },
    ],
    "case-study": [
      { title: "How TechCorp Grew 340% in 90 Days Using AI Marketing", body: "## The Challenge\n\nTechCorp was struggling to compete against well-funded competitors with larger marketing teams...", metaDescription: "Real case study showing 340% growth using AI-powered marketing automation.", seoKeywords: "AI marketing results, marketing case study, growth marketing AI" },
    ],
  };

  const selectedTemplates = templates[type] ?? templates.blog;
  const toCreate = selectedTemplates.slice(0, count);

  const scores = [78, 84, 71, 89, 65, 92];
  const inserted = await db.insert(contentTable).values(
    toCreate.map((t, i) => ({
      projectId,
      type,
      status: "draft",
      hookStrength: scores[i % scores.length],
      conversionPotential: scores[(i + 1) % scores.length],
      engagementPotential: scores[(i + 2) % scores.length],
      viralPotential: scores[(i + 3) % scores.length],
      ...t,
    }))
  ).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "content",
    description: `Generated ${inserted.length} ${type} content pieces`,
  });

  res.json(inserted.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })));
});

router.get("/projects/:id/content/:contentId", async (req, res): Promise<void> => {
  const params = GetContentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db.select().from(contentTable).where(eq(contentTable.id, params.data.contentId));
  if (!item) { res.status(404).json({ error: "Content not found" }); return; }
  res.json({ ...item, createdAt: item.createdAt.toISOString() });
});

router.delete("/projects/:id/content/:contentId", async (req, res): Promise<void> => {
  const params = DeleteContentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [item] = await db.delete(contentTable).where(eq(contentTable.id, params.data.contentId)).returning();
  if (!item) { res.status(404).json({ error: "Content not found" }); return; }
  res.sendStatus(204);
});

// Social Posts
router.get("/projects/:id/social-posts", async (req, res): Promise<void> => {
  const params = ListSocialPostsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const posts = await db.select().from(socialPostsTable).where(eq(socialPostsTable.projectId, params.data.id)).orderBy(desc(socialPostsTable.createdAt));
  res.json(posts.map(p => ({
    ...p,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  })));
});

router.post("/projects/:id/social-posts", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = GenerateSocialPostsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateSocialPostsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const platforms = parsed.data.platforms;
  const perPlatform = parsed.data.count ?? 2;

  const ctx = await getGroundingContext(projectId);
  if (!ctx) {
    res.status(409).json({ error: "Run business analysis before generating social posts" });
    return;
  }

  const requestedTotal = platforms.length * perPlatform;
  const quota = await consumeTrialQuota(projectId, "social_posts", requestedTotal);
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  let postResults: SocialPostResult[];
  try {
    postResults = await generateSocialPosts(ctx, { platforms, perPlatform, prompt: parsed.data.prompt });
  } catch (err) {
    req.log.error({ err }, "Social post generation failed");
    res.status(502).json({ error: "Failed to generate social posts" });
    return;
  }

  const toInsert = postResults.map(p => ({
    projectId,
    status: "draft" as const,
    platform: p.platform,
    caption: p.caption,
    hashtags: p.hashtags,
    cta: p.cta,
  }));

  const inserted = await db.insert(socialPostsTable).values(toInsert).returning();

  await recordGeneratedBatch({
    userId: req.project!.ownerId!,
    projectId,
    contentType: "social_posts",
    items: inserted.map((p) => ({
      id: p.id,
      data: { platform: p.platform, caption: p.caption, hashtags: p.hashtags, cta: p.cta },
      summary: `${p.platform} social post`,
    })),
  });

  await db.insert(activityTable).values({
    projectId,
    type: "social",
    description: `Generated ${inserted.length} social posts across ${platforms.join(", ")}`,
  });

  res.json(inserted.map(p => ({
    ...p,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  })));
});

router.get("/projects/:id/content-calendar", async (req, res): Promise<void> => {
  const params = GetContentCalendarParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const posts = await db.select().from(socialPostsTable).where(eq(socialPostsTable.projectId, params.data.id)).orderBy(desc(socialPostsTable.createdAt));

  const calendar: Record<string, typeof posts> = {};
  const today = new Date();
  posts.forEach((post, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() + Math.floor(i / 2));
    const key = date.toISOString().split("T")[0];
    if (!calendar[key]) calendar[key] = [];
    calendar[key].push(post);
  });

  const result = Object.entries(calendar).map(([date, calPosts]) => ({
    date,
    posts: calPosts.map(p => ({
      ...p,
      scheduledAt: p.scheduledAt?.toISOString() ?? null,
      publishedAt: p.publishedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
  }));

  res.json(result);
});

// Emails
router.get("/projects/:id/emails", async (req, res): Promise<void> => {
  const params = ListEmailsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const emails = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.projectId, params.data.id)).orderBy(desc(emailCampaignsTable.createdAt));
  res.json(emails.map(e => ({ ...e, openRate: e.openRate ? Number(e.openRate) : null, clickRate: e.clickRate ? Number(e.clickRate) : null, sentAt: e.sentAt?.toISOString() ?? null, createdAt: e.createdAt.toISOString() })));
});

router.post("/projects/:id/emails", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = GenerateEmailsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateEmailsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const type = parsed.data.type;

  const ctx = await getGroundingContext(projectId);
  if (!ctx) {
    res.status(409).json({ error: "Run business analysis before generating an email campaign" });
    return;
  }

  const quota = await consumeTrialQuota(projectId, "email_campaigns", 1);
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  let emailResult: EmailResult;
  try {
    emailResult = await generateEmailCampaign(ctx, { type, subjectHint: parsed.data.subject, prompt: parsed.data.prompt });
  } catch (err) {
    req.log.error({ err }, "Email campaign generation failed");
    res.status(502).json({ error: "Failed to generate email campaign" });
    return;
  }

  const [email] = await db.insert(emailCampaignsTable).values({
    projectId,
    type,
    status: "draft",
    openRate: String((Math.random() * 20 + 20).toFixed(1)),
    clickRate: String((Math.random() * 8 + 3).toFixed(1)),
    ...emailResult,
  }).returning();

  if (email) {
    await recordGenerated({
      userId: req.project!.ownerId!,
      projectId,
      contentType: "email_campaign",
      contentId: String(email.id),
      contentHash: hashContent({ type: email.type, subject: email.subject, body: email.body }),
      summary: `${type} email: ${email.subject ?? "(no subject)"}`,
    });
  }

  await db.insert(activityTable).values({
    projectId,
    type: "email",
    description: `Generated ${type} email campaign`,
  });

  res.json({ ...email!, openRate: email!.openRate ? Number(email!.openRate) : null, clickRate: email!.clickRate ? Number(email!.clickRate) : null, createdAt: email!.createdAt.toISOString() });
});

router.post("/projects/:id/emails/:emailId/send", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = SendEmailParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = SendEmailBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { id: projectId, emailId } = params.data;
  const { recipients } = parsed.data;

  const [email] = await db.select().from(emailCampaignsTable).where(eq(emailCampaignsTable.id, emailId));
  if (!email || email.projectId !== projectId) { res.status(404).json({ error: "Email campaign not found" }); return; }
  if (email.status === "sent") { res.status(400).json({ error: "This campaign has already been sent" }); return; }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "Email sending is not configured (missing RESEND_API_KEY)" }); return; }

  const resend = new Resend(apiKey);

  const validEmails = recipients.filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (validEmails.length === 0) { res.status(400).json({ error: "No valid email addresses provided" }); return; }

  let failCount = 0;
  const batches: string[][] = [];
  for (let i = 0; i < validEmails.length; i += 50) {
    batches.push(validEmails.slice(i, i + 50));
  }

  for (const batch of batches) {
    const headers: Record<string, string> = { "X-Entity-Ref-ID": String(email.id) };
    if (email.previewText) headers["X-Preview-Text"] = email.previewText;
    const { error } = await resend.batch.send(
      batch.map(to => ({
        from: "GrowthForge AI <marketing@usegrowthforge.com>",
        to,
        subject: email.subject,
        text: email.body ?? email.subject,
        headers,
      }))
    );
    if (error) {
      req.log.error({ error, emailId }, "Resend batch send failed");
      failCount += batch.length;
    }
  }

  const sentCount = validEmails.length - failCount;
  const [updated] = await db.update(emailCampaignsTable)
    .set({ status: "sent", sentAt: new Date(), recipientCount: sentCount })
    .where(eq(emailCampaignsTable.id, emailId))
    .returning();

  await db.insert(activityTable).values({
    projectId,
    type: "email",
    description: `Sent "${email.subject}" to ${sentCount} recipient${sentCount !== 1 ? "s" : ""}${failCount > 0 ? ` (${failCount} failed)` : ""}`,
  });

  res.json({
    ...updated!,
    openRate: updated!.openRate ? Number(updated!.openRate) : null,
    clickRate: updated!.clickRate ? Number(updated!.clickRate) : null,
    sentAt: updated!.sentAt?.toISOString() ?? null,
    createdAt: updated!.createdAt.toISOString(),
  });
});

// Ads
router.get("/projects/:id/ads", async (req, res): Promise<void> => {
  const params = ListAdsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const ads = await db.select().from(adCreativesTable).where(eq(adCreativesTable.projectId, params.data.id)).orderBy(desc(adCreativesTable.createdAt));
  res.json(ads.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

router.post("/projects/:id/ads", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = GenerateAdsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateAdsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const platform = parsed.data.platform;
  const count = parsed.data.count ?? 3;

  // These are still hardcoded templates today (no AI cost), but capped anyway so this
  // endpoint stays within the trial spend budget if it's ever wired to real AI generation
  // (matching how the agent-chat "ads" intent already calls generateAdCreatives).
  const quota = await consumeTrialQuota(projectId, "ads", count);
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  const adTemplates = [
    { headline: "Paste Your URL. Get Your Marketing Team.", description: "AI analyzes your business, generates content, creates videos, and launches campaigns automatically. Replace your marketing agency.", cta: "Start Free Analysis", type: "image", hookStrength: 89, conversionPotential: 84 },
    { headline: "Your Competitors Are Using AI. Are You?", description: "GrowthForge AI creates 9 videos, 30 social posts, email sequences, and full ad campaigns from just your website URL. Try free.", cta: "Try It Free", type: "image", hookStrength: 82, conversionPotential: 79 },
    { headline: "Stop Paying $10K/Month for Marketing Agencies", description: "AI-powered marketing platform. Competitive analysis, content creation, video production, campaign management — all automated.", cta: "See Pricing", type: "video", hookStrength: 91, conversionPotential: 87 },
    { headline: "5 Minutes to Your Full Marketing Department", description: "Enter your website URL. Our AI builds your business intelligence, competitor analysis, content strategy, and campaign plan instantly.", cta: "Get Started Free", type: "image", hookStrength: 85, conversionPotential: 81 },
  ];

  const toInsert = adTemplates.slice(0, count).map(t => ({ projectId, platform, status: "draft", ...t }));
  const inserted = await db.insert(adCreativesTable).values(toInsert).returning();

  await recordGeneratedBatch({
    userId: req.project!.ownerId!,
    projectId,
    contentType: "ad_creatives",
    items: inserted.map((a) => ({
      id: a.id,
      data: { platform: a.platform, headline: a.headline, description: a.description, cta: a.cta },
      summary: `${platform} ad: ${a.headline}`,
    })),
  });

  await db.insert(activityTable).values({
    projectId,
    type: "ads",
    description: `Generated ${inserted.length} ${platform} ad creatives`,
  });

  res.json(inserted.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

export default router;

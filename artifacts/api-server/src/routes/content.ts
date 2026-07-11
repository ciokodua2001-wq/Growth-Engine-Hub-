import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { contentTable, socialPostsTable, emailCampaignsTable, adCreativesTable, activityTable, metaConnectionsTable } from "@workspace/db";
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
  GetSocialPostStatsParams,
  ListEmailsParams,
  GenerateEmailsParams,
  GenerateEmailsBody,
  SendEmailParams,
  SendEmailBody,
  ListAdsParams,
  GenerateAdsParams,
  GenerateAdsBody,
  GetMetaConnectionParams,
  DisconnectMetaParams,
  PublishSocialPostParams,
  PublishSocialPostBody,
} from "@workspace/api-zod";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
import { recordGeneratedBatch, recordGenerated, hashContent } from "../lib/contentIntegrity.js";
import { Resend } from "resend";
import { decryptToken, encryptToken, isEncryptedFormat } from "../lib/tokenCrypto.js";

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
    statsUpdatedAt: p.statsUpdatedAt?.toISOString() ?? null,
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

router.get("/projects/:id/emails/send-config", async (req, res): Promise<void> => {
  res.json({
    configured: !!process.env.RESEND_API_KEY,
    fromAddress: "marketing@usegrowthforge.com",
  });
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

  // Require completed business analysis before sending (same gate as generation)
  const ctx = await getGroundingContext(projectId);
  if (!ctx) {
    res.status(409).json({ error: "Run business analysis before sending email campaigns" });
    return;
  }

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

  // Only mark as sent if at least one recipient succeeded — preserves retry ability on full failure
  let updated: typeof email | undefined;
  if (sentCount > 0) {
    const [row] = await db.update(emailCampaignsTable)
      .set({ status: "sent", sentAt: new Date(), recipientCount: sentCount })
      .where(eq(emailCampaignsTable.id, emailId))
      .returning();
    updated = row;

    await db.insert(activityTable).values({
      projectId,
      type: "email",
      description: `Sent "${email.subject}" to ${sentCount} recipient${sentCount !== 1 ? "s" : ""}${failCount > 0 ? ` (${failCount} failed)` : ""}`,
    });
  } else {
    // Full failure — don't mark sent, surface the error so user can retry
    res.status(502).json({
      error: "All sends failed. Check that marketing@usegrowthforge.com is verified in your Resend dashboard.",
      sentCount: 0,
      failCount,
    });
    return;
  }

  res.json({
    ...updated!,
    openRate: updated!.openRate ? Number(updated!.openRate) : null,
    clickRate: updated!.clickRate ? Number(updated!.clickRate) : null,
    sentAt: updated!.sentAt?.toISOString() ?? null,
    createdAt: updated!.createdAt.toISOString(),
    sentCount,
    failCount,
  });
});

// Meta connection status
router.get("/projects/:id/meta-connection", async (req, res): Promise<void> => {
  const params = GetMetaConnectionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [conn] = await db.select().from(metaConnectionsTable).where(eq(metaConnectionsTable.projectId, params.data.id));
  if (!conn) {
    res.json({ connected: false, pageId: null, pageName: null, instagramAccountId: null, connectedAt: null });
    return;
  }
  res.json({
    connected: true,
    pageId: conn.pageId,
    pageName: conn.pageName,
    instagramAccountId: conn.instagramAccountId,
    connectedAt: conn.connectedAt.toISOString(),
  });
});

router.delete("/projects/:id/meta-connection", async (req, res): Promise<void> => {
  const params = DisconnectMetaParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  await db.delete(metaConnectionsTable).where(eq(metaConnectionsTable.projectId, params.data.id));
  res.sendStatus(204);
});

// Fetch engagement stats for a published social post from Meta Graph API
router.get("/projects/:id/social-posts/:postId/stats", async (req, res): Promise<void> => {
  const params = GetSocialPostStatsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const { id: projectId, postId } = params.data;

  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, postId));
  if (!post || post.projectId !== projectId) { res.status(404).json({ error: "Social post not found" }); return; }
  if (post.status !== "published" || !post.externalPostId) {
    res.status(400).json({ error: "Post is not published or has no external ID" });
    return;
  }

  const [conn] = await db.select().from(metaConnectionsTable).where(eq(metaConnectionsTable.projectId, projectId));
  if (!conn) { res.status(404).json({ error: "No Meta account connected" }); return; }

  let pageToken: string;
  if (!isEncryptedFormat(conn.pageAccessToken)) {
    pageToken = conn.pageAccessToken;
  } else {
    try {
      pageToken = decryptToken(conn.pageAccessToken);
    } catch (err) {
      req.log.error({ err }, "Failed to decrypt Meta page access token");
      res.status(500).json({ error: "Could not read Meta connection credentials" });
      return;
    }
  }

  // Fetch insights from Graph API — platform-specific field shapes
  let likes: number | null = null;
  let comments: number | null = null;
  let reach: number | null = null;

  try {
    if (post.platform === "instagram") {
      // Instagram Media API uses flat fields: like_count, comments_count
      const igUrl = `https://graph.facebook.com/v20.0/${post.externalPostId}?fields=like_count,comments_count&access_token=${pageToken}`;
      const igRes = await fetch(igUrl);
      const igData = await igRes.json() as {
        like_count?: number;
        comments_count?: number;
        error?: { message: string };
      };

      if (igData.error) {
        req.log.error({ igData, postId }, "Graph API returned error for Instagram post stats");
        res.status(502).json({ error: igData.error.message ?? "Graph API returned an error" });
        return;
      }

      likes = igData.like_count ?? null;
      comments = igData.comments_count ?? null;
      // Instagram reach is not available via this endpoint without Business Discovery API
    } else {
      // Facebook Page post: use edge summary for likes/comments + insights for reach
      const fields = "likes.summary(true),comments.summary(true)";
      const fbUrl = `https://graph.facebook.com/v20.0/${post.externalPostId}?fields=${fields}&access_token=${pageToken}`;
      const fbRes = await fetch(fbUrl);
      const fbData = await fbRes.json() as {
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
        error?: { message: string };
      };

      if (fbData.error) {
        req.log.error({ fbData, postId }, "Graph API returned error for Facebook post stats");
        res.status(502).json({ error: fbData.error.message ?? "Graph API returned an error" });
        return;
      }

      likes = fbData.likes?.summary?.total_count ?? null;
      comments = fbData.comments?.summary?.total_count ?? null;

      // Reach: post_impressions_unique from the insights endpoint
      const insightsUrl = `https://graph.facebook.com/v20.0/${post.externalPostId}/insights?metric=post_impressions_unique&access_token=${pageToken}`;
      const insightsRes = await fetch(insightsUrl);
      const insightsData = await insightsRes.json() as {
        data?: Array<{ values?: Array<{ value?: number }> }>;
        error?: { message: string };
      };

      if (!insightsData.error && insightsData.data?.[0]?.values?.[0]?.value !== undefined) {
        reach = insightsData.data[0].values[0].value;
      }
    }
  } catch (err) {
    req.log.error({ err }, "Meta Graph API stats call failed");
    res.status(502).json({ error: "Failed to reach Meta Graph API" });
    return;
  }

  // Cache the fetched stats on the post row
  const now = new Date();
  await db
    .update(socialPostsTable)
    .set({ statsLikes: likes, statsComments: comments, statsReach: reach, statsUpdatedAt: now })
    .where(eq(socialPostsTable.id, postId));

  res.json({
    postId: post.id,
    externalPostId: post.externalPostId,
    likes,
    comments,
    reach,
    statsUpdatedAt: now.toISOString(),
  });
});

// Publish social post to Meta (Facebook / Instagram)
router.post("/projects/:id/social-posts/:postId/publish", async (req, res): Promise<void> => {
  const params = PublishSocialPostParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = PublishSocialPostBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { id: projectId, postId } = params.data;
  const { platform } = body.data;

  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, postId));
  if (!post || post.projectId !== projectId) { res.status(404).json({ error: "Social post not found" }); return; }
  if (post.status === "published") { res.status(400).json({ error: "Post already published" }); return; }

  const [conn] = await db.select().from(metaConnectionsTable).where(eq(metaConnectionsTable.projectId, projectId));
  if (!conn) { res.status(404).json({ error: "No Meta account connected. Connect Facebook first." }); return; }

  if (platform === "instagram" && !conn.instagramAccountId) {
    res.status(400).json({ error: "No Instagram Business Account linked to the connected Facebook Page." });
    return;
  }

  const content = [post.caption, post.hashtags, post.cta].filter(Boolean).join("\n\n");

  // Resolve the page access token — migrating legacy plaintext rows on first read.
  let pageToken: string;
  if (!isEncryptedFormat(conn.pageAccessToken)) {
    // Row predates encryption — treat the stored value as plaintext,
    // re-encrypt it in-place so all future reads go through the cipher.
    pageToken = conn.pageAccessToken;
    try {
      const reEncrypted = encryptToken(pageToken);
      await db
        .update(metaConnectionsTable)
        .set({ pageAccessToken: reEncrypted })
        .where(eq(metaConnectionsTable.projectId, projectId));
      req.log.info({ projectId }, "Migrated plaintext Meta page token to encrypted form");
    } catch (encErr) {
      req.log.warn({ encErr }, "Could not re-encrypt legacy Meta token — will use plaintext for this request");
    }
  } else {
    try {
      pageToken = decryptToken(conn.pageAccessToken);
    } catch (err) {
      req.log.error({ err }, "Failed to decrypt Meta page access token");
      res.status(500).json({ error: "Could not read Meta connection credentials" });
      return;
    }
  }

  let externalPostId: string;
  try {
    if (platform === "facebook") {
      const url = `https://graph.facebook.com/v20.0/${conn.pageId}/feed`;
      const fbRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, access_token: pageToken }),
      });
      const fbData = await fbRes.json() as { id?: string; error?: { message: string } };
      if (!fbData.id) {
        req.log.error({ fbData }, "Facebook publish failed");
        res.status(502).json({ error: fbData.error?.message ?? "Facebook publish failed" });
        return;
      }
      externalPostId = fbData.id;
    } else {
      // Instagram: two-step (create container → publish)
      const igAccountId = conn.instagramAccountId!;

      const containerUrl = `https://graph.facebook.com/v20.0/${igAccountId}/media`;
      const containerRes = await fetch(containerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: content, media_type: "TEXT", access_token: pageToken }),
      });
      const containerData = await containerRes.json() as { id?: string; error?: { message: string } };
      if (!containerData.id) {
        req.log.error({ containerData }, "Instagram container creation failed");
        res.status(502).json({ error: containerData.error?.message ?? "Instagram media container failed" });
        return;
      }

      const publishUrl = `https://graph.facebook.com/v20.0/${igAccountId}/media_publish`;
      const publishRes = await fetch(publishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: containerData.id, access_token: pageToken }),
      });
      const publishData = await publishRes.json() as { id?: string; error?: { message: string } };
      if (!publishData.id) {
        req.log.error({ publishData }, "Instagram publish failed");
        res.status(502).json({ error: publishData.error?.message ?? "Instagram publish failed" });
        return;
      }
      externalPostId = publishData.id;
    }
  } catch (err) {
    req.log.error({ err }, "Meta Graph API call failed");
    res.status(502).json({ error: "Failed to reach Meta Graph API" });
    return;
  }

  const [updated] = await db
    .update(socialPostsTable)
    .set({ status: "published", publishedAt: new Date(), externalPostId })
    .where(eq(socialPostsTable.id, postId))
    .returning();

  await db.insert(activityTable).values({
    projectId,
    type: "social",
    description: `Published "${post.caption.slice(0, 60)}…" to ${platform}`,
  });

  res.json({
    ...updated,
    scheduledAt: updated.scheduledAt?.toISOString() ?? null,
    publishedAt: updated.publishedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
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

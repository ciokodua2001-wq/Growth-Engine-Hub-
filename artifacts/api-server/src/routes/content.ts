import { Router, type IRouter } from "express";
import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { contentTable, socialPostsTable, emailCampaignsTable, adCreativesTable, activityTable, metaConnectionsTable } from "@workspace/db";
import { consumeQuota } from "../lib/planLimits.js";
import { getGroundingContext } from "../lib/projectContext.js";
import { generateSocialPosts, generateEmailCampaign, generateContentPieces, type SocialPostResult, type EmailResult, type ContentPieceResult } from "../lib/contentGenerators.js";
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
  GetMetaStatusParams,
  GetMetaConnectionParams,
  DisconnectMetaParams,
  PublishSocialPostParams,
  PublishSocialPostBody,
} from "@workspace/api-zod";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
import { recordGeneratedBatch, recordGenerated, hashContent } from "../lib/contentIntegrity.js";
import { generateImageBuffer } from "@workspace/integrations-google-genai/image";
import { Resend } from "resend";
import { decryptToken, encryptToken, isEncryptedFormat } from "../lib/tokenCrypto.js";
import { publishPostToMeta } from "../lib/metaPublisher.js";
import { meetsMinPlan } from "../lib/planLimits.js";

const router: IRouter = Router();

// ── Social post image helper ───────────────────────────────────────────────────
// Generates an Imagen image for a social post and uploads it to object storage.
// Failures are non-fatal — the post is saved without an image rather than erroring.
const PLATFORM_IMAGE_SIZE: Record<string, "1024x1024" | "1536x1024" | "1024x1536"> = {
  instagram: "1024x1536",
  tiktok:    "1024x1536",
  linkedin:  "1536x1024",
  facebook:  "1536x1024",
  x:         "1024x1024",
};

async function generateAndUploadSocialImage(
  imagePrompt: string,
  platform: string,
  log: { warn: (obj: object, msg: string) => void },
): Promise<string | null> {
  try {
    const size = PLATFORM_IMAGE_SIZE[platform] ?? "1024x1024";
    const buffer = await generateImageBuffer(imagePrompt, size);
    // Store as a self-contained data URL — avoids object-storage signing failures in production
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (err) {
    log.warn({ err }, "Social post image generation failed — post saved without image");
    return null;
  }
}

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
  const count = Math.min(parsed.data.count ?? 1, 3);

  // Content Engine AI generation is a paid feature (Get-Going+).
  // Trial budget is at ~$0.440/$0.45 cap — long-form content generation
  // (~$0.030-0.060 per call) would breach it; see trialLimits.ts for details.
  if (!req.isPlatformOwner && !meetsMinPlan(req.project?.plan ?? "trial", "get-going")) {
    res.status(403).json({ error: "AI Content generation is available on the Get-Going plan and higher. Upgrade to unlock blog posts, whitepapers, case studies, and more — all grounded in your business." });
    return;
  }

  // Business analysis must be complete to ground the AI output
  const ctx = await getGroundingContext(projectId);
  if (!ctx) {
    res.status(409).json({ error: "Complete your business analysis first — the Content Engine uses your brand voice, ICP, and value proposition to write content specific to your business." });
    return;
  }

  let pieces: ContentPieceResult[];
  try {
    pieces = await generateContentPieces(ctx, { type, count, prompt: parsed.data.prompt, locale: parsed.data.targetLocale ?? undefined });
  } catch (err) {
    req.log.error({ err, projectId, type }, "Content Engine: AI generation failed");
    res.status(500).json({ error: "Content generation failed. Please try again." });
    return;
  }

  if (pieces.length === 0) {
    res.status(500).json({ error: "AI returned no content. Please try again." });
    return;
  }

  const inserted = await db.insert(contentTable).values(
    pieces.map(p => ({
      projectId,
      type,
      status: "draft",
      title: p.title,
      body: p.body,
      metaDescription: p.metaDescription,
      seoKeywords: p.seoKeywords,
      hookStrength: p.hookStrength,
      conversionPotential: p.conversionPotential,
      engagementPotential: p.engagementPotential,
      viralPotential: p.viralPotential ?? 0,
    }))
  ).returning();

  await recordGeneratedBatch({
    userId: req.project!.ownerId!,
    projectId,
    contentType: "content",
    items: inserted.map(c => ({
      id: c.id,
      data: { type, title: c.title, metaDescription: c.metaDescription },
      summary: `${type}: ${c.title}`,
    })),
  });

  await db.insert(activityTable).values({
    projectId,
    type: "content",
    description: `Generated ${inserted.length} AI-powered ${type} content piece${inserted.length !== 1 ? "s" : ""}`,
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
  const quota = await consumeQuota(projectId, "social_posts", requestedTotal);
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  let postResults: SocialPostResult[];
  try {
    postResults = await generateSocialPosts(ctx, { platforms, perPlatform, prompt: parsed.data.prompt, locale: parsed.data.targetLocale ?? undefined });
  } catch (err) {
    req.log.error({ err }, "Social post generation failed");
    res.status(502).json({ error: "Failed to generate social posts" });
    return;
  }

  // Generate one creative image per post in parallel.
  // Image failures are silently swallowed — posts are saved without images rather than failing.
  const imageUrls = await Promise.all(
    postResults.map(p =>
      p.imagePrompt
        ? generateAndUploadSocialImage(p.imagePrompt, p.platform.toLowerCase(), req.log)
        : Promise.resolve(null),
    ),
  );

  const toInsert = postResults.map((p, i) => ({
    projectId,
    status: "draft" as const,
    platform: p.platform,
    caption: p.caption,
    hashtags: p.hashtags,
    cta: p.cta,
    imageUrl: imageUrls[i] ?? null,
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

  const quota = await consumeQuota(projectId, "email_campaigns", 1);
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  let emailResult: EmailResult;
  try {
    emailResult = await generateEmailCampaign(ctx, { type, subjectHint: parsed.data.subject, prompt: parsed.data.prompt, locale: parsed.data.targetLocale ?? undefined });
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

  // ── Template variable substitution ───────────────────────────
  function substituteVars(text: string, r: { email: string; firstName?: string | null; lastName?: string | null; company?: string | null }): string {
    const firstName  = r.firstName  || "there";
    const lastName   = r.lastName   || "";
    const fullName   = [r.firstName, r.lastName].filter(Boolean).join(" ") || "there";
    const company    = r.company    || "";
    return text
      .replace(/\{\{first_name\}\}/gi,  firstName)
      .replace(/\{\{last_name\}\}/gi,   lastName)
      .replace(/\{\{full_name\}\}/gi,   fullName)
      .replace(/\{\{name\}\}/gi,        fullName)
      .replace(/\{\{company\}\}/gi,     company)
      .replace(/\{\{email\}\}/gi,       r.email);
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validRecipients = recipients.filter(r => EMAIL_RE.test(r.email));
  if (validRecipients.length === 0) { res.status(400).json({ error: "No valid email addresses provided" }); return; }

  let failCount = 0;
  const BATCH_SIZE = 50;
  for (let i = 0; i < validRecipients.length; i += BATCH_SIZE) {
    const batch = validRecipients.slice(i, i + BATCH_SIZE);
    const headers: Record<string, string> = { "X-Entity-Ref-ID": String(email.id) };
    if (email.previewText) headers["X-Preview-Text"] = email.previewText;
    const { error } = await resend.batch.send(
      batch.map(r => ({
        from: "GrowthForge AI <marketing@usegrowthforge.com>",
        to: r.email,
        subject: substituteVars(email.subject, r),
        text:    substituteVars(email.body ?? email.subject, r),
        headers,
      }))
    );
    if (error) {
      req.log.error({ error, emailId }, "Resend batch send failed");
      failCount += batch.length;
    }
  }

  const validEmails = validRecipients; // alias for count below

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
router.get("/projects/:id/meta/status", async (req, res): Promise<void> => {
  const params = GetMetaStatusParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [conn] = await db.select().from(metaConnectionsTable).where(eq(metaConnectionsTable.projectId, params.data.id)).limit(1);
  if (!conn) {
    res.json({ connected: false, decryptable: false });
    return;
  }

  let decryptable = false;
  try {
    if (!isEncryptedFormat(conn.pageAccessToken)) {
      decryptable = true;
    } else {
      decryptToken(conn.pageAccessToken);
      decryptable = true;
    }
  } catch {
    decryptable = false;
  }

  res.json({ connected: true, decryptable });
});

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
  if (!conn) {
    const hasCached = post.statsLikes != null || post.statsComments != null || post.statsReach != null;
    if (hasCached) {
      res.json({
        postId: post.id,
        externalPostId: post.externalPostId,
        likes: post.statsLikes ?? null,
        comments: post.statsComments ?? null,
        reach: post.statsReach ?? null,
        statsUpdatedAt: post.statsUpdatedAt?.toISOString() ?? null,
        cached: true,
      });
      return;
    }
    res.status(404).json({ error: "No Meta account connected" });
    return;
  }

  let pageToken: string;
  if (!isEncryptedFormat(conn.pageAccessToken)) {
    pageToken = conn.pageAccessToken;
  } else {
    try {
      pageToken = decryptToken(conn.pageAccessToken);
    } catch (err) {
      req.log.error({ err }, "Failed to decrypt Meta page access token");
      res.status(500).json({ error: "Your Facebook connection credentials could not be read. Please reconnect your Facebook account and try again." });
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

// GraphApiError and MetaApiShapeError are imported from lib/metaApiSchemas.ts

// Publish social post to Meta (Facebook / Instagram)
//
// Idempotency design:
//   1. externalPostId guard — if the Graph API call already succeeded on a prior attempt
//      but the subsequent DB update timed out, externalPostId is already set. We detect
//      this and complete the DB state without calling the Graph API again (no duplicate post).
//   2. Optimistic concurrency lock — we atomically transition status draft → publishing
//      before the API call. Concurrent requests find no matching draft row and get 409.
//   3. Failure classification — only definitive Graph API rejections (GraphApiError) roll
//      the post back to "draft". Network/transport errors are ambiguous: Meta may have
//      already accepted the request, so the post stays "publishing" and the user is told
//      to check their page before retrying. This prevents duplicate posts on retry.
//   4. Post-publish DB write resilience — after a successful Graph API call the externalPostId
//      is written with up to 3 attempts. If all fail the post stays "publishing" with the
//      externalPostId logged so it can be recovered; the next retry hits the externalPostId
//      guard (1) and completes the DB state without calling Meta again.
//   Note: Meta's Graph API does not support idempotency keys for feed/media publish
//   endpoints. The externalPostId check (1) and the atomic status lock (2) together
//   provide equivalent application-level deduplication guarantees.
router.post("/projects/:id/social-posts/:postId/publish", async (req, res): Promise<void> => {
  const params = PublishSocialPostParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = PublishSocialPostBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { id: projectId, postId } = params.data;
  const { platform } = body.data;

  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, postId));
  if (!post || post.projectId !== projectId) { res.status(404).json({ error: "Social post not found" }); return; }

  // Guard 1: externalPostId already set means the Graph API call succeeded on a previous
  // attempt but the DB update never completed (e.g. request timed out mid-flight).
  // Idempotently complete the DB state without calling Meta again.
  if (post.externalPostId) {
    if (post.status !== "published") {
      const [fixed] = await db
        .update(socialPostsTable)
        .set({ status: "published", publishedAt: post.publishedAt ?? new Date() })
        .where(eq(socialPostsTable.id, postId))
        .returning();
      res.json({
        ...fixed,
        scheduledAt: fixed.scheduledAt?.toISOString() ?? null,
        publishedAt: fixed.publishedAt?.toISOString() ?? null,
        createdAt: fixed.createdAt.toISOString(),
      });
    } else {
      res.status(400).json({ error: "Post already published" });
    }
    return;
  }

  if (post.status === "published") {
    res.status(400).json({ error: "Post already published" });
    return;
  }

  if (post.status === "publishing") {
    res.status(409).json({ error: "A publish is already in progress for this post. Please try again in a moment." });
    return;
  }

  // Guard 2: atomically claim the publish slot — transition draft → publishing only when
  // status is still "draft" AND externalPostId is still NULL. Any concurrent request will
  // find no matching row and be rejected with 409 before reaching the Graph API.
  const [locked] = await db
    .update(socialPostsTable)
    .set({ status: "publishing", publishingAt: new Date() })
    .where(and(
      eq(socialPostsTable.id, postId),
      eq(socialPostsTable.status, "draft"),
      isNull(socialPostsTable.externalPostId),
    ))
    .returning();

  if (!locked) {
    res.status(409).json({ error: "A publish is already in progress for this post" });
    return;
  }

  // Roll back to draft on any failure so the user can retry
  const rollbackToDraft = async () => {
    try {
      await db
        .update(socialPostsTable)
        .set({ status: "draft", publishingAt: null })
        .where(eq(socialPostsTable.id, postId));
    } catch (rbErr) {
      req.log.error({ rbErr, postId }, "Failed to roll back publishing status to draft");
    }
  };

  const [conn] = await db.select().from(metaConnectionsTable).where(eq(metaConnectionsTable.projectId, projectId));
  if (!conn) {
    await rollbackToDraft();
    res.status(404).json({ error: "No Meta account connected. Connect Facebook first." });
    return;
  }

  if (platform === "instagram" && !conn.instagramAccountId) {
    await rollbackToDraft();
    res.status(400).json({ error: "No Instagram Business Account linked to the connected Facebook Page." });
    return;
  }

  const content = [post.caption, post.hashtags, post.cta].filter(Boolean).join("\n\n");

  // Resolve the page access token — migrating legacy plaintext rows on first read.
  let pageToken: string;
  if (!isEncryptedFormat(conn.pageAccessToken)) {
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
      await rollbackToDraft();
      req.log.error({ err }, "Failed to decrypt Meta page access token");
      res.status(500).json({ error: "Your Facebook connection credentials could not be read. Please reconnect your Facebook account and try again." });
      return;
    }
  }

  const result = await publishPostToMeta(
    {
      postId,
      platform: platform as "facebook" | "instagram",
      content,
      pageToken,
      pageId: conn.pageId,
      instagramAccountId: conn.instagramAccountId ?? null,
    },
    req.log,
  );

  if (!result.ok) {
    if (result.rollback) await rollbackToDraft();
    const statusCode = result.externalPostId ? 500 : 502;
    res.status(statusCode).json({
      error: result.message,
      ...(result.externalPostId ? { externalPostId: result.externalPostId } : {}),
    });
    return;
  }

  await db.insert(activityTable).values({
    projectId,
    type: "social",
    description: `Published "${post.caption.slice(0, 60)}…" to ${platform}`,
  });

  const [finalPost] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, postId));
  res.json({
    ...finalPost,
    scheduledAt: finalPost.scheduledAt?.toISOString() ?? null,
    publishedAt: finalPost.publishedAt?.toISOString() ?? null,
    createdAt: finalPost.createdAt.toISOString(),
  });
});

// Schedule a social post for future auto-publishing (Get-Going+ only)
// The scheduled publisher (lib/scheduledPublisher.ts) picks these up every minute and
// publishes them to Meta automatically. Non-Meta platforms (LinkedIn, TikTok, X) keep
// the scheduledAt as a reminder but are not auto-published.
router.patch("/projects/:id/social-posts/:postId/schedule", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = PublishSocialPostParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (!req.isPlatformOwner && !meetsMinPlan(req.project?.plan ?? "trial", "get-going")) {
    res.status(403).json({ error: "Social Scheduling is available on the Get-Going plan and higher. Upgrade to unlock this feature." });
    return;
  }

  const { id: projectId, postId } = params.data;
  const { scheduledAt: scheduledAtRaw } = req.body as { scheduledAt?: unknown };
  if (typeof scheduledAtRaw !== "string" || !scheduledAtRaw) {
    res.status(400).json({ error: "scheduledAt is required" });
    return;
  }
  const scheduledAt = new Date(scheduledAtRaw);
  if (isNaN(scheduledAt.getTime())) {
    res.status(400).json({ error: "scheduledAt must be a valid date" });
    return;
  }
  if (scheduledAt <= new Date()) {
    res.status(400).json({ error: "Scheduled time must be in the future" });
    return;
  }

  const [post] = await db.select().from(socialPostsTable).where(
    and(eq(socialPostsTable.id, postId), eq(socialPostsTable.projectId, projectId))
  );
  if (!post) { res.status(404).json({ error: "Social post not found" }); return; }
  if (post.status !== "draft") { res.status(400).json({ error: "Only draft posts can be scheduled" }); return; }

  const [updated] = await db
    .update(socialPostsTable)
    .set({ scheduledAt })
    .where(eq(socialPostsTable.id, postId))
    .returning();

  res.json({
    ...updated,
    scheduledAt: updated.scheduledAt?.toISOString() ?? null,
    publishedAt: updated.publishedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  });
});

// Remove the scheduled time from a social post (Get-Going+ only)
router.delete("/projects/:id/social-posts/:postId/schedule", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = PublishSocialPostParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (!req.isPlatformOwner && !meetsMinPlan(req.project?.plan ?? "trial", "get-going")) {
    res.status(403).json({ error: "Social Scheduling is available on the Get-Going plan and higher." });
    return;
  }

  const { id: projectId, postId } = params.data;

  const [post] = await db.select().from(socialPostsTable).where(
    and(eq(socialPostsTable.id, postId), eq(socialPostsTable.projectId, projectId))
  );
  if (!post) { res.status(404).json({ error: "Social post not found" }); return; }
  if (post.status !== "draft") { res.status(400).json({ error: "Only draft posts can be unscheduled" }); return; }

  const [updated] = await db
    .update(socialPostsTable)
    .set({ scheduledAt: null })
    .where(eq(socialPostsTable.id, postId))
    .returning();

  res.json({
    ...updated,
    scheduledAt: null,
    publishedAt: updated.publishedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  });
});

// Email scheduling (Get-Going+ only) — sets/clears scheduledAt on an email campaign.
// The scheduled publisher cron picks these up and notifies the owner when it's time to send.
router.patch("/projects/:id/emails/:emailId/schedule", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = SendEmailParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  if (!req.isPlatformOwner && !meetsMinPlan(req.project?.plan ?? "trial", "get-going")) {
    res.status(403).json({ error: "Email Scheduling is available on the Get-Going plan and higher. Upgrade to unlock this feature." });
    return;
  }

  const { id: projectId, emailId } = params.data;
  const { scheduledAt: scheduledAtRaw } = req.body as { scheduledAt?: unknown };
  if (typeof scheduledAtRaw !== "string" || !scheduledAtRaw) {
    res.status(400).json({ error: "scheduledAt is required" }); return;
  }

  const scheduledAt = new Date(scheduledAtRaw);
  if (isNaN(scheduledAt.getTime()) || scheduledAt <= new Date()) {
    res.status(400).json({ error: "scheduledAt must be a valid future datetime" }); return;
  }

  const [email] = await db.select().from(emailCampaignsTable).where(
    and(eq(emailCampaignsTable.id, emailId), eq(emailCampaignsTable.projectId, projectId))
  );
  if (!email) { res.status(404).json({ error: "Email campaign not found" }); return; }
  if (email.status === "sent") { res.status(400).json({ error: "Cannot schedule a sent email campaign" }); return; }

  const [updated] = await db
    .update(emailCampaignsTable)
    .set({ scheduledAt })
    .where(eq(emailCampaignsTable.id, emailId))
    .returning();

  res.json({
    ...updated,
    scheduledAt: updated.scheduledAt?.toISOString() ?? null,
    sentAt: updated.sentAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  });
});

router.delete("/projects/:id/emails/:emailId/schedule", requireActiveSubscription, async (req, res): Promise<void> => {
  const params = SendEmailParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const { id: projectId, emailId } = params.data;
  const [email] = await db.select().from(emailCampaignsTable).where(
    and(eq(emailCampaignsTable.id, emailId), eq(emailCampaignsTable.projectId, projectId))
  );
  if (!email) { res.status(404).json({ error: "Email campaign not found" }); return; }
  if (email.status === "sent") { res.status(400).json({ error: "Cannot unschedule a sent email campaign" }); return; }

  const [updated] = await db
    .update(emailCampaignsTable)
    .set({ scheduledAt: null })
    .where(eq(emailCampaignsTable.id, emailId))
    .returning();

  res.json({
    ...updated,
    scheduledAt: null,
    sentAt: updated.sentAt?.toISOString() ?? null,
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
  const quota = await consumeQuota(projectId, "ads", count);
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

import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { contentTable, socialPostsTable, emailCampaignsTable, adCreativesTable, activityTable } from "@workspace/db";
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
  ListAdsParams,
  GenerateAdsParams,
  GenerateAdsBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Content
router.get("/projects/:id/content", async (req, res): Promise<void> => {
  const params = ListContentParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const items = await db.select().from(contentTable).where(eq(contentTable.projectId, params.data.id)).orderBy(desc(contentTable.createdAt));
  res.json(items.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })));
});

router.post("/projects/:id/content", async (req, res): Promise<void> => {
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

router.post("/projects/:id/social-posts", async (req, res): Promise<void> => {
  const params = GenerateSocialPostsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateSocialPostsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const platforms = parsed.data.platforms;

  const postTemplates: Record<string, { caption: string; hashtags: string; cta: string }[]> = {
    linkedin: [
      { caption: "Most businesses spend 80% of their marketing budget on agency fees, tools, and headcount. We built an AI that replaces all of that for a fraction of the cost. Paste your URL. Get your marketing department.", hashtags: "#AI #Marketing #Growth #StartUp #SaaS", cta: "Try it free today — link in bio" },
      { caption: "We analyzed 1,000 competitor websites so you don't have to. Our AI identifies your market gaps, competitor weaknesses, and your best positioning opportunities in minutes.", hashtags: "#CompetitorAnalysis #MarketingStrategy #AI #GrowthHacking", cta: "Get your competitor report free" },
    ],
    instagram: [
      { caption: "Stop paying $10K/month for a marketing agency. Start using AI instead.", hashtags: "#AIMarketing #Entrepreneur #StartupLife #GrowthHacking #DigitalMarketing #MarketingTips", cta: "Link in bio for free trial" },
      { caption: "Your competitors are already using AI to create content while you read this.", hashtags: "#AIContent #Marketing #ContentCreation #SocialMediaMarketing #MarketingStrategy", cta: "Don't fall behind — try it free" },
    ],
    tiktok: [
      { caption: "POV: You paste your website URL and an AI builds your entire marketing department in 5 minutes. This is actually happening right now.", hashtags: "#AIMarketing #Entrepreneur #TechTok #BusinessTips #StartUpLife #Marketing", cta: "Try it free at the link" },
      { caption: "Replacing a $15K/month marketing team with AI — here's what happened after 30 days.", hashtags: "#AI #Marketing #Entrepreneur #BusinessGrowth #AITools #StartupTips", cta: "Full breakdown in bio" },
    ],
    x: [
      { caption: "Hot take: In 2 years, most small businesses won't have a marketing team. They'll have an AI platform that does it all — content, videos, ads, strategy, analytics — automatically.\n\nWe're building that platform right now.", hashtags: "#AI #Marketing #SaaS", cta: "" },
    ],
    facebook: [
      { caption: "What if you could paste your website URL and get an entire marketing department back in minutes?\n\nBusiness analysis. Competitor research. Content calendar. Email sequences. Ad campaigns. Video production.\n\nAll done by AI. All ready to launch.", hashtags: "#AIMarketing #SmallBusiness #GrowthMarketing #ContentMarketing", cta: "Get started free — see the link below" },
    ],
  };

  const toInsert = [];
  for (const platform of platforms) {
    const templates = postTemplates[platform.toLowerCase()] ?? postTemplates.linkedin;
    for (const t of templates) {
      toInsert.push({ projectId, platform, status: "draft", ...t });
    }
  }

  const inserted = await db.insert(socialPostsTable).values(toInsert).returning();

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
  res.json(emails.map(e => ({ ...e, openRate: e.openRate ? Number(e.openRate) : null, clickRate: e.clickRate ? Number(e.clickRate) : null, createdAt: e.createdAt.toISOString() })));
});

router.post("/projects/:id/emails", async (req, res): Promise<void> => {
  const params = GenerateEmailsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateEmailsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const type = parsed.data.type;

  const emailTemplates: Record<string, { subject: string; body: string; previewText: string }> = {
    welcome: { subject: "Welcome to [Company] — Here's How to Get Started", previewText: "Your journey to smarter marketing starts now", body: "Hi {{first_name}},\n\nWelcome aboard! You've just made the smartest marketing decision of the year.\n\nHere's what to do next:\n\n1. Complete your profile setup (2 minutes)\n2. Connect your first channel\n3. Watch your first AI analysis\n\nAny questions? Reply to this email — we read every one.\n\nBest,\nThe Team" },
    sales: { subject: "{{first_name}}, here's why [Company] is growing 40% faster than competitors", previewText: "The secret is simpler than you think", body: "Hi {{first_name}},\n\nI wanted to share something that might change how you think about marketing ROI.\n\nOur customers who use all three core features — AI analysis, video generation, and campaign management — are seeing an average of 40% faster growth compared to their previous approach.\n\nHere's why it works:\n\n✓ AI replaces hours of manual research\n✓ Video content drives 3x more engagement\n✓ Autonomous campaigns optimize 24/7\n\nWant to see your personalized growth projection? Reply 'SHOW ME' and I'll set up a 15-minute call.\n\nBest,\nThe Growth Team" },
    nurture: { subject: "The #1 mistake companies make with AI marketing (are you doing this?)", previewText: "Most businesses get this backwards", body: "Hi {{first_name}},\n\nI've talked to hundreds of founders this year. And there's one mistake I see over and over.\n\nThey use AI to automate what they're already doing instead of doing things they couldn't do before.\n\nExample: Using AI to write the same 3 blog posts faster.\n\nInstead of: Using AI to create 30 pieces of content a day, run competitor intelligence, produce videos, and launch ads — all simultaneously.\n\nThe businesses that win with AI aren't using it to go slightly faster. They're using it to operate at a completely different scale.\n\nThat's what we built GrowthForge to do.\n\nSee the difference: [Start Free Analysis]\n\nBest,\nThe Team" },
    reactivation: { subject: "{{first_name}}, we noticed you haven't logged in — here's what you're missing", previewText: "Big updates since you last visited", body: "Hi {{first_name}},\n\nWe've been busy. Since you last logged in, we've shipped:\n\n• AI Video Generation (create 9 videos in one click)\n• Competitor Intelligence Reports (10 competitors analyzed automatically)\n• Autonomous Mode (AI runs campaigns 24/7 without you)\n\nYour competitors might already be using these features.\n\nLog back in and see what's waiting for you: [Continue Your Analysis]\n\nBest,\nThe Team" },
  };

  const template = emailTemplates[type] ?? emailTemplates.welcome;

  const [email] = await db.insert(emailCampaignsTable).values({
    projectId,
    type,
    status: "draft",
    openRate: String((Math.random() * 20 + 20).toFixed(1)),
    clickRate: String((Math.random() * 8 + 3).toFixed(1)),
    ...template,
  }).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "email",
    description: `Generated ${type} email campaign`,
  });

  res.json({ ...email!, openRate: email!.openRate ? Number(email!.openRate) : null, clickRate: email!.clickRate ? Number(email!.clickRate) : null, createdAt: email!.createdAt.toISOString() });
});

// Ads
router.get("/projects/:id/ads", async (req, res): Promise<void> => {
  const params = ListAdsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const ads = await db.select().from(adCreativesTable).where(eq(adCreativesTable.projectId, params.data.id)).orderBy(desc(adCreativesTable.createdAt));
  res.json(ads.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

router.post("/projects/:id/ads", async (req, res): Promise<void> => {
  const params = GenerateAdsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateAdsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const platform = parsed.data.platform;
  const count = parsed.data.count ?? 3;

  const adTemplates = [
    { headline: "Paste Your URL. Get Your Marketing Team.", description: "AI analyzes your business, generates content, creates videos, and launches campaigns automatically. Replace your marketing agency.", cta: "Start Free Analysis", type: "image", hookStrength: 89, conversionPotential: 84 },
    { headline: "Your Competitors Are Using AI. Are You?", description: "GrowthForge AI creates 9 videos, 30 social posts, email sequences, and full ad campaigns from just your website URL. Try free.", cta: "Try It Free", type: "image", hookStrength: 82, conversionPotential: 79 },
    { headline: "Stop Paying $10K/Month for Marketing Agencies", description: "AI-powered marketing platform. Competitive analysis, content creation, video production, campaign management — all automated.", cta: "See Pricing", type: "video", hookStrength: 91, conversionPotential: 87 },
    { headline: "5 Minutes to Your Full Marketing Department", description: "Enter your website URL. Our AI builds your business intelligence, competitor analysis, content strategy, and campaign plan instantly.", cta: "Get Started Free", type: "image", hookStrength: 85, conversionPotential: 81 },
  ];

  const toInsert = adTemplates.slice(0, count).map(t => ({ projectId, platform, status: "draft", ...t }));
  const inserted = await db.insert(adCreativesTable).values(toInsert).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "ads",
    description: `Generated ${inserted.length} ${platform} ad creatives`,
  });

  res.json(inserted.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

export default router;

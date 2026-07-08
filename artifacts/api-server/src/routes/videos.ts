import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { videosTable, activityTable } from "@workspace/db";
import { consumeTrialQuota } from "../lib/trialLimits.js";
import {
  ListVideosParams,
  GenerateVideosParams,
  GenerateVideosBody,
  GetVideoParams,
  UpdateVideoParams,
  UpdateVideoBody,
  DeleteVideoParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects/:id/videos", async (req, res): Promise<void> => {
  const params = ListVideosParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const videos = await db.select().from(videosTable).where(eq(videosTable.projectId, params.data.id)).orderBy(desc(videosTable.createdAt));
  res.json(videos.map(v => ({ ...v, createdAt: v.createdAt.toISOString() })));
});

router.post("/projects/:id/videos", async (req, res): Promise<void> => {
  const params = GenerateVideosParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = GenerateVideosBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const projectId = params.data.id;
  const mode = parsed.data.mode;
  const count = parsed.data.count ?? (mode === "auto" ? 9 : 3);

  const videoTemplates = [
    { title: "Brand Story — Why We Built This", type: "promo", script: "HOOK: Most founders spend 80% of their time on marketing, not building.\n\nPROBLEM: Traditional marketing requires a team of 5-10 people and costs $150K+ per year.\n\nSOLUTION: We built an AI that replaces that entire team. Paste your URL. Get your marketing department.\n\nCTA: Try it free today.", storyboard: "Scene 1: Busy founder at laptop, overwhelmed\nScene 2: Stack of invoices from agencies\nScene 3: AI analyzing website (animation)\nScene 4: Dashboard filling with content, videos, campaigns\nScene 5: Founder smiling, growth metrics rising\nCTA screen with URL", duration: 60, hookStrength: 91, engagementPotential: 88, viralPotential: 84 },
    { title: "Product Demo — From URL to Marketing Department", type: "product", script: "HOOK: Watch me turn this website URL into a full marketing department in 5 minutes.\n\nDEMO FLOW:\n1. Paste URL\n2. AI analyzes business\n3. Competitor report generated\n4. Content calendar created\n5. 9 videos queued\n6. Ad campaigns built\n\nCTA: Your turn — try it free.", storyboard: "Screen recording: paste URL\nAnimation: AI scanning website\nDashboard populating with data\nVideo thumbnails appearing\nAd creatives generating\nCTA overlay", duration: 90, hookStrength: 87, engagementPotential: 85, viralPotential: 78 },
    { title: "TikTok — Stop Paying Agency Fees", type: "social", script: "POV: You just canceled your $8,000/month marketing agency.\n\nYou switched to an AI that:\n- Analyzes your competitors\n- Creates your content\n- Makes your videos\n- Runs your ads\n- Tracks your growth\n\nAll automatically. All from your website URL.\n\nThis is real. Try it for free.", storyboard: "Fast-cut TikTok style\nText overlays on dark background\nScreen recordings of dashboard\nBefore/after metrics\nStrong CTA end card", duration: 30, hookStrength: 94, engagementPotential: 92, viralPotential: 91 },
    { title: "Instagram Reel — Competitor Intelligence", type: "social", script: "Your competitors have marketing teams. You have AI.\n\nGrowthForge AI finds your top 10 competitors, analyzes their messaging, identifies their weaknesses, and tells you exactly how to win.\n\nAll from your website URL. Try free.", storyboard: "Competitor logos appearing on screen\nAI analysis animation\nWeaknesses highlighted\nYour brand positioning revealed\nCTA: Start free analysis", duration: 30, hookStrength: 86, engagementPotential: 83, viralPotential: 79 },
    { title: "YouTube Short — 9 Videos in One Click", type: "promo", script: "What if you could generate 9 professional marketing videos in a single click?\n\n3 promotional videos. 3 product demos. 3 social shorts.\n\nAll tailored to your brand. All ready to publish.\n\nThat's what GrowthForge AI does. Paste your URL. Watch it work.", storyboard: "9 video thumbnails populating\nEach video type highlighted\nDashboard overview\nPublish button click\nGrowth metrics\nCTA screen", duration: 45, hookStrength: 89, engagementPotential: 87, viralPotential: 85 },
    { title: "Testimonial — Agency Owner Saves $120K/Year", type: "promo", script: "TESTIMONIAL FORMAT:\n\n'Before GrowthForge, I had 4 freelancers and was spending $10K a month. Now I have one AI platform that does more than all of them combined — for $299 a month. I'm keeping the $9,700/month difference.'\n\n— Marcus R., Agency Owner", storyboard: "Interview-style testimonial\nMetrics overlay: $120K saved\nDashboard footage b-roll\nResults: 340% more content output\nCTA: See pricing", duration: 60, hookStrength: 88, engagementPotential: 82, viralPotential: 76 },
    { title: "Retargeting Ad — You Visited. Here's What You Missed.", type: "promo", script: "You checked us out. You didn't start your free trial.\n\nHere's what happened to businesses that did:\n• 340% more content output\n• 67% lower cost per lead\n• 9 videos in their first hour\n\nYour free trial is still waiting. No credit card required.", storyboard: "Notification-style opening\nMetrics revealed one by one\nSocial proof testimonials\nUrgency: Your trial is waiting\nBig CTA button", duration: 30, hookStrength: 85, engagementPotential: 80, viralPotential: 72 },
    { title: "Explainer — How the AI Works", type: "product", script: "STEP 1: You paste your website URL.\nSTEP 2: Our AI reads your entire site in seconds.\nSTEP 3: It identifies your business, customers, competitors, and opportunities.\nSTEP 4: It generates your marketing strategy, content calendar, email sequences, video scripts, and ad campaigns.\nSTEP 5: You review, approve, and launch.\n\nThe whole process takes minutes — not months.", storyboard: "Clean animation: URL input\nAI scanning animation\nData extraction visualization\nContent populating (grid view)\nLaunch button pressed\nGrowth chart rising", duration: 90, hookStrength: 83, engagementPotential: 86, viralPotential: 74 },
    { title: "Event Promo — The End of Marketing Agencies", type: "promo", script: "Marketing agencies charge $5,000-$50,000 per month.\n\nFor strategy. For content. For ads. For reporting.\n\nAI does all of it — faster, smarter, cheaper.\n\nThe era of bloated agency retainers is ending.\n\nJoin 10,000+ businesses who switched to GrowthForge AI.", storyboard: "Bold typography on dark background\nAgency invoice montage\nContrast: AI dashboard\nTestimonial quotes\nCommunity counter\nStrong CTA", duration: 45, hookStrength: 90, engagementPotential: 84, viralPotential: 88 },
  ];

  const quota = await consumeTrialQuota(projectId, "video_blueprints", 1);
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  const toCreate = videoTemplates.slice(0, count);
  const inserted = await db.insert(videosTable).values(
    toCreate.map(t => ({ ...t, projectId, status: "complete" as const }))
  ).returning();

  await db.insert(activityTable).values({
    projectId,
    type: "videos",
    description: `Generated ${inserted.length} marketing videos`,
  });

  res.json(inserted.map(v => ({ ...v, createdAt: v.createdAt.toISOString() })));
});

router.get("/projects/:id/videos/:videoId", async (req, res): Promise<void> => {
  const params = GetVideoParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [video] = await db.select().from(videosTable).where(eq(videosTable.id, params.data.videoId));
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  res.json({ ...video, createdAt: video.createdAt.toISOString() });
});

router.patch("/projects/:id/videos/:videoId", async (req, res): Promise<void> => {
  const params = UpdateVideoParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateVideoBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [video] = await db.update(videosTable).set(parsed.data).where(eq(videosTable.id, params.data.videoId)).returning();
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  res.json({ ...video, createdAt: video.createdAt.toISOString() });
});

router.delete("/projects/:id/videos/:videoId", async (req, res): Promise<void> => {
  const params = DeleteVideoParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [video] = await db.delete(videosTable).where(eq(videosTable.id, params.data.videoId)).returning();
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }
  res.sendStatus(204);
});

export default router;

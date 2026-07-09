import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { videosTable, activityTable } from "@workspace/db";
import { consumeTrialQuota, getProjectPlan, TRIAL_MAX_VIDEO_BATCH } from "../lib/trialLimits.js";
import { getGroundingContext } from "../lib/projectContext.js";
import { generateVideoBlueprints, type VideoBlueprintResult } from "../lib/contentGenerators.js";
import {
  ListVideosParams,
  GenerateVideosParams,
  GenerateVideosBody,
  GetVideoParams,
  UpdateVideoParams,
  UpdateVideoBody,
  DeleteVideoParams,
} from "@workspace/api-zod";
import { requireProjectOwnershipParam } from "../lib/authz.js";
import { recordGeneratedBatch } from "../lib/contentIntegrity.js";

const router: IRouter = Router();

router.param("id", requireProjectOwnershipParam());

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
  let count = parsed.data.count ?? (mode === "auto" ? 9 : 3);

  const ctx = await getGroundingContext(projectId);
  if (!ctx) {
    res.status(409).json({ error: "Run business analysis before generating video blueprints" });
    return;
  }

  // Trial-plan batches are capped smaller than the platform's normal batch size to
  // keep a single generation event's AI cost bounded (part of the overall trial spend cap).
  const plan = await getProjectPlan(projectId);
  if (plan === "trial") {
    count = Math.min(count, TRIAL_MAX_VIDEO_BATCH);
  }

  // Call-based quota: one trial unit per generation event, regardless of how many
  // videos the batch produces (matches the pricing card's "1 Video Blueprint" wording
  // and avoids blocking the platform's own 9-video auto-batch on the first use).
  const quota = await consumeTrialQuota(projectId, "video_blueprints", 1);
  if (!quota.allowed) {
    res.status(403).json({ error: quota.message });
    return;
  }

  let videoResults: VideoBlueprintResult[];
  try {
    videoResults = await generateVideoBlueprints(ctx, { count, type: parsed.data.type, prompt: parsed.data.prompt });
  } catch (err) {
    req.log.error({ err }, "Video blueprint generation failed");
    res.status(502).json({ error: "Failed to generate video blueprints" });
    return;
  }

  const inserted = await db.insert(videosTable).values(
    videoResults.map(t => ({ ...t, projectId, status: "complete" as const }))
  ).returning();

  await recordGeneratedBatch({
    userId: req.project!.ownerId!,
    projectId,
    contentType: "video_blueprints",
    items: inserted.map((v) => ({
      id: v.id,
      data: { title: v.title, type: v.type, script: v.script, storyboard: v.storyboard, voiceover: v.voiceover },
      summary: v.title,
    })),
  });

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

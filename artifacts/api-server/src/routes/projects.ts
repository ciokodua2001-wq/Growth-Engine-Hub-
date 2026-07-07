import { Router, type IRouter } from "express";
import { eq, desc, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  projectsTable,
  activityTable,
  businessAnalysisTable,
  videosTable,
  campaignsTable,
  competitorsTable,
  contentTable,
  socialPostsTable,
  emailCampaignsTable,
  adCreativesTable,
} from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  UpdateProjectParams,
  DeleteProjectParams,
  GetProjectParams,
  GetProjectDashboardParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects", async (_req, res): Promise<void> => {
  const projects = await db.select().from(projectsTable).orderBy(desc(projectsTable.createdAt));
  res.json(projects);
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [project] = await db.insert(projectsTable).values(parsed.data).returning();
  res.status(201).json(project);
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [project] = await db.update(projectsTable).set(parsed.data).where(eq(projectsTable.id, params.data.id)).returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [project] = await db.delete(projectsTable).where(eq(projectsTable.id, params.data.id)).returning();
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/projects/:id/dashboard", async (req, res): Promise<void> => {
  const params = GetProjectDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const projectId = params.data.id;

  const [contentCountResult] = await db.select({ count: count() }).from(contentTable).where(eq(contentTable.projectId, projectId));
  const [videosCountResult] = await db.select({ count: count() }).from(videosTable).where(eq(videosTable.projectId, projectId));
  const [campaignsCountResult] = await db.select({ count: count() }).from(campaignsTable).where(eq(campaignsTable.projectId, projectId));
  const [competitorsCountResult] = await db.select({ count: count() }).from(competitorsTable).where(eq(competitorsTable.projectId, projectId));
  const [adsCountResult] = await db.select({ count: count() }).from(adCreativesTable).where(eq(adCreativesTable.projectId, projectId));
  const [emailsCountResult] = await db.select({ count: count() }).from(emailCampaignsTable).where(eq(emailCampaignsTable.projectId, projectId));
  const [socialCountResult] = await db.select({ count: count() }).from(socialPostsTable).where(eq(socialPostsTable.projectId, projectId));

  const [analysis] = await db.select({ status: businessAnalysisTable.status }).from(businessAnalysisTable).where(eq(businessAnalysisTable.projectId, projectId));

  const recentActivity = await db.select().from(activityTable).where(eq(activityTable.projectId, projectId)).orderBy(desc(activityTable.createdAt)).limit(10);

  res.json({
    projectId,
    totalContent: Number(contentCountResult?.count ?? 0),
    totalVideos: Number(videosCountResult?.count ?? 0),
    totalCampaigns: Number(campaignsCountResult?.count ?? 0),
    totalCompetitors: Number(competitorsCountResult?.count ?? 0),
    totalAds: Number(adsCountResult?.count ?? 0),
    totalEmails: Number(emailsCountResult?.count ?? 0),
    totalSocialPosts: Number(socialCountResult?.count ?? 0),
    analysisStatus: analysis?.status ?? null,
    recentActivity: recentActivity.map(a => ({
      id: a.id,
      type: a.type,
      description: a.description,
      createdAt: a.createdAt.toISOString(),
    })),
    topMetrics: [
      { label: "Content Generated", value: String(Number(contentCountResult?.count ?? 0)), change: 12, trend: "up" },
      { label: "Videos Created", value: String(Number(videosCountResult?.count ?? 0)), change: 8, trend: "up" },
      { label: "Active Campaigns", value: String(Number(campaignsCountResult?.count ?? 0)), change: 5, trend: "up" },
      { label: "Competitors Tracked", value: String(Number(competitorsCountResult?.count ?? 0)), change: 2, trend: "up" },
    ],
  });
});

export default router;

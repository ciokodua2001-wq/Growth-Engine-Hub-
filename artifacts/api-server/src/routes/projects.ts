import { Router, type IRouter } from "express";
import { eq, desc, count, and, isNull } from "drizzle-orm";
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
  marketingStrategyTable,
} from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  UpdateProjectParams,
  DeleteProjectParams,
  GetProjectParams,
  GetProjectDashboardParams,
} from "@workspace/api-zod";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import { PLAN_PROJECT_LIMITS } from "../lib/planLimits.js";

const router: IRouter = Router();

// Every route below has an `:id` segment except `GET/POST /projects`, which are handled
// explicitly. This verifies auth + ownership once per request and attaches `req.project`.
router.param("id", requireProjectOwnershipParam());

router.get("/projects", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projects = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.ownerId, userId), isNull(projectsTable.deletedAt)))
    .orderBy(desc(projectsTable.createdAt));
  res.json(projects);
});

// Plan tier ordering — higher index = higher tier
const PLAN_TIER_ORDER = ["trial", "starter", "get-going", "growth", "agency"];

router.post("/projects", async (req, res): Promise<void> => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Determine the user's effective plan: the highest tier across all their
  // non-deleted projects. This is a best-effort heuristic until Stripe is
  // integrated and plan lives on the user record instead of per-project.
  const existing = await db
    .select({ plan: projectsTable.plan })
    .from(projectsTable)
    .where(and(eq(projectsTable.ownerId, userId), isNull(projectsTable.deletedAt)));

  const bestPlan = existing.reduce<string>((best, p) => {
    const bestIdx = PLAN_TIER_ORDER.indexOf(best);
    const thisIdx = PLAN_TIER_ORDER.indexOf(p.plan);
    return thisIdx > bestIdx ? p.plan : best;
  }, "trial");

  const projectLimit = PLAN_PROJECT_LIMITS[bestPlan] ?? 1;
  if (existing.length >= projectLimit) {
    const planLabel = bestPlan.charAt(0).toUpperCase() + bestPlan.slice(1);
    res.status(403).json({
      error: "project_limit_reached",
      message: `Your ${planLabel} plan allows up to ${projectLimit} project${projectLimit === 1 ? "" : "s"}. Upgrade your plan to create more.`,
    });
    return;
  }

  // `plan` is always forced to "trial" here (never taken from the client) so every
  // project-creation path is subject to the trial AI-spend cap, matching onboarding.
  const [project] = await db
    .insert(projectsTable)
    .values({ ...parsed.data, ownerId: userId, plan: "trial" })
    .returning();
  res.status(201).json(project);
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  res.json(req.project);
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
  const [project] = await db
    .update(projectsTable)
    .set(parsed.data)
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.ownerId, req.project!.ownerId!)))
    .returning();
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
  const [project] = await db
    .update(projectsTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(projectsTable.id, params.data.id), eq(projectsTable.ownerId, req.project!.ownerId!), isNull(projectsTable.deletedAt)))
    .returning();
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
  const [strategy] = await db.select({ id: marketingStrategyTable.id }).from(marketingStrategyTable).where(eq(marketingStrategyTable.projectId, projectId));

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
    hasStrategy: !!strategy,
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

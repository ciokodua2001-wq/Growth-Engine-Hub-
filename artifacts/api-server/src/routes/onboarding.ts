import { Router, type IRouter } from "express";
import { getAuth } from "../lib/supabaseAuth.js";
import { db } from "@workspace/db";
import { usersTable, projectsTable, businessSourcesTable, creatorProfilesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { detectLocaleFromUrl, mapToSupportedLocale } from "../utils/urlLocaleDetector.js";
import { getSupportedLocales } from "../lib/localization.js";
import { SOURCE_TYPES, type SourceType } from "../lib/businessSourceIngestor.js";

const router: IRouter = Router();

const OPERATING_MODELS = ["business", "creator", "hybrid"] as const;
type OperatingModel = (typeof OPERATING_MODELS)[number];

function buildProjectDescription(args: {
  businessDescription?: string | null;
  targetCustomers?: string | null;
  primaryGoal?: string | null;
  location?: string | null;
}) {
  const parts = [
    args.businessDescription?.trim() ? `About: ${args.businessDescription.trim()}` : null,
    args.targetCustomers?.trim() ? `Customers: ${args.targetCustomers.trim()}` : null,
    args.primaryGoal?.trim() ? `Goal: ${args.primaryGoal.trim()}` : null,
    args.location?.trim() ? `Location: ${args.location.trim()}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : null;
}

router.get("/onboarding", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.ownerId, userId), isNull(projectsTable.deletedAt)))
      .orderBy(projectsTable.createdAt);

    const sources = project
      ? await db.select().from(businessSourcesTable).where(eq(businessSourcesTable.projectId, project.id))
      : [];

    const [creatorProfile] = project
      ? await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.projectId, project.id))
      : [undefined];

    res.json({ user, project: project ?? null, sources, creatorProfile: creatorProfile ?? null });
  } catch (err) {
    req.log.error({ err }, "Error loading onboarding state");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/onboarding", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!userRow) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const body = req.body as {
      businessName?: string;
      websiteUrl?: string | null;
      sourceType?: string;
      sourceUrl?: string | null;
      operatingModel?: string;
      businessDescription?: string | null;
      declaredDescription?: string | null;
      primaryGoal?: string | null;
      targetCustomers?: string | null;
      industry?: string | null;
      location?: string | null;
      confirmedLocale?: string;
      creatorProfile?: {
        creatorName?: string;
        channelName?: string;
        contentNiche?: string;
        audienceDescription?: string;
        contentLanguages?: string[];
        contentFormats?: string[];
        contentThemes?: string[];
        brandVoice?: string;
        currentGoals?: string;
        monetizationMethods?: string[];
        selfReportedStats?: Record<string, unknown>;
      };
    };

    const businessName = body.businessName?.trim();
    if (!businessName) {
      res.status(400).json({ error: "businessName is required" });
      return;
    }

    const operatingModel = (body.operatingModel ?? "business") as OperatingModel;
    if (!OPERATING_MODELS.includes(operatingModel)) {
      res.status(400).json({ error: "operatingModel must be one of: business, creator, hybrid" });
      return;
    }

    let sourceType: SourceType;
    if (body.sourceType && SOURCE_TYPES.includes(body.sourceType as SourceType) && body.sourceType !== "whatsapp") {
      sourceType = body.sourceType as SourceType;
    } else if (body.websiteUrl) {
      sourceType = "website";
    } else {
      sourceType = "manual";
    }

    const websiteUrl = body.websiteUrl?.trim() || null;
    if (sourceType === "website" && !websiteUrl) {
      res.status(400).json({ error: "websiteUrl is required for website projects" });
      return;
    }

    const sourceUrl = sourceType === "website" ? null : (body.sourceUrl?.trim() || null);
    const declaredContent = body.declaredDescription?.trim() || null;
    const description = buildProjectDescription({
      businessDescription: body.businessDescription,
      targetCustomers: body.targetCustomers,
      primaryGoal: body.primaryGoal,
      location: body.location,
    });

    let detectedLocale: string | null = null;
    const supported = getSupportedLocales();

    if (body.confirmedLocale && supported.includes(body.confirmedLocale)) {
      detectedLocale = body.confirmedLocale;
      req.log.info({ locale: body.confirmedLocale, source: "user-confirmed" }, "Using user-confirmed locale from onboarding widget");
    } else if (websiteUrl) {
      try {
        const localeResult = await detectLocaleFromUrl(websiteUrl);
        req.log.info(
          { locale: localeResult.locale, confidence: localeResult.confidence, source: localeResult.source },
          "Onboarding server-side URL locale detection",
        );
        detectedLocale = mapToSupportedLocale(localeResult, supported) ?? null;
      } catch (localeErr) {
        req.log.warn({ err: localeErr }, "Locale detection threw unexpectedly - skipping");
      }
    }

    const [existingProject] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.ownerId, userId), isNull(projectsTable.deletedAt)))
      .orderBy(projectsTable.createdAt);

    const plan = userRow.plan ?? "trial";
    const nextProjectValues = {
      name: businessName,
      websiteUrl,
      sourceType,
      sourceUrl,
      operatingModel,
      industry: body.industry?.trim() || null,
      description,
      plan,
      status: existingProject?.status ?? "pending",
      detectedLocale,
    };

    const [project] = existingProject
      ? await db.update(projectsTable).set(nextProjectValues).where(eq(projectsTable.id, existingProject.id)).returning()
      : await db.insert(projectsTable).values({ ownerId: userId, ...nextProjectValues }).returning();

    const existingSources = await db.select().from(businessSourcesTable).where(eq(businessSourcesTable.projectId, project.id));
    const primarySource = existingSources.find((s) => s.sourceType === sourceType && (s.sourceUrl ?? null) === sourceUrl);
    const sourceValue = sourceUrl ?? sourceType;

    if (primarySource) {
      await db
        .update(businessSourcesTable)
        .set({
          displayLabel: sourceUrl ?? sourceType,
          declaredContent,
          status: "active",
        })
        .where(eq(businessSourcesTable.id, primarySource.id));
    } else {
      await db.insert(businessSourcesTable).values({
        projectId: project.id,
        sourceType,
        sourceUrl,
        sourceValue,
        displayLabel: sourceUrl ?? sourceType,
        authorizationStatus: "none",
        retrievalMethod: "none",
        declaredContent,
        status: "active",
      });
    }

    if (operatingModel !== "business") {
      const cp = body.creatorProfile ?? {};
      const creatorValues = {
        creatorName: cp.creatorName?.trim() || businessName,
        channelName: cp.channelName?.trim() || null,
        primaryPlatform: sourceType === "website" ? null : sourceType,
        contentNiche: cp.contentNiche?.trim() || null,
        audienceDescription: cp.audienceDescription?.trim() || null,
        contentLanguages: cp.contentLanguages?.length ? cp.contentLanguages : null,
        contentFormats: cp.contentFormats?.length ? cp.contentFormats : null,
        contentThemes: cp.contentThemes?.length ? cp.contentThemes : null,
        brandTone: cp.brandVoice?.trim() || null,
        currentGoals: cp.currentGoals?.trim() || null,
        monetizationMethods: cp.monetizationMethods?.length ? cp.monetizationMethods : null,
        selfReportedStats: cp.selfReportedStats ?? null,
      };

      const [existingCreatorProfile] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.projectId, project.id));
      if (existingCreatorProfile) {
        await db.update(creatorProfilesTable).set(creatorValues).where(eq(creatorProfilesTable.id, existingCreatorProfile.id));
      } else {
        await db.insert(creatorProfilesTable).values({ projectId: project.id, ...creatorValues });
      }
    }

    const trialEndsAt = userRow.trialEndsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db
      .update(usersTable)
      .set({
        onboardingComplete: true,
        plan: userRow.plan ?? "trial",
        subscriptionStatus: userRow.subscriptionStatus ?? "trial",
        trialEndsAt,
      })
      .where(eq(usersTable.id, userId));

    const [updatedUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    const sources = await db.select().from(businessSourcesTable).where(eq(businessSourcesTable.projectId, project.id));
    const [creatorProfile] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.projectId, project.id));

    res.json({ project, user: updatedUser, sources, creatorProfile: creatorProfile ?? null });
  } catch (err) {
    req.log.error({ err }, "Error completing onboarding");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

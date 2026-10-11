import { Router, type IRouter } from "express";
import { getAuth } from "../lib/supabaseAuth.js";
import { db } from "@workspace/db";
import { usersTable, projectsTable, businessSourcesTable, creatorProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { detectLocaleFromUrl, mapToSupportedLocale } from "../utils/urlLocaleDetector.js";
import { getSupportedLocales } from "../lib/localization.js";
import { SOURCE_TYPES, type SourceType } from "../lib/businessSourceIngestor.js";

const router: IRouter = Router();

const OPERATING_MODELS = ["business", "creator", "hybrid"] as const;
type OperatingModel = (typeof OPERATING_MODELS)[number];

router.post("/onboarding", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = req.body as {
      businessName?: string;
      websiteUrl?: string | null;
      sourceType?: string;
      sourceUrl?: string | null;
      operatingModel?: string;
      declaredDescription?: string | null;
      primaryGoal?: string;
      targetMarket?: string;
      /**
       * BCP-47 locale code the user explicitly confirmed in the onboarding
       * market detection widget. When provided and valid, skips the server-side
       * detector run entirely - the user's choice is authoritative.
       */
      confirmedLocale?: string;
      creatorProfile?: {
        creatorName?: string;
        channelName?: string;
        contentNiche?: string;
        audienceDescription?: string;
        contentLanguages?: string[];
        contentFormats?: string[];
        currentGoals?: string;
        monetizationMethods?: string[];
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

    // Resolve the primary source. A website is one possible source - not a
    // prerequisite for creating a project.
    let sourceType: SourceType;
    if (body.sourceType && SOURCE_TYPES.includes(body.sourceType as SourceType)) {
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
    // For non-website sources, websiteUrl is irrelevant and sourceUrl is optional
    // (a creator may onboard with a manual description only).
    const sourceUrl = sourceType === "website" ? null : (body.sourceUrl?.trim() || null);

    const declaredContent = body.declaredDescription?.trim() || null;
    const description = [body.primaryGoal, body.targetMarket, declaredContent].filter(Boolean).join(" | ") || null;

    // ── Determine the locale to store ────────────────────────────────────────
    let detectedLocale: string | null = null;
    const supported = getSupportedLocales();

    if (body.confirmedLocale && supported.includes(body.confirmedLocale)) {
      detectedLocale = body.confirmedLocale;
      req.log.info(
        { locale: body.confirmedLocale, source: "user-confirmed" },
        "Using user-confirmed locale from onboarding widget",
      );
    } else if (websiteUrl) {
      // Server-side URL detection is only meaningful for website sources.
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

    // ── Create the project ───────────────────────────────────────────────────
    const [project] = await db
      .insert(projectsTable)
      .values({
        ownerId: userId,
        name: businessName,
        websiteUrl,
        sourceType,
        sourceUrl,
        operatingModel,
        industry: null,
        description,
        plan: "trial",
        status: "pending",
        detectedLocale,
      })
      .returning();

    // ── Record the primary source in the multi-source ledger ─────────────────
    const sourceValue = sourceUrl ?? sourceType;
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

    // ── Creator/hybrid profile (all optional) ─────────────────────────────────
    if (operatingModel !== "business") {
      const cp = body.creatorProfile ?? {};
      await db.insert(creatorProfilesTable).values({
        projectId: project.id,
        creatorName: cp.creatorName?.trim() || businessName,
        channelName: cp.channelName?.trim() || null,
        primaryPlatform: sourceType === "website" ? null : sourceType,
        contentNiche: cp.contentNiche?.trim() || null,
        audienceDescription: cp.audienceDescription?.trim() || null,
        contentLanguages: cp.contentLanguages?.length ? cp.contentLanguages : null,
        contentFormats: cp.contentFormats?.length ? cp.contentFormats : null,
        currentGoals: cp.currentGoals?.trim() || null,
        monetizationMethods: cp.monetizationMethods?.length ? cp.monetizationMethods : null,
      });
    }

    await db
      .update(usersTable)
      .set({ onboardingComplete: true })
      .where(eq(usersTable.id, userId));

    res.json({ project });
  } catch (err) {
    req.log.error({ err }, "Error completing onboarding");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { detectLocaleFromUrl, mapToSupportedLocale } from "../utils/urlLocaleDetector.js";
import { getSupportedLocales } from "../lib/localization.js";

const router: IRouter = Router();

router.post("/onboarding", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { businessName, websiteUrl, primaryGoal, targetMarket, confirmedLocale } = req.body as {
      businessName: string;
      websiteUrl: string;
      primaryGoal?: string;
      targetMarket?: string;
      /**
       * BCP-47 locale code the user explicitly confirmed in the onboarding
       * market detection widget. When provided and valid, skips the server-side
       * detector run entirely — the user's choice is authoritative.
       */
      confirmedLocale?: string;
    };

    if (!businessName || !websiteUrl) {
      res.status(400).json({ error: "businessName and websiteUrl are required" });
      return;
    }

    const description = [primaryGoal, targetMarket].filter(Boolean).join(" | ") || null;

    // ── Determine the locale to store ────────────────────────────────────────
    let detectedLocale: string | null = null;
    const supported = getSupportedLocales();

    if (confirmedLocale && supported.includes(confirmedLocale)) {
      // User explicitly confirmed a market in the onboarding widget — trust it.
      detectedLocale = confirmedLocale;
      req.log.info(
        { locale: confirmedLocale, source: "user-confirmed" },
        "Using user-confirmed locale from onboarding widget",
      );
    } else {
      // No confirmed locale provided (or it's not a supported profile code) —
      // fall back to server-side auto-detection from the URL.
      // detectLocaleFromUrl never throws; falls back to en-US on any error.
      try {
        const localeResult = await detectLocaleFromUrl(websiteUrl);
        req.log.info(
          { locale: localeResult.locale, confidence: localeResult.confidence, source: localeResult.source },
          "Onboarding server-side URL locale detection",
        );
        const mapped = mapToSupportedLocale(localeResult, supported);
        detectedLocale = mapped ?? null;
      } catch (localeErr) {
        req.log.warn({ err: localeErr }, "Locale detection threw unexpectedly — skipping");
      }
    }

    // ── Create the project ───────────────────────────────────────────────────
    const [project] = await db
      .insert(projectsTable)
      .values({
        ownerId: userId,
        name: businessName,
        websiteUrl,
        industry: null,
        description,
        plan: "trial",
        status: "pending",
        detectedLocale,
      })
      .returning();

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

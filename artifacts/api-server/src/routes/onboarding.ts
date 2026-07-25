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

    const { businessName, websiteUrl, primaryGoal, targetMarket } = req.body as {
      businessName: string;
      websiteUrl: string;
      primaryGoal?: string;
      targetMarket?: string;
    };

    if (!businessName || !websiteUrl) {
      res.status(400).json({ error: "businessName and websiteUrl are required" });
      return;
    }

    const description = [primaryGoal, targetMarket].filter(Boolean).join(" | ") || null;

    // ── Locale detection (runs before insert so the project is created with it) ─
    // detectLocaleFromUrl never throws — falls back to en-US on any error.
    // It has an internal 5-second fetch timeout for generic TLDs.
    let detectedLocale: string | null = null;
    try {
      const localeResult = await detectLocaleFromUrl(websiteUrl);
      req.log.info(
        { locale: localeResult.locale, confidence: localeResult.confidence, source: localeResult.source },
        "URL locale detection result",
      );

      // Only store locales we have a full profile for — unknown locales would
      // silently produce English output anyway, so null is more honest.
      const supported = getSupportedLocales();
      const mapped = mapToSupportedLocale(localeResult, supported);
      detectedLocale = mapped ?? null;

      if (!mapped) {
        req.log.info(
          { detected: localeResult.locale },
          "Detected locale has no matching profile — defaulting to null",
        );
      }
    } catch (localeErr) {
      // Belt-and-suspenders: detectLocaleFromUrl should never reach here,
      // but we must not let locale detection break onboarding.
      req.log.warn({ err: localeErr }, "Locale detection threw unexpectedly — skipping");
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

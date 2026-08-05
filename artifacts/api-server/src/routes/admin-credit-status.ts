import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "../lib/supabaseAuth.js";
import { db } from "@workspace/db";
import { usersTable, platformCreditBanksTable, platformCreditTransactionsTable } from "@workspace/db";
import { eq, desc, and, sql, gte, lte } from "drizzle-orm";
import { seedManualBanks } from "../lib/platformCredits.js";
import { genai } from "@workspace/integrations-google-genai";
import { ttsClient } from "@workspace/integrations-google-tts-server";

const router: IRouter = Router();

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  next();
}

// ── Live API checks ────────────────────────────────────────────────────────────
// Google doesn't expose a simple "balance remaining" REST endpoint the way
// ElevenLabs/OpenAI did — GCP billing lives behind the separate Cloud Billing
// API (needs its own IAM grant). We instead do a cheap, non-generating
// metadata call to confirm the credentials actually authenticate, and point
// admins to the GCP console for real-time spend.

function hasGoogleCredentials(): boolean {
  return !!(
    process.env["GOOGLE_GENAI_API_KEY"] ||
    (process.env["GOOGLE_CLOUD_PROJECT_ID"] && process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING"])
  );
}

async function fetchGoogleGenAiStatus() {
  if (!hasGoogleCredentials()) {
    return { keyConfigured: false, keyValid: null as boolean | null, note: null as string | null };
  }
  try {
    // models.get() is metadata-only — confirms auth without generating tokens.
    await genai.models.get({ model: "gemini-3.6-flash" });
    return { keyConfigured: true, keyValid: true, note: null };
  } catch {
    return { keyConfigured: true, keyValid: false, note: null };
  }
}

async function fetchGoogleTtsStatus() {
  if (!hasGoogleCredentials()) {
    return { keyConfigured: false, keyValid: null as boolean | null, note: null as string | null };
  }
  try {
    await ttsClient.listVoices({ languageCode: "en-CA" });
    return { keyConfigured: true, keyValid: true, note: null };
  } catch {
    return { keyConfigured: true, keyValid: false, note: null };
  }
}

async function fetchKlingKeyValid() {
  const key = process.env["KLING_API_KEY"];
  if (!key) return { keyConfigured: false, keyValid: null };
  try {
    // Probe Kling with a GET to /v1/videos/text2video — 401 means bad key,
    // 200/404/400 all mean the key is valid and the endpoint is reachable.
    const r = await fetch("https://api-singapore.klingai.com/v1/videos/text2video", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    return { keyConfigured: true, keyValid: r.status !== 401 };
  } catch {
    return { keyConfigured: true, keyValid: null };
  }
}

async function fetchShotstackKeyValid() {
  const key = process.env["SHOTSTACK_API_KEY"];
  if (!key) return { keyConfigured: false, keyValid: null };
  try {
    const env = process.env["NODE_ENV"] === "production" ? "production" : "stage";
    const r = await fetch(`https://api.shotstack.io/edit/${env}/queued`, {
      headers: { "x-api-key": key }, signal: AbortSignal.timeout(8000),
    });
    return { keyConfigured: true, keyValid: r.ok || r.status === 404 };
  } catch {
    return { keyConfigured: true, keyValid: null };
  }
}

// ── Unified endpoint ───────────────────────────────────────────────────────────

router.get("/admin/credits/unified", requireAdmin, async (req, res): Promise<void> => {
  try {
    await seedManualBanks();

    const [googleGenAiLive, googleTtsLive, klingKey, shotstackKey, banks, googleGenAiSpend, googleTtsSpend] =
      await Promise.all([
        fetchGoogleGenAiStatus(),
        fetchGoogleTtsStatus(),
        fetchKlingKeyValid(),
        fetchShotstackKeyValid(),
        db.select().from(platformCreditBanksTable)
          .where(sql`${platformCreditBanksTable.provider} IN ('kling','shotstack')`),
        db.select({
          total:   sql<number>`COALESCE(SUM(${platformCreditTransactionsTable.amount}), 0)`,
          monthly: sql<number>`COALESCE(SUM(CASE WHEN ${platformCreditTransactionsTable.createdAt} >= date_trunc('month', now()) THEN ${platformCreditTransactionsTable.amount} ELSE 0 END), 0)`,
        })
        .from(platformCreditTransactionsTable)
        .where(and(
          eq(platformCreditTransactionsTable.provider, "google-genai"),
          eq(platformCreditTransactionsTable.type, "deduction"),
        )),
        db.select({
          total:   sql<number>`COALESCE(SUM(${platformCreditTransactionsTable.amount}), 0)`,
          monthly: sql<number>`COALESCE(SUM(CASE WHEN ${platformCreditTransactionsTable.createdAt} >= date_trunc('month', now()) THEN ${platformCreditTransactionsTable.amount} ELSE 0 END), 0)`,
        })
        .from(platformCreditTransactionsTable)
        .where(and(
          eq(platformCreditTransactionsTable.provider, "google-tts"),
          eq(platformCreditTransactionsTable.type, "deduction"),
        )),
      ]);

    const bankMap = Object.fromEntries(banks.map((b) => [b.provider, b]));
    const klingBank = bankMap["kling"]     ?? null;
    const ssBank    = bankMap["shotstack"] ?? null;
    const klingPct  = klingBank && klingBank.peakBalance > 0 ? Math.round((klingBank.balance / klingBank.peakBalance) * 100) : null;
    const ssPct     = ssBank && ssBank.peakBalance > 0 ? Math.round((ssBank.balance / ssBank.peakBalance) * 100) : null;
    const genAiSpend = googleGenAiSpend[0] ?? { total: 0, monthly: 0 };
    const ttsSpend   = googleTtsSpend[0] ?? { total: 0, monthly: 0 };

    const klingCostPerClip = klingBank && klingBank.totalAdded > 0 && (klingBank.totalUsdSpent ?? 0) > 0
      ? klingBank.totalUsdSpent! / klingBank.totalAdded
      : 0.045; // default: ~$0.045/clip (Kling v2.6 Standard 5s)
    const ssCostPerCredit = ssBank && ssBank.totalAdded > 0 && (ssBank.totalUsdSpent ?? 0) > 0
      ? ssBank.totalUsdSpent! / ssBank.totalAdded
      : 0.2; // default: ~$0.20/credit (Shotstack pay-as-you-go estimate)

    res.json({
      googleGenai: {
        type: "spend",
        displayName: "Google GenAI (Gemini + Imagen)", icon: "✨",
        managedBy: "Google Cloud / AI Studio",
        dashboardUrl: "https://console.cloud.google.com/billing",
        keyConfigured: googleGenAiLive.keyConfigured,
        keyValid:      googleGenAiLive.keyValid,
        totalSpend:   Number(genAiSpend.total)   ?? 0,
        monthlySpend: Number(genAiSpend.monthly) ?? 0,
        unit: "USD",
        note: "Estimated from internal token accounting — verify exact spend in the GCP Billing console.",
      },
      googleTts: {
        type: "spend",
        displayName: "Google Cloud Text-to-Speech (Narration)", icon: "🎙️",
        managedBy: "Google Cloud",
        dashboardUrl: "https://console.cloud.google.com/billing",
        keyConfigured: googleTtsLive.keyConfigured,
        keyValid:      googleTtsLive.keyValid,
        totalSpend:   Number(ttsSpend.total)   ?? 0,
        monthlySpend: Number(ttsSpend.monthly) ?? 0,
        unit: "USD",
        note: "Estimated from internal character accounting — verify exact spend in the GCP Billing console.",
      },
      kling: {
        type: "bank",
        displayName: "Kling AI (Video — Direct API)", icon: "🎬",
        keyConfigured: klingKey.keyConfigured,
        keyValid:      klingKey.keyValid,
        balance:               klingBank?.balance              ?? null,
        peakBalance:           klingBank?.peakBalance          ?? null,
        totalAdded:            klingBank?.totalAdded           ?? null,
        totalCreditsConsumed:  klingBank?.totalCreditsConsumed ?? null,
        totalUsdSpent:         klingBank?.totalUsdSpent        ?? null,
        totalVideosGenerated:  klingBank?.totalVideosGenerated ?? null,
        totalMinutesGenerated: klingBank?.totalMinutesGenerated ?? null,
        costPerCredit:         klingCostPerClip,
        billingModel:          klingBank?.billingModel         ?? "payg",
        subscriptionPlan:      klingBank?.subscriptionPlan     ?? null,
        subscriptionCostUsd:   klingBank?.subscriptionCostUsd  ?? null,
        monthlyCredits:        klingBank?.monthlyCredits       ?? null,
        pct:           klingPct,
        unit:          "clips",
        alertThresholdPct: klingBank?.alertThresholdPct ?? 30,
        alertEmail:    klingBank?.alertEmail            ?? null,
        alertEnabled:  klingBank?.alertEnabled          ?? true,
        dashboardUrl: "https://klingai.com/",
        note: "Kling does not expose a live balance via API. Track usage at klingai.com after purchasing credits.",
      },
      shotstack: {
        type: "bank",
        displayName: "Shotstack (Render)", icon: "⚙️",
        keyConfigured: shotstackKey.keyConfigured,
        keyValid:      shotstackKey.keyValid,
        balance:               ssBank?.balance              ?? null,
        peakBalance:           ssBank?.peakBalance          ?? null,
        totalAdded:            ssBank?.totalAdded           ?? null,
        totalCreditsConsumed:  ssBank?.totalCreditsConsumed ?? null,
        totalUsdSpent:         ssBank?.totalUsdSpent        ?? null,
        totalVideosGenerated:  ssBank?.totalVideosGenerated ?? null,
        totalMinutesGenerated: ssBank?.totalMinutesGenerated ?? null,
        costPerCredit:         ssCostPerCredit,
        billingModel:          ssBank?.billingModel         ?? "payg",
        subscriptionPlan:      ssBank?.subscriptionPlan     ?? null,
        subscriptionCostUsd:   ssBank?.subscriptionCostUsd  ?? null,
        monthlyCredits:        ssBank?.monthlyCredits       ?? null,
        pct:           ssPct,
        unit:          "credits",
        alertThresholdPct: ssBank?.alertThresholdPct ?? 30,
        alertEmail:    ssBank?.alertEmail            ?? null,
        alertEnabled:  ssBank?.alertEnabled          ?? true,
        dashboardUrl: "https://dashboard.shotstack.io/billing",
        note: "Enter your render credits after purchasing from Shotstack dashboard.",
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching unified credit status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Top-up (MiniMax / Shotstack only) ─────────────────────────────────────────

router.post("/admin/credits/bank/:provider/topup", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    if (!["kling", "shotstack"].includes(provider)) {
      res.status(400).json({ error: "Top-up only supported for kling and shotstack" }); return;
    }

    const body = req.body as { credits?: number; amount?: number; purchaseCostUsd?: number; notes?: string };
    const credits = body.credits ?? body.amount;
    if (!credits || credits <= 0) { res.status(400).json({ error: "credits must be positive" }); return; }
    const purchaseCostUsd = typeof body.purchaseCostUsd === "number" && body.purchaseCostUsd > 0
      ? body.purchaseCostUsd : null;

    const [bank] = await db.select().from(platformCreditBanksTable)
      .where(eq(platformCreditBanksTable.provider, provider));
    if (!bank) { res.status(404).json({ error: "Bank not found" }); return; }

    const newBalance  = bank.balance + credits;
    const newPeak     = Math.max(bank.peakBalance, newBalance);
    const newTotal    = bank.totalAdded + credits;
    const newUsdSpent = (bank.totalUsdSpent ?? 0) + (purchaseCostUsd ?? 0);

    const [updated] = await db.update(platformCreditBanksTable)
      .set({
        balance: newBalance,
        peakBalance: newPeak,
        totalAdded: newTotal,
        totalUsdSpent: newUsdSpent,
        updatedAt: new Date(),
      })
      .where(eq(platformCreditBanksTable.provider, provider))
      .returning();

    await db.insert(platformCreditTransactionsTable).values({
      provider,
      type: "topup",
      amount: credits,
      balanceAfter: newBalance,
      description: body.notes?.trim() || "Manual top-up",
      purchaseCostUsd,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error topping up bank");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Alert + billing model settings (MiniMax / Shotstack) ──────────────────────

router.patch("/admin/credits/bank/:provider/settings", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    const body = req.body as {
      alertThresholdPct?: number;
      alertEmail?: string;
      alertEnabled?: boolean;
      billingModel?: string;
      subscriptionPlan?: string;
      subscriptionCostUsd?: number | null;
      monthlyCredits?: number | null;
    };
    const update: Partial<typeof platformCreditBanksTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.alertThresholdPct === "number") update.alertThresholdPct = Math.max(1, Math.min(99, body.alertThresholdPct));
    if (typeof body.alertEmail === "string") update.alertEmail = body.alertEmail.trim() || null;
    if (typeof body.alertEnabled === "boolean") update.alertEnabled = body.alertEnabled;
    if (body.billingModel === "payg" || body.billingModel === "subscription") update.billingModel = body.billingModel;
    if (typeof body.subscriptionPlan === "string") update.subscriptionPlan = body.subscriptionPlan.trim() || null;
    if (body.subscriptionCostUsd !== undefined) update.subscriptionCostUsd = body.subscriptionCostUsd ?? null;
    if (body.monthlyCredits !== undefined) update.monthlyCredits = body.monthlyCredits ?? null;

    const [updated] = await db.update(platformCreditBanksTable).set(update)
      .where(eq(platformCreditBanksTable.provider, provider)).returning();
    if (!updated) { res.status(404).json({ error: "Bank not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating bank settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Transaction history ────────────────────────────────────────────────────────

router.get("/admin/credits/transactions/:provider", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    const rows = await db.select().from(platformCreditTransactionsTable)
      .where(eq(platformCreditTransactionsTable.provider, provider))
      .orderBy(desc(platformCreditTransactionsTable.createdAt)).limit(50);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching transactions");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Credit bank reporting (MiniMax + Shotstack, date-range) ───────────────────

router.get("/admin/credits/reports/:provider", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    if (!["kling", "shotstack"].includes(provider)) {
      res.status(400).json({ error: "Reports only supported for kling and shotstack" }); return;
    }

    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    const conditions = [eq(platformCreditTransactionsTable.provider, provider)];
    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) conditions.push(gte(platformCreditTransactionsTable.createdAt, start));
    }
    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(platformCreditTransactionsTable.createdAt, end));
      }
    }

    const [[agg], [currentBank]] = await Promise.all([
      db.select({
        creditsPurchased: sql<number>`COALESCE(SUM(CASE WHEN ${platformCreditTransactionsTable.type} = 'topup' THEN ${platformCreditTransactionsTable.amount} ELSE 0 END), 0)`,
        creditsConsumed:  sql<number>`COALESCE(SUM(CASE WHEN ${platformCreditTransactionsTable.type} = 'deduction' THEN ${platformCreditTransactionsTable.amount} ELSE 0 END), 0)`,
        usdSpent:         sql<number>`COALESCE(SUM(CASE WHEN ${platformCreditTransactionsTable.type} = 'topup' THEN ${platformCreditTransactionsTable.purchaseCostUsd} ELSE 0 END), 0)`,
        videosGenerated:  sql<number>`COALESCE(SUM(${platformCreditTransactionsTable.videosCount}), 0)`,
        minutesGenerated: sql<number>`COALESCE(SUM(${platformCreditTransactionsTable.minutesGenerated}), 0)`,
        topupCount:       sql<number>`COUNT(CASE WHEN ${platformCreditTransactionsTable.type} = 'topup' THEN 1 END)`,
        deductionCount:   sql<number>`COUNT(CASE WHEN ${platformCreditTransactionsTable.type} = 'deduction' THEN 1 END)`,
      })
      .from(platformCreditTransactionsTable)
      .where(and(...conditions)),

      db.select({
        balance:       platformCreditBanksTable.balance,
        totalAdded:    platformCreditBanksTable.totalAdded,
        totalUsdSpent: platformCreditBanksTable.totalUsdSpent,
        billingModel:  platformCreditBanksTable.billingModel,
      }).from(platformCreditBanksTable)
        .where(eq(platformCreditBanksTable.provider, provider)),
    ]);

    const creditsConsumed  = Number(agg?.creditsConsumed  ?? 0);
    const creditsPurchased = Number(agg?.creditsPurchased ?? 0);
    const usdSpent         = Number(agg?.usdSpent         ?? 0);
    const minutesGenerated = Number(agg?.minutesGenerated ?? 0);
    const videosGenerated  = Number(agg?.videosGenerated  ?? 0);

    // Effective cost per credit — prefer period cost/credits; fall back to all-time ratio
    const costPerCredit = creditsPurchased > 0 && usdSpent > 0
      ? usdSpent / creditsPurchased
      : (currentBank?.totalAdded && (currentBank?.totalUsdSpent ?? 0) > 0)
        ? currentBank.totalUsdSpent! / currentBank.totalAdded
        : provider === "shotstack" ? 0.2 : 0.001;

    const estimatedUsdConsumed  = creditsConsumed * costPerCredit;
    const avgCreditsPerMinute   = minutesGenerated > 0 ? creditsConsumed / minutesGenerated : null;
    const avgCostPerMinute      = minutesGenerated > 0 ? estimatedUsdConsumed / minutesGenerated : null;
    const avgCostPerVideo       = videosGenerated > 0 ? estimatedUsdConsumed / videosGenerated : null;

    res.json({
      provider,
      billingModel: currentBank?.billingModel ?? "payg",
      creditsPurchased,
      creditsConsumed,
      creditsRemaining: currentBank?.balance ?? null,
      usdSpent,
      estimatedUsdConsumed: Math.round(estimatedUsdConsumed * 100) / 100,
      estimatedUsdRemaining: currentBank
        ? Math.round(currentBank.balance * costPerCredit * 100) / 100
        : null,
      videosGenerated,
      minutesGenerated: Math.round(minutesGenerated * 100) / 100,
      avgCreditsPerMinute: avgCreditsPerMinute !== null ? Math.round(avgCreditsPerMinute * 100) / 100 : null,
      avgCostPerMinute:    avgCostPerMinute    !== null ? Math.round(avgCostPerMinute * 10000) / 10000 : null,
      avgCostPerVideo:     avgCostPerVideo     !== null ? Math.round(avgCostPerVideo * 100) / 100 : null,
      topupCount:    Number(agg?.topupCount    ?? 0),
      deductionCount: Number(agg?.deductionCount ?? 0),
      costPerCredit: Math.round(costPerCredit * 100000) / 100000,
    });
  } catch (err) {
    req.log.error({ err }, "Error generating credit bank report");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

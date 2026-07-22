import { Router } from "express";
import { requireUserId } from "../lib/authz.js";
import { db } from "@workspace/db";
import { usersTable, videoSecondLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { getOrCreateWallet } from "../lib/videoWallet.js";
import { getVideoConfig, CREDIT_BUNDLES } from "../lib/videoConfig.js";

const router = Router();

/**
 * GET /video-wallet
 * Returns the current user's video second wallet balance + credit bundle options.
 */
router.get("/video-wallet", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const [user] = await db
      .select({ plan: usersTable.plan })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    const balance = await getOrCreateWallet(userId, user?.plan ?? "trial");
    const config  = await getVideoConfig();

    const lowWarningPct    = parseInt(config.low_balance_warning_pct ?? "25", 10);
    const monthlyTotal     = balance.monthlySecondsTotal;
    const monthlyRemaining = balance.monthlySecondsRemaining;
    const pctLeft = monthlyTotal > 0 ? Math.round((monthlyRemaining / monthlyTotal) * 100) : 0;
    const lowMonthlyBalance = monthlyTotal > 0 && pctLeft <= lowWarningPct;

    res.json({
      balance,
      lowMonthlyBalance,
      pctMonthlyLeft: pctLeft,
      bundles: CREDIT_BUNDLES,
      retailPricePerSecond: parseFloat(config.retail_price_per_second_usd ?? "1.25"),
    });
  } catch (err) {
    req.log.error({ err }, "GET /video-wallet failed");
    res.status(500).json({ error: "Failed to load video wallet" });
  }
});

/**
 * GET /video-wallet/logs
 * Returns the last 50 video second transactions for the current user.
 */
router.get("/video-wallet/logs", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const logs = await db
      .select()
      .from(videoSecondLogsTable)
      .where(eq(videoSecondLogsTable.userId, userId))
      .orderBy(desc(videoSecondLogsTable.createdAt))
      .limit(50);

    res.json(logs);
  } catch (err) {
    req.log.error({ err }, "GET /video-wallet/logs failed");
    res.status(500).json({ error: "Failed to load transaction logs" });
  }
});

export default router;

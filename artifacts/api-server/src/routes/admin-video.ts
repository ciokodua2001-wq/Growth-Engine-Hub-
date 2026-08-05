import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "../lib/supabaseAuth.js";
import { db } from "@workspace/db";
import { usersTable, videoWalletsTable, videoSecondLogsTable } from "@workspace/db";
import { eq, desc, sql, gte, and, ilike } from "drizzle-orm";
import { getVideoConfig, setVideoConfigs } from "../lib/videoConfig.js";
import { VIDEO_CONFIG_DEFAULTS } from "../lib/videoConfig.js";
import { giftVideoSeconds } from "../lib/videoWallet.js";

const router = Router();

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/**
 * GET /admin/video-config
 * Returns all admin-editable video credit settings.
 */
router.get("/admin/video-config", requireAdmin, async (req, res) => {
  try {
    const config = await getVideoConfig();
    res.json({
      config,
      defaults: VIDEO_CONFIG_DEFAULTS,
    });
  } catch (err) {
    req.log.error({ err }, "GET /admin/video-config failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /admin/video-config
 * Updates one or more admin-editable video config keys.
 * Body: Record<string, string>
 */
router.patch("/admin/video-config", requireAdmin, async (req, res) => {
  try {
    const updates = req.body as Record<string, unknown>;
    const allowedKeys = new Set(Object.keys(VIDEO_CONFIG_DEFAULTS));
    const filtered: Record<string, string> = {};

    for (const [key, val] of Object.entries(updates)) {
      if (!allowedKeys.has(key)) continue;
      if (typeof val !== "string" && typeof val !== "number") continue;
      filtered[key] = String(val);
    }

    if (Object.keys(filtered).length === 0) {
      res.status(400).json({ error: "No valid config keys provided" });
      return;
    }

    await setVideoConfigs(filtered);
    const config = await getVideoConfig();
    res.json({ config });
  } catch (err) {
    req.log.error({ err }, "PATCH /admin/video-config failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /admin/video-analytics
 * Returns platform-wide video wallet analytics.
 */
router.get("/admin/video-analytics", requireAdmin, async (req, res) => {
  try {
    // Aggregate wallet stats
    const walletStats = await db
      .select({
        totalUsers:              sql<number>`count(*)`,
        totalMonthlyAlloc:       sql<number>`sum(monthly_video_seconds)`,
        totalMonthlyUsed:        sql<number>`sum(monthly_seconds_used)`,
        totalPurchasedRemaining: sql<number>`sum(purchased_video_seconds)`,
        totalPurchasedEver:      sql<number>`sum(total_purchased_seconds)`,
        totalRenderedEver:       sql<number>`sum(total_rendered_seconds)`,
      })
      .from(videoWalletsTable);

    // Plan breakdown
    const planBreakdown = await db
      .select({
        plan:                sql<string>`plan`,
        userCount:           sql<number>`count(*)`,
        totalMonthlyAlloc:   sql<number>`sum(monthly_video_seconds)`,
        totalMonthlyUsed:    sql<number>`sum(monthly_seconds_used)`,
        totalPurchased:      sql<number>`sum(purchased_video_seconds)`,
      })
      .from(videoWalletsTable)
      .groupBy(sql`plan`);

    // Recent purchase logs
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const recentPurchases = await db
      .select({
        totalSeconds:     sql<number>`sum(seconds_changed)`,
        totalUsdPaid:     sql<number>`sum(amount_paid_usd)`,
        purchaseCount:    sql<number>`count(*)`,
      })
      .from(videoSecondLogsTable)
      .where(
        and(
          eq(videoSecondLogsTable.type, "purchased_credit"),
          gte(videoSecondLogsTable.createdAt, thirtyDaysAgo),
        ),
      );

    // Recent renders
    const recentRenders = await db
      .select({
        totalSeconds:    sql<number>`sum(abs(seconds_changed))`,
        renderCount:     sql<number>`count(*)`,
      })
      .from(videoSecondLogsTable)
      .where(
        and(
          eq(videoSecondLogsTable.type, "deduction"),
          gte(videoSecondLogsTable.createdAt, thirtyDaysAgo),
        ),
      );

    // Last 20 purchase transactions
    const recentPurchaseLogs = await db
      .select()
      .from(videoSecondLogsTable)
      .where(eq(videoSecondLogsTable.type, "purchased_credit"))
      .orderBy(desc(videoSecondLogsTable.createdAt))
      .limit(20);

    const config = await getVideoConfig();
    const klingCostPerSecond = (parseFloat(config.kling_cost_per_credit_usd ?? "0.145") / 5);
    const retailPerSecond    = parseFloat(config.retail_price_per_second_usd ?? "1.25");

    const totalRenderedEver  = Number(walletStats[0]?.totalRenderedEver ?? 0);
    const platformCost       = totalRenderedEver * klingCostPerSecond;
    const totalRevenueEver   = Number(recentPurchases[0]?.totalUsdPaid ?? 0);

    res.json({
      walletStats:        walletStats[0] ?? {},
      planBreakdown,
      last30Days: {
        purchases:  recentPurchases[0] ?? { totalSeconds: 0, totalUsdPaid: 0, purchaseCount: 0 },
        renders:    recentRenders[0]   ?? { totalSeconds: 0, renderCount: 0 },
      },
      recentPurchaseLogs,
      economics: {
        klingCostPerSecond,
        retailPerSecond,
        platformCost,
        totalRevenueEver,
        estimatedMarginPct: totalRevenueEver > 0
          ? Math.round(((totalRevenueEver - platformCost) / totalRevenueEver) * 100)
          : null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "GET /admin/video-analytics failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /admin/video-wallets
 * Returns all user wallets joined with user email (paginated, searchable).
 */
router.get("/admin/video-wallets", requireAdmin, async (req, res) => {
  try {
    const limit  = Math.min(parseInt((req.query["limit"]  as string) ?? "50", 10), 200);
    const search = (req.query["search"] as string | undefined)?.trim();

    const rows = await db
      .select({
        userId:               videoWalletsTable.userId,
        plan:                 videoWalletsTable.plan,
        monthlyVideoSeconds:  videoWalletsTable.monthlyVideoSeconds,
        monthlySecondsUsed:   videoWalletsTable.monthlySecondsUsed,
        purchasedVideoSeconds:videoWalletsTable.purchasedVideoSeconds,
        totalPurchasedSeconds:videoWalletsTable.totalPurchasedSeconds,
        totalRenderedSeconds: videoWalletsTable.totalRenderedSeconds,
        lastResetAt:          videoWalletsTable.lastResetAt,
        updatedAt:            videoWalletsTable.updatedAt,
        email:                usersTable.email,
      })
      .from(videoWalletsTable)
      .leftJoin(usersTable, eq(videoWalletsTable.userId, usersTable.id))
      .where(
        search
          ? ilike(usersTable.email, `%${search}%`)
          : undefined,
      )
      .orderBy(desc(videoWalletsTable.updatedAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "GET /admin/video-wallets failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /admin/video-wallets/gift
 * Gift video seconds to a specific user.
 * Body: { userId: string; seconds: number; note?: string }
 */
router.post("/admin/video-wallets/gift", requireAdmin, async (req, res) => {
  try {
    const auth = getAuth(req);
    const adminUserId = auth.userId!;

    const { userId, seconds, note } = req.body as {
      userId: string;
      seconds: unknown;
      note?: string;
    };

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const parsedSeconds = parseInt(String(seconds), 10);
    if (!parsedSeconds || parsedSeconds <= 0 || parsedSeconds > 3600) {
      res.status(400).json({ error: "seconds must be a positive integer ≤ 3600" });
      return;
    }

    const balance = await giftVideoSeconds(userId, parsedSeconds, adminUserId, note?.trim());
    res.json({ success: true, balance });
  } catch (err) {
    req.log.error({ err }, "POST /admin/video-wallets/gift failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

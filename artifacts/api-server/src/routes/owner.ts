import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
  adminAuditLogsTable,
  subscriptionUsageEventsTable,
} from "@workspace/db";
import { eq, count, sql, sum, and, gte, lt, isNotNull } from "drizzle-orm";

const router: IRouter = Router();

/* ─── requireOwner middleware ──────────────────────────────────────────────── */

/**
 * Restricts a route to the platform owner (isOwner = true in the DB).
 * Completely separate from the admin role — owners have access beyond super_admin.
 * Export so task #60 (email marketing) can reuse it without reimporting.
 */
export async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [user] = await db
    .select({ isOwner: usersTable.isOwner })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user?.isOwner) {
    res.status(403).json({ error: "Forbidden — Owner access required." });
    return;
  }
  next();
}

/* ─── helpers ──────────────────────────────────────────────────────────────── */

const PLAN_MONTHLY_PRICE: Record<string, number> = {
  starter: 39,
  "get-going": 99,
  growth: 299,
  scale: 799,
  agency: 799,
};

export async function ownerAuditLog(
  ownerId: string,
  ownerEmail: string | null | undefined,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>,
) {
  await db.insert(adminAuditLogsTable).values({
    adminId: ownerId,
    adminEmail: ownerEmail ?? null,
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    details: details ?? null,
  });
}

/* ─── Growth Analytics ─────────────────────────────────────────────────────── */

router.get("/owner/analytics", requireOwner, async (req, res): Promise<void> => {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      trialUsers,
      paidUsers,
      cancelledUsers,
      newUsersLast7d,
      newUsersLast30d,
      planBreakdown,
      cancelledThisMonth,
      cancelledLastMonth,
      aiCostRow,
      signupTrendResult,
    ] = await Promise.all([
      db.select({ count: count() }).from(usersTable),
      db.select({ count: count() }).from(usersTable).where(eq(usersTable.subscriptionStatus, "trial")),
      db.select({ count: count() }).from(usersTable).where(sql`${usersTable.subscriptionStatus} IN ('active', 'paid')`),
      db.select({ count: count() }).from(usersTable).where(eq(usersTable.subscriptionStatus, "cancelled")),
      db.select({ count: count() }).from(usersTable).where(gte(usersTable.createdAt, sevenDaysAgo)),
      db.select({ count: count() }).from(usersTable).where(gte(usersTable.createdAt, thirtyDaysAgo)),
      db.select({ plan: usersTable.plan, count: count() })
        .from(usersTable)
        .where(sql`${usersTable.subscriptionStatus} IN ('active', 'paid') AND ${usersTable.plan} != 'trial'`)
        .groupBy(usersTable.plan),
      db.select({ count: count() }).from(usersTable).where(
        and(isNotNull(usersTable.cancelledAt), gte(usersTable.cancelledAt, monthStart)),
      ),
      db.select({ count: count() }).from(usersTable).where(
        and(isNotNull(usersTable.cancelledAt), gte(usersTable.cancelledAt, lastMonthStart), lt(usersTable.cancelledAt, monthStart)),
      ),
      db.select({ totalCost: sum(subscriptionUsageEventsTable.costUsd), totalRequests: count() })
        .from(subscriptionUsageEventsTable),
      db.execute(sql`
        SELECT
          DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*)::int AS cnt
        FROM users
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    const mrr = planBreakdown.reduce((acc, row) => {
      const price = PLAN_MONTHLY_PRICE[row.plan ?? ""] ?? 0;
      return acc + price * Number(row.count);
    }, 0);

    const total = Number(totalUsers[0].count);
    const paid = Number(paidUsers[0].count);
    const conversionRate = total > 0 ? Math.round((paid / total) * 1000) / 10 : 0;

    const churned = Number(cancelledThisMonth[0].count);
    const churnBase = paid + churned;
    const churnRate = churnBase > 0 ? Math.round((churned / churnBase) * 1000) / 10 : 0;

    const rows = signupTrendResult.rows as Array<{ day: string; cnt: number }>;

    res.json({
      totalUsers: total,
      trialUsers: Number(trialUsers[0].count),
      paidUsers: paid,
      cancelledUsers: Number(cancelledUsers[0].count),
      newUsersLast7d: Number(newUsersLast7d[0].count),
      newUsersLast30d: Number(newUsersLast30d[0].count),
      mrr,
      arr: mrr * 12,
      conversionRate,
      churnRate,
      churnedThisMonth: churned,
      churnedLastMonth: Number(cancelledLastMonth[0].count),
      planBreakdown: planBreakdown.map((r) => ({ plan: r.plan ?? "unknown", count: Number(r.count) })),
      aiCost: parseFloat((aiCostRow[0]?.totalCost ?? "0").toString()),
      aiRequests: Number(aiCostRow[0]?.totalRequests ?? 0),
      signupTrend: rows.map((r) => ({ day: String(r.day), count: Number(r.cnt) })),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching owner analytics");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

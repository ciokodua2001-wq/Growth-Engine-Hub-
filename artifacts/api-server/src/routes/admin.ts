import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
  projectsTable,
  featureFlagsTable,
  announcementsTable,
  adminAuditLogsTable,
  subscriptionUsageEventsTable,
  adminAlertsTable,
} from "@workspace/db";
import { eq, desc, count, sql, and, ilike, or, sum, max, isNotNull } from "drizzle-orm";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { PassThrough } from "stream";
import { computeRefundStatus, PLAN_MONTHLY_AI_CEILING, REFUND_INELIGIBILITY_THRESHOLD } from "../lib/usageCosts.js";
import { contentIntegrityLogTable } from "@workspace/db";

const router: IRouter = Router();

/* ─── helpers ──────────────────────────────────────────────── */

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

async function auditLog(
  adminId: string,
  adminEmail: string | null | undefined,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>,
) {
  await db.insert(adminAuditLogsTable).values({
    adminId,
    adminEmail: adminEmail ?? null,
    action,
    targetType: targetType ?? null,
    targetId: targetId ?? null,
    details: details ?? null,
  });
}

/** Returns 403 if the target user is the platform owner or a super_admin. */
async function guardOwner(
  req: Request,
  res: Response,
  targetId: string,
  attemptedAction: string,
): Promise<boolean> {
  const [target] = await db
    .select({ role: usersTable.role, isOwner: usersTable.isOwner, email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, targetId));

  if (!target) return false; // let the caller handle 404

  if (target.isOwner || target.role === "super_admin") {
    const auth = getAuth(req);
    // Log the unauthorized attempt
    await auditLog(
      auth.userId ?? "unknown",
      auth.sessionClaims?.email as string | undefined,
      "unauthorized_modify_owner",
      "user",
      targetId,
      { attempted: attemptedAction, targetEmail: target.email },
    ).catch(() => {});

    res.status(403).json({ error: "Platform Owner account cannot be modified." });
    return true; // blocked
  }
  return false; // allowed
}

/* ─── Stats ─────────────────────────────────────────────────── */

router.get("/admin/stats", requireAdmin, async (req, res): Promise<void> => {
  try {
    const [
      totalUsers,
      trialUsers,
      paidUsers,
      cancelledUsers,
      totalProjects,
    ] = await Promise.all([
      db.select({ count: count() }).from(usersTable),
      db.select({ count: count() }).from(usersTable).where(eq(usersTable.subscriptionStatus, "trial")),
      db.select({ count: count() }).from(usersTable).where(sql`${usersTable.subscriptionStatus} IN ('active', 'paid')`),
      db.select({ count: count() }).from(usersTable).where(eq(usersTable.subscriptionStatus, "cancelled")),
      db.select({ count: count() }).from(projectsTable),
    ]);

    res.json({
      totalUsers: totalUsers[0].count,
      trialUsers: trialUsers[0].count,
      paidUsers: paidUsers[0].count,
      cancelledUsers: cancelledUsers[0].count,
      activeUsers: paidUsers[0].count,
      totalProjects: totalProjects[0].count,
      monthlyRevenue: 0,
      annualRevenue: 0,
      totalAiRequests: 0,
      estimatedAiCost: 0,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching admin stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Users ─────────────────────────────────────────────────── */

router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  try {
    const search = req.query.search as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string ?? "50", 10), 200);
    const offset = parseInt(req.query.offset as string ?? "0", 10);

    const where = search
      ? or(ilike(usersTable.email, `%${search}%`))
      : undefined;

    const users = await db
      .select()
      .from(usersTable)
      .where(where)
      .orderBy(desc(usersTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(usersTable)
      .where(where);

    res.json({ users, total });
  } catch (err) {
    req.log.error({ err }, "Error fetching users");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id as string));
    if (!user) { res.status(404).json({ error: "Not found" }); return; }

    const userProjects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.ownerId, req.params.id as string))
      .orderBy(desc(projectsTable.createdAt))
      .limit(10);

    res.json({ ...user, projects: userProjects });
  } catch (err) {
    req.log.error({ err }, "Error fetching user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);

    // ── Owner protection ──────────────────────────────────────
    const blocked = await guardOwner(req, res, req.params.id as string, "patch");
    if (blocked) return;

    const { role, plan, subscriptionStatus, suspended } = req.body as {
      role?: string; plan?: string; subscriptionStatus?: string; suspended?: boolean;
    };

    // Prevent any admin from granting super_admin via this endpoint
    const safeRole = role === "super_admin" ? undefined : role;

    const update: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
    if (safeRole !== undefined) update.role = safeRole;
    if (plan !== undefined) update.plan = plan;
    const reactivating = subscriptionStatus !== undefined && subscriptionStatus !== "cancelled";

    if (subscriptionStatus !== undefined) {
      update.subscriptionStatus = subscriptionStatus;
      if (subscriptionStatus === "cancelled" && !update.cancelledAt) {
        update.cancelledAt = new Date();
      } else if (subscriptionStatus !== "cancelled") {
        update.cancelledAt = null;
      }
    }
    if (suspended !== undefined) update.suspended = suspended;

    const targetUserId = req.params.id as string;

    const [user] = await db.transaction(async (tx) => {
      const [updated] = await tx.update(usersTable).set(update).where(eq(usersTable.id, targetUserId)).returning();
      if (reactivating && updated) {
        await tx
          .update(projectsTable)
          .set({ deletedAt: null })
          .where(and(eq(projectsTable.ownerId, targetUserId), isNotNull(projectsTable.deletedAt)));
      }
      return [updated];
    });
    if (!user) { res.status(404).json({ error: "Not found" }); return; }

    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "user_updated", "user", targetUserId, { changes: update, projectsRestored: reactivating });
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Error updating user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);

    // ── Owner protection ──────────────────────────────────────
    const blocked = await guardOwner(req, res, req.params.id as string, "delete");
    if (blocked) return;

    await db.delete(usersTable).where(eq(usersTable.id, req.params.id as string));
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "user_deleted", "user", req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting user");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Projects ───────────────────────────────────────────────── */

router.get("/admin/projects", requireAdmin, async (req, res): Promise<void> => {
  try {
    const search = req.query.search as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string ?? "50", 10), 200);
    const offset = parseInt(req.query.offset as string ?? "0", 10);

    const where = search
      ? or(
          ilike(projectsTable.name, `%${search}%`),
          ilike(projectsTable.websiteUrl, `%${search}%`),
        )
      : undefined;

    const projects = await db
      .select()
      .from(projectsTable)
      .where(where)
      .orderBy(desc(projectsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(projectsTable).where(where);

    res.json({ projects, total });
  } catch (err) {
    req.log.error({ err }, "Error fetching projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/projects/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    await db.delete(projectsTable).where(eq(projectsTable.id, parseInt(req.params.id as string, 10)));
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "project_deleted", "project", req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting project");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Feature Flags ─────────────────────────────────────────── */

router.get("/admin/feature-flags", requireAdmin, async (req, res): Promise<void> => {
  try {
    const flags = await db.select().from(featureFlagsTable).orderBy(featureFlagsTable.name);
    res.json(flags);
  } catch (err) {
    req.log.error({ err }, "Error fetching feature flags");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/feature-flags/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const { enabled } = req.body as { enabled: boolean };

    const [flag] = await db
      .update(featureFlagsTable)
      .set({ enabled, updatedBy: auth.userId!, updatedAt: new Date() })
      .where(eq(featureFlagsTable.id, parseInt(req.params.id as string, 10)))
      .returning();

    if (!flag) { res.status(404).json({ error: "Not found" }); return; }
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, enabled ? "feature_enabled" : "feature_disabled", "feature_flag", req.params.id as string, { name: flag.name });
    res.json(flag);
  } catch (err) {
    req.log.error({ err }, "Error updating feature flag");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Announcements ─────────────────────────────────────────── */

router.get("/admin/announcements", requireAdmin, async (req, res): Promise<void> => {
  try {
    const announcements = await db.select().from(announcementsTable).orderBy(desc(announcementsTable.createdAt));
    res.json(announcements);
  } catch (err) {
    req.log.error({ err }, "Error fetching announcements");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/announcements", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const { title, message, type, expiresAt } = req.body as {
      title: string; message: string; type?: string; expiresAt?: string;
    };

    const [announcement] = await db
      .insert(announcementsTable)
      .values({ title, message, type: type ?? "info", createdBy: auth.userId!, expiresAt: expiresAt ? new Date(expiresAt) : null })
      .returning();

    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "announcement_created", "announcement", String(announcement.id), { title });
    res.json(announcement);
  } catch (err) {
    req.log.error({ err }, "Error creating announcement");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const { title, message, type, active, expiresAt } = req.body as {
      title?: string; message?: string; type?: string; active?: boolean; expiresAt?: string;
    };

    const update: Partial<typeof announcementsTable.$inferInsert> = {};
    if (title !== undefined) update.title = title;
    if (message !== undefined) update.message = message;
    if (type !== undefined) update.type = type;
    if (active !== undefined) update.active = active;
    if (expiresAt !== undefined) update.expiresAt = expiresAt ? new Date(expiresAt) : null;

    const [announcement] = await db
      .update(announcementsTable)
      .set(update)
      .where(eq(announcementsTable.id, parseInt(req.params.id as string, 10)))
      .returning();

    if (!announcement) { res.status(404).json({ error: "Not found" }); return; }
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "announcement_updated", "announcement", req.params.id as string);
    res.json(announcement);
  } catch (err) {
    req.log.error({ err }, "Error updating announcement");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    await db.delete(announcementsTable).where(eq(announcementsTable.id, parseInt(req.params.id as string, 10)));
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "announcement_deleted", "announcement", req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting announcement");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Audit Logs ────────────────────────────────────────────── */

router.get("/admin/audit-logs", requireAdmin, async (req, res): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string ?? "100", 10), 500);
    const offset = parseInt(req.query.offset as string ?? "0", 10);

    const logs = await db
      .select()
      .from(adminAuditLogsTable)
      .orderBy(desc(adminAuditLogsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(adminAuditLogsTable);
    res.json({ logs, total });
  } catch (err) {
    req.log.error({ err }, "Error fetching audit logs");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Feature Flags seed ────────────────────────────────────── */

const DEFAULT_FLAGS = [
  { name: "forge_ai", label: "Forge AI Agent", description: "Enable the AI marketing agent for all users", enabled: true },
  { name: "video_studio", label: "Video Studio", description: "Enable video blueprint generation", enabled: true },
  { name: "competitor_intelligence", label: "Competitor Intelligence", description: "Enable competitor discovery and analysis", enabled: true },
  { name: "email_generation", label: "Email Campaigns", description: "Enable AI email campaign generation", enabled: true },
  { name: "social_content", label: "Social Content", description: "Enable social media post generation", enabled: true },
  { name: "campaign_builder", label: "Campaign Builder", description: "Enable full campaign creation workflows", enabled: true },
  { name: "analytics_dashboard", label: "Analytics Dashboard", description: "Show analytics dashboard to users", enabled: true },
  { name: "onboarding_wizard", label: "Onboarding Wizard", description: "Show the onboarding wizard to new users", enabled: true },
  { name: "api_integrations", label: "API Integrations", description: "Enable third-party API integrations", enabled: false },
];

router.post("/admin/feature-flags/seed", requireAdmin, async (req, res): Promise<void> => {
  try {
    for (const flag of DEFAULT_FLAGS) {
      await db
        .insert(featureFlagsTable)
        .values(flag)
        .onConflictDoNothing();
    }
    const flags = await db.select().from(featureFlagsTable).orderBy(featureFlagsTable.name);
    res.json(flags);
  } catch (err) {
    req.log.error({ err }, "Error seeding feature flags");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Subscribers: usage monitor + refund eligibility ──────── */

router.get("/admin/subscribers", requireAdmin, async (req, res): Promise<void> => {
  try {
    const users = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        plan: usersTable.plan,
        subscriptionStatus: usersTable.subscriptionStatus,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .orderBy(desc(usersTable.createdAt));

    const results = await Promise.all(
      users.map(async (user) => {
        const billingPeriodStart = new Date(user.createdAt);
        billingPeriodStart.setDate(1);
        billingPeriodStart.setHours(0, 0, 0, 0);

        const usageRows = await db
          .select({
            totalCost: sum(subscriptionUsageEventsTable.costUsd),
            hasVideoRender: max(sql<number>`CASE WHEN ${subscriptionUsageEventsTable.isVideoRender} THEN 1 ELSE 0 END`),
            eventCount: count(),
          })
          .from(subscriptionUsageEventsTable)
          .where(
            and(
              eq(subscriptionUsageEventsTable.userId, user.id),
              sql`${subscriptionUsageEventsTable.billingPeriodStart} >= ${billingPeriodStart}`,
            ),
          );

        const consumedUsd = parseFloat(String(usageRows[0]?.totalCost ?? 0));
        const hasVideoRender = Number(usageRows[0]?.hasVideoRender ?? 0) > 0;
        const eventCount = Number(usageRows[0]?.eventCount ?? 0);
        const status = computeRefundStatus(consumedUsd, user.plan, hasVideoRender, billingPeriodStart.getTime());

        return {
          ...user,
          consumedUsd,
          ceilingUsd: status.ceilingUsd,
          consumedPct: status.consumedPct,
          hasVideoRender,
          eligibility: status.eligibility,
          eligibilityReason: status.reason,
          withinWindow: status.withinWindow,
          eventCount,
        };
      }),
    );

    res.json({ subscribers: results, total: results.length });
  } catch (err) {
    req.log.error({ err }, "Error fetching subscribers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/subscribers/:userId/usage", requireAdmin, async (req, res): Promise<void> => {
  try {
    const userId = req.params["userId"] as string;

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        plan: usersTable.plan,
        subscriptionStatus: usersTable.subscriptionStatus,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const billingPeriodStart = new Date(user.createdAt);
    billingPeriodStart.setDate(1);
    billingPeriodStart.setHours(0, 0, 0, 0);

    const events = await db
      .select()
      .from(subscriptionUsageEventsTable)
      .where(eq(subscriptionUsageEventsTable.userId, userId))
      .orderBy(desc(subscriptionUsageEventsTable.createdAt))
      .limit(200);

    const consumedUsd = events.reduce((acc, e) => acc + e.costUsd, 0);
    const hasVideoRender = events.some((e) => e.isVideoRender);
    const status = computeRefundStatus(consumedUsd, user.plan, hasVideoRender, billingPeriodStart.getTime());

    res.json({
      subscriber: {
        ...user,
        consumedUsd,
        ceilingUsd: status.ceilingUsd,
        consumedPct: status.consumedPct,
        hasVideoRender,
        eligibility: status.eligibility,
        eligibilityReason: status.reason,
        withinWindow: status.withinWindow,
        eventCount: events.length,
      },
      events,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching subscriber usage");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Rebuttal PDF ──────────────────────────────────────────── */

async function buildRebuttalPdfBuffer(userId: string): Promise<{ buffer: Buffer; email: string | null; plan: string }> {
  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, plan: usersTable.plan, subscriptionStatus: usersTable.subscriptionStatus, createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) throw new Error("User not found");

  const billingPeriodStart = new Date(user.createdAt);
  billingPeriodStart.setDate(1);
  billingPeriodStart.setHours(0, 0, 0, 0);

  const events = await db
    .select()
    .from(subscriptionUsageEventsTable)
    .where(eq(subscriptionUsageEventsTable.userId, userId))
    .orderBy(desc(subscriptionUsageEventsTable.createdAt))
    .limit(200);

  const consumedUsd = events.reduce((acc, e) => acc + e.costUsd, 0);
  const hasVideoRender = events.some((e) => e.isVideoRender);
  const ceiling = PLAN_MONTHLY_AI_CEILING[user.plan.toLowerCase()] ?? PLAN_MONTHLY_AI_CEILING["starter"];
  const status = computeRefundStatus(consumedUsd, user.plan, hasVideoRender, billingPeriodStart.getTime());
  const generatedAt = new Date().toUTCString();

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: "A4" });
    const chunks: Buffer[] = [];
    const stream = new PassThrough();

    stream.on("data", (c) => chunks.push(c as Buffer));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    doc.pipe(stream);

    const GREEN = "#00E676";
    const DARK = "#040B14";
    const GRAY = "#7a8fa6";
    const RED = "#ef4444";
    const W = 595 - 120; // usable width

    // Header bar
    doc.rect(0, 0, 595, 80).fill(DARK);
    doc.font("Helvetica-Bold").fontSize(18).fillColor(GREEN).text("GrowthForge AI", 60, 24);
    doc.font("Helvetica").fontSize(9).fillColor(GRAY).text("Strapli Technologies Inc. · billing@usegrowthforge.com", 60, 46);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff").text("CHARGEBACK REBUTTAL REPORT", 60, 60);

    let y = 100;

    const row = (label: string, value: string, bold = false) => {
      doc.font("Helvetica").fontSize(9).fillColor(GRAY).text(label, 60, y);
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#ffffff").text(value, 240, y);
      y += 18;
    };

    // Subscriber info
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GREEN).text("SUBSCRIBER", 60, y);
    y += 14;
    doc.moveTo(60, y).lineTo(535, y).strokeColor(GREEN).lineWidth(0.5).stroke();
    y += 8;
    row("User ID", user.id);
    row("Email", user.email ?? "(not available)");
    row("Plan", `${user.plan.toUpperCase()} ($${user.plan === "starter" ? 39 : user.plan === "get-going" ? 99 : user.plan === "growth" ? 299 : 799}/mo)`);
    row("Account created", new Date(user.createdAt).toUTCString());
    row("Billing period start", billingPeriodStart.toUTCString());
    row("Report generated", generatedAt);
    y += 10;

    // Refund eligibility summary
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GREEN).text("REFUND ELIGIBILITY DETERMINATION", 60, y);
    y += 14;
    doc.moveTo(60, y).lineTo(535, y).strokeColor(GREEN).lineWidth(0.5).stroke();
    y += 8;

    const verdictColor = status.eligibility === "eligible" ? "#00E676" : "#ef4444";
    const verdictText = status.eligibility === "non_refundable" ? "NON-REFUNDABLE" :
                        status.eligibility === "borderline" ? "BORDERLINE — MANUAL REVIEW REQUIRED" : "ELIGIBLE";

    doc.font("Helvetica-Bold").fontSize(11).fillColor(verdictColor).text(`Verdict: ${verdictText}`, 60, y);
    y += 20;

    row("AI resources consumed (USD)", `$${consumedUsd.toFixed(4)}`);
    row("Monthly AI ceiling for plan", `$${ceiling.toFixed(2)}`);
    row("Consumption as % of ceiling", `${(status.consumedPct * 100).toFixed(2)}%`);
    row("Ineligibility threshold", `${(REFUND_INELIGIBILITY_THRESHOLD * 100).toFixed(0)}% of ceiling (internal)`);
    row("Video render initiated", hasVideoRender ? "YES — subscription fully earned" : "No");
    row("Within 3-day refund window", status.withinWindow ? "Yes" : "No — window expired");
    row("Ineligibility reason", status.reason.replace(/_/g, " "));
    y += 10;

    // Policy excerpt
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GREEN).text("POLICY PROVISIONS", 60, y);
    y += 14;
    doc.moveTo(60, y).lineTo(535, y).strokeColor(GREEN).lineWidth(0.5).stroke();
    y += 8;

    const policyText = [
      "Terms of Service §5 — Paid Subscriptions, Usage & Refund Terms (excerpt):",
      "",
      '"Video Rendering is Non-Refundable: The initiation of any video rendering job — regardless of',
      "render time, output length, or quality tier — immediately renders the subscription payment for",
      "that billing period fully earned and non-refundable. This applies even within the standard refund",
      'window."',
      "",
      '"Usage-Based Refund Eligibility: Refund eligibility is determined by Strapli Technologies based',
      "solely on internal platform usage records. Significant consumption of platform resources, as",
      'determined at our sole discretion, forfeits refund eligibility."',
      "",
      '"Consent to Monitoring: You consent to Strapli Technologies monitoring and recording your',
      "platform usage activity for the purposes of refund eligibility determination, fraud prevention,",
      'and chargeback dispute resolution."',
    ];

    doc.font("Helvetica").fontSize(8).fillColor(GRAY);
    policyText.forEach((line) => {
      doc.text(line, 60, y, { width: W });
      y += doc.heightOfString(line, { width: W }) + 2;
    });
    y += 8;

    // Usage event log
    if (events.length > 0) {
      if (y > 650) { doc.addPage(); y = 60; }

      doc.font("Helvetica-Bold").fontSize(10).fillColor(GREEN).text("USAGE EVENT LOG", 60, y);
      y += 14;
      doc.moveTo(60, y).lineTo(535, y).strokeColor(GREEN).lineWidth(0.5).stroke();
      y += 8;

      // Table header
      doc.font("Helvetica-Bold").fontSize(8).fillColor(GRAY);
      doc.text("Timestamp (UTC)", 60, y);
      doc.text("Feature", 220, y);
      doc.text("Amount", 350, y);
      doc.text("Cost (USD)", 420, y);
      doc.text("Video?", 490, y);
      y += 14;
      doc.moveTo(60, y).lineTo(535, y).strokeColor(GRAY).lineWidth(0.3).stroke();
      y += 5;

      const maxEvents = Math.min(events.length, 40);
      for (let i = 0; i < maxEvents; i++) {
        const ev = events[i];
        if (y > 750) { doc.addPage(); y = 60; }
        doc.font("Helvetica").fontSize(7.5).fillColor("#ffffff");
        doc.text(new Date(ev.createdAt).toUTCString().replace(" GMT", ""), 60, y, { width: 155 });
        doc.text(ev.feature.replace(/_/g, " "), 220, y, { width: 125 });
        doc.text(String(ev.amount), 350, y, { width: 65 });
        doc.text(`$${ev.costUsd.toFixed(4)}`, 420, y, { width: 65 });
        doc.text(ev.isVideoRender ? "YES" : "—", 490, y, { width: 45 });
        y += 13;
      }

      if (events.length > maxEvents) {
        doc.font("Helvetica").fontSize(7.5).fillColor(GRAY).text(`… and ${events.length - maxEvents} more events`, 60, y + 4);
        y += 16;
      }
    }

    y += 16;
    // Certification
    if (y > 700) { doc.addPage(); y = 60; }
    doc.moveTo(60, y).lineTo(535, y).strokeColor(GRAY).lineWidth(0.3).stroke();
    y += 10;
    doc.font("Helvetica").fontSize(8).fillColor(GRAY).text(
      "This report is generated automatically from platform usage logs maintained by Strapli Technologies Inc. " +
      "All timestamps are in UTC. Usage data is stored server-side and has not been modified. " +
      "This document may be submitted as evidence in payment dispute proceedings.",
      60, y, { width: W },
    );

    doc.end();
  });

  return { buffer, email: user.email, plan: user.plan };
}

router.get("/admin/subscribers/:userId/rebuttal-report", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = req.params["userId"] as string;

    const { buffer, email } = await buildRebuttalPdfBuffer(userId);

    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "rebuttal_report_downloaded", "user", userId, { targetEmail: email });

    const safeId = userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="rebuttal-${safeId}.pdf"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.end(buffer);
  } catch (err) {
    req.log.error({ err }, "Error generating rebuttal report");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/subscribers/:userId/flag-chargeback", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = req.params["userId"] as string;

    const { buffer, email, plan } = await buildRebuttalPdfBuffer(userId);

    // Record admin alert
    await db.insert(adminAlertsTable).values({
      type: "chargeback_flagged",
      userId,
      userEmail: email,
      planName: plan,
      dismissed: false,
    });

    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "chargeback_flagged", "user", userId, { targetEmail: email });

    // Email the PDF if SMTP is configured
    const smtpHost = process.env.SMTP_HOST;
    if (smtpHost) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: parseInt(process.env.SMTP_PORT ?? "587", 10),
          secure: false,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
        await transporter.sendMail({
          from: process.env.SMTP_FROM ?? "noreply@usegrowthforge.com",
          to: "billing@usegrowthforge.com",
          subject: `Chargeback Rebuttal Report — ${email ?? userId}`,
          text: `A chargeback has been flagged for subscriber ${email ?? userId} (plan: ${plan}). The automated rebuttal report is attached.`,
          attachments: [
            {
              filename: `rebuttal-${userId.slice(0, 12)}.pdf`,
              content: buffer,
              contentType: "application/pdf",
            },
          ],
        });
      } catch (emailErr) {
        req.log.warn({ err: emailErr }, "Email delivery failed — chargeback still flagged");
      }
    }

    res.json({ success: true, emailSent: !!smtpHost, message: smtpHost ? "Chargeback flagged and rebuttal PDF emailed to billing@usegrowthforge.com" : "Chargeback flagged. Configure SMTP_HOST to enable automatic email delivery." });
  } catch (err) {
    req.log.error({ err }, "Error flagging chargeback");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Admin Alerts ──────────────────────────────────────────── */

router.get("/admin/alerts", requireAdmin, async (req, res): Promise<void> => {
  try {
    const alerts = await db
      .select()
      .from(adminAlertsTable)
      .where(eq(adminAlertsTable.dismissed, false))
      .orderBy(desc(adminAlertsTable.createdAt))
      .limit(100);
    res.json({ alerts });
  } catch (err) {
    req.log.error({ err }, "Error fetching alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/alerts/:id/dismiss", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    await db
      .update(adminAlertsTable)
      .set({ dismissed: true })
      .where(eq(adminAlertsTable.id, parseInt(req.params.id as string, 10)));
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "alert_dismissed", "alert", req.params.id as string);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error dismissing alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Self: promote current user to super_admin (one-time) ─── */

router.post("/admin/self/promote", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [existing] = await db.select({ count: count() }).from(usersTable).where(
      sql`${usersTable.role} IN ('super_admin', 'admin')`
    );

    if (Number(existing.count) > 0) {
      res.status(403).json({ error: "Admin already exists. Contact existing admin to grant access." });
      return;
    }

    const [user] = await db
      .update(usersTable)
      .set({ role: "super_admin", isOwner: true, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning();

    await auditLog(userId, auth.sessionClaims?.email as string, "self_promoted_owner", "user", userId);
    res.json({ message: "Promoted to super_admin and marked as Platform Owner", user });
  } catch (err) {
    req.log.error({ err }, "Error promoting user");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Content Integrity ─────────────────────────────────────── */

router.patch("/admin/users/:userId/test-account", requireAdmin, async (req, res): Promise<void> => {
  try {
    const targetUserId = req.params["userId"] as string;
    const { isTestAccount } = req.body as { isTestAccount: boolean };
    if (typeof isTestAccount !== "boolean") {
      res.status(400).json({ error: "isTestAccount must be a boolean" });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.update(usersTable).set({ isTestAccount }).where(eq(usersTable.id, targetUserId));
      await tx.update(contentIntegrityLogTable).set({ isTestAccount }).where(eq(contentIntegrityLogTable.userId, targetUserId));
    });
    const auth = getAuth(req);
    await auditLog(
      auth.userId ?? "unknown",
      auth.sessionClaims?.email as string | undefined,
      isTestAccount ? "user_marked_test_account" : "user_unmarked_test_account",
      "user",
      targetUserId,
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error toggling test account flag");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/integrity", requireAdmin, async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        userId: contentIntegrityLogTable.userId,
        email: usersTable.email,
        plan: usersTable.plan,
        subscriptionStatus: usersTable.subscriptionStatus,
        isTestAccount: usersTable.isTestAccount,
        totalAssets: count(contentIntegrityLogTable.id),
        firstGenerated: sql<string>`MIN(${contentIntegrityLogTable.generatedAt})`,
        lastGenerated: sql<string>`MAX(${contentIntegrityLogTable.generatedAt})`,
        lastAccessed: sql<string>`MAX(${contentIntegrityLogTable.lastAccessedAt})`,
      })
      .from(contentIntegrityLogTable)
      .leftJoin(usersTable, eq(contentIntegrityLogTable.userId, usersTable.id))
      .groupBy(
        contentIntegrityLogTable.userId,
        usersTable.email,
        usersTable.plan,
        usersTable.subscriptionStatus,
        usersTable.isTestAccount,
      )
      .orderBy(desc(sql`MAX(${contentIntegrityLogTable.generatedAt})`));

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching integrity overview");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/integrity/:userId", requireAdmin, async (req, res): Promise<void> => {
  try {
    const userId = req.params["userId"] as string;
    const assets = await db
      .select()
      .from(contentIntegrityLogTable)
      .where(eq(contentIntegrityLogTable.userId, userId))
      .orderBy(desc(contentIntegrityLogTable.generatedAt));

    const [user] = await db
      .select({ email: usersTable.email, plan: usersTable.plan, subscriptionStatus: usersTable.subscriptionStatus, isOwner: usersTable.isOwner })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    res.json({
      user: user ?? null,
      assets: assets.map((a) => ({
        ...a,
        generatedAt: a.generatedAt.toISOString(),
        firstAccessedAt: a.firstAccessedAt?.toISOString() ?? null,
        lastAccessedAt: a.lastAccessedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching user integrity assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/integrity/:userId/evidence-pdf", requireAdmin, async (req, res): Promise<void> => {
  try {
    const targetUserId = req.params["userId"] as string;
    const auth = getAuth(req);

    const [user] = await db
      .select({ email: usersTable.email, plan: usersTable.plan, createdAt: usersTable.createdAt })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId));

    const assets = await db
      .select()
      .from(contentIntegrityLogTable)
      .where(and(eq(contentIntegrityLogTable.userId, targetUserId), eq(contentIntegrityLogTable.isTestAccount, false)))
      .orderBy(contentIntegrityLogTable.generatedAt);

    await auditLog(
      auth.userId ?? "unknown",
      auth.sessionClaims?.email as string | undefined,
      "integrity_evidence_pdf_downloaded",
      "user",
      targetUserId,
      { assetCount: assets.length },
    );

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const pass = new PassThrough();
    doc.pipe(pass);

    const generatedOn = new Date().toUTCString();
    const green = "#00E676";

    doc.fontSize(22).fillColor(green).text("GrowthForge — Content Integrity Evidence Report", { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#aaaaaa").text(`Generated: ${generatedOn}`, { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#ffffff").text(`User: ${user?.email ?? targetUserId}   Plan: ${user?.plan ?? "—"}   Account created: ${user?.createdAt?.toUTCString() ?? "—"}`, { align: "center" });
    doc.moveDown(1);

    doc.fontSize(12).fillColor("#ffffff").text("Legal Notice", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor("#cccccc").text(
      "This report is an immutable record produced by GrowthForge\'s content integrity system. Each row represents an AI-generated asset delivered to the subscriber\'s account. The SHA-256 hash is computed from the exact content delivered at generation time and is stored independently from the asset itself, providing cryptographic proof of delivery. This document may be submitted as evidence in payment dispute resolution proceedings in accordance with §5 and §7 of the GrowthForge Terms of Service.",
      { lineGap: 3 },
    );
    doc.moveDown(1);

    doc.fontSize(12).fillColor("#ffffff").text(`Asset Delivery Log (${assets.length} records)`, { underline: true });
    doc.moveDown(0.5);

    const colX = [50, 150, 260, 360, 460];
    const headers = ["Type", "Summary", "Content ID", "Generated (UTC)", "Hash (first 16)"];
    doc.fontSize(8).fillColor(green);
    headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: colX[i + 1] ? colX[i + 1] - colX[i] - 4 : 80, continued: i < headers.length - 1 }));
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#444444").stroke();
    doc.moveDown(0.3);

    for (const asset of assets) {
      const y = doc.y;
      if (y > 760) {
        doc.addPage();
        doc.fontSize(8).fillColor(green);
        headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: colX[i + 1] ? colX[i + 1] - colX[i] - 4 : 80, continued: i < headers.length - 1 }));
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor("#444444").stroke();
        doc.moveDown(0.3);
      }
      const rowY = doc.y;
      const cols = [
        asset.contentType.replace(/_/g, " "),
        (asset.summary ?? "—").slice(0, 28),
        `#${asset.contentId}`,
        asset.generatedAt.toISOString().replace("T", " ").slice(0, 19),
        asset.contentHash.slice(0, 16) + "…",
      ];
      doc.fontSize(7.5).fillColor("#dddddd");
      cols.forEach((v, i) => doc.text(v, colX[i], rowY, { width: colX[i + 1] ? colX[i + 1] - colX[i] - 4 : 80, continued: i < cols.length - 1, lineBreak: false }));
      doc.moveDown(0.7);
    }

    doc.moveDown(1);
    doc.fontSize(9).fillColor("#888888").text(
      `Report exported by admin ${auth.sessionClaims?.email ?? auth.userId} on ${generatedOn}. Total verified assets: ${assets.length}. Strapli Technologies Inc.`,
      { align: "center" },
    );

    doc.end();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="integrity-evidence-${targetUserId.slice(0, 8)}-${Date.now()}.pdf"`);
    pass.pipe(res);
  } catch (err) {
    req.log.error({ err }, "Error generating integrity evidence PDF");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

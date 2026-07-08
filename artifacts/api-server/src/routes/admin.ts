import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
  projectsTable,
  featureFlagsTable,
  announcementsTable,
  adminAuditLogsTable,
} from "@workspace/db";
import { eq, desc, count, sql, and, ilike, or } from "drizzle-orm";

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
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
    if (!user) { res.status(404).json({ error: "Not found" }); return; }

    const userProjects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.userId, req.params.id))
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
    const blocked = await guardOwner(req, res, req.params.id, "patch");
    if (blocked) return;

    const { role, plan, subscriptionStatus, suspended } = req.body as {
      role?: string; plan?: string; subscriptionStatus?: string; suspended?: boolean;
    };

    // Prevent any admin from granting super_admin via this endpoint
    const safeRole = role === "super_admin" ? undefined : role;

    const update: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
    if (safeRole !== undefined) update.role = safeRole;
    if (plan !== undefined) update.plan = plan;
    if (subscriptionStatus !== undefined) update.subscriptionStatus = subscriptionStatus;
    if (suspended !== undefined) update.suspended = suspended;

    const [user] = await db.update(usersTable).set(update).where(eq(usersTable.id, req.params.id)).returning();
    if (!user) { res.status(404).json({ error: "Not found" }); return; }

    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "user_updated", "user", req.params.id, { changes: update });
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
    const blocked = await guardOwner(req, res, req.params.id, "delete");
    if (blocked) return;

    await db.delete(usersTable).where(eq(usersTable.id, req.params.id));
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "user_deleted", "user", req.params.id);
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
    await db.delete(projectsTable).where(eq(projectsTable.id, parseInt(req.params.id, 10)));
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "project_deleted", "project", req.params.id);
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
      .where(eq(featureFlagsTable.id, parseInt(req.params.id, 10)))
      .returning();

    if (!flag) { res.status(404).json({ error: "Not found" }); return; }
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, enabled ? "feature_enabled" : "feature_disabled", "feature_flag", req.params.id, { name: flag.name });
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
      .where(eq(announcementsTable.id, parseInt(req.params.id, 10)))
      .returning();

    if (!announcement) { res.status(404).json({ error: "Not found" }); return; }
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "announcement_updated", "announcement", req.params.id);
    res.json(announcement);
  } catch (err) {
    req.log.error({ err }, "Error updating announcement");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    await db.delete(announcementsTable).where(eq(announcementsTable.id, parseInt(req.params.id, 10)));
    await auditLog(auth.userId!, auth.sessionClaims?.email as string, "announcement_deleted", "announcement", req.params.id);
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

export default router;

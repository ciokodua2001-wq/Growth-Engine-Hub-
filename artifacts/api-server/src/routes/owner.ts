import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
  adminAuditLogsTable,
  subscriptionUsageEventsTable,
  ownerContactsTable,
  ownerSegmentsTable,
  ownerSuppressionListTable,
  ownerCampaignsTable,
} from "@workspace/db";
import {
  eq, count, sql, sum, and, gte, lt, isNotNull, ilike, or,
  inArray, desc, type SQL,
} from "drizzle-orm";
import { Resend } from "resend";
import { createHmac } from "crypto";

const router: IRouter = Router();

/* ─── requireOwner middleware ──────────────────────────────────────────────── */

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

const FROM_ADDRESS = "GrowthForge <marketing@usegrowthforge.com>";
const BASE_URL = process.env.PRODUCTION_URL ?? "https://usegrowthforge.com";

/** Returns the signing secret or throws — never falls back to a predictable value */
function getUnsubscribeSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET env var is not set — cannot sign unsubscribe tokens");
  return s;
}

/** Generate an HMAC-signed unsubscribe token */
function signUnsubscribeToken(email: string, campaignId: number): string {
  const payload = `${email}|${campaignId}`;
  const sig = createHmac("sha256", getUnsubscribeSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}|${sig}`).toString("base64url");
}

/** Verify and decode an unsubscribe token → { email, campaignId } | null */
function verifyUnsubscribeToken(token: string): { email: string; campaignId: number } | null {
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return null; // misconfigured — treat token as invalid rather than crash
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 3) return null;
    const [email, cidStr, sig] = parts;
    const payload = `${email}|${cidStr}`;
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (sig !== expected) return null;
    return { email, campaignId: parseInt(cidStr, 10) };
  } catch {
    return null;
  }
}

/** Inject unsubscribe footer into plain-text body */
function injectUnsubscribeLink(body: string, email: string, campaignId: number): { text: string; html: string } {
  const token = signUnsubscribeToken(email, campaignId);
  const url = `${BASE_URL}/api/owner/unsubscribe?token=${token}`;
  const footer = `\n\n---\nYou received this email because you're a contact of GrowthForge.\nTo unsubscribe, click here: ${url}`;
  const htmlFooter = `
<div style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center;">
  You received this because you're a contact of GrowthForge.<br>
  <a href="${url}" style="color:#6b7280;">Unsubscribe</a>
</div>`;
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;">
${body.replace(/\n/g, "<br>")}
${htmlFooter}
</div>`;
  return { text: body + footer, html };
}

/** Simple CSV parser: returns rows as string[][] */
function parseCsv(raw: string): string[][] {
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  return lines.map(line => {
    const cols: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { cols.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    cols.push(current.trim());
    return cols;
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

/* ─── Contacts ─────────────────────────────────────────────────────────────── */

router.get("/owner/contacts", requireOwner, async (req, res): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string ?? "100", 10), 500);
    const offset = parseInt(req.query.offset as string ?? "0", 10);
    const search = req.query.search as string | undefined;
    const tag = req.query.tag as string | undefined;

    let query = db.select().from(ownerContactsTable);
    const conditions = [];
    if (search) {
      conditions.push(or(
        ilike(ownerContactsTable.email, `%${search}%`),
        ilike(ownerContactsTable.firstName, `%${search}%`),
        ilike(ownerContactsTable.lastName, `%${search}%`),
        ilike(ownerContactsTable.company, `%${search}%`),
      ));
    }
    if (tag) {
      conditions.push(sql`${ownerContactsTable.tags} @> ARRAY[${tag}]::text[]`);
    }

    const where = conditions.length > 0
      ? and(...(conditions as [ReturnType<typeof ilike>, ...ReturnType<typeof ilike>[]]))
      : undefined;

    const [contacts, totalResult] = await Promise.all([
      db.select().from(ownerContactsTable)
        .where(where)
        .orderBy(desc(ownerContactsTable.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(ownerContactsTable).where(where),
    ]);

    // Get all unique tags
    const tagsResult = await db.execute(sql`
      SELECT DISTINCT UNNEST(tags) AS tag FROM owner_contacts ORDER BY tag
    `);

    res.json({
      contacts,
      total: Number(totalResult[0].total),
      allTags: (tagsResult.rows as Array<{ tag: string }>).map(r => r.tag),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching owner contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/owner/contacts/import", requireOwner, async (req, res): Promise<void> => {
  try {
    const { csv, tags = [] } = req.body as { csv: string; tags?: string[] };
    if (!csv || typeof csv !== "string") {
      res.status(400).json({ error: "csv field is required" });
      return;
    }

    const rows = parseCsv(csv);
    if (rows.length === 0) {
      res.status(400).json({ error: "No rows found in CSV" });
      return;
    }

    // Detect header row
    const firstRow = rows[0].map(c => c.toLowerCase().replace(/[^a-z_]/g, ""));
    const hasHeader = firstRow.some(c =>
      ["email", "first_name", "last_name", "firstname", "lastname", "company"].includes(c),
    );
    const dataRows = hasHeader ? rows.slice(1) : rows;

    // Map column indices
    let emailIdx = 0, firstIdx = -1, lastIdx = -1, companyIdx = -1;
    if (hasHeader) {
      firstRow.forEach((col, i) => {
        if (col === "email") emailIdx = i;
        else if (["first_name", "firstname"].includes(col)) firstIdx = i;
        else if (["last_name", "lastname"].includes(col)) lastIdx = i;
        else if (col === "company") companyIdx = i;
      });
    }

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid: { email: string; firstName?: string; lastName?: string; company?: string }[] = [];
    const invalid: string[] = [];

    for (const row of dataRows) {
      const email = row[emailIdx]?.toLowerCase()?.trim() ?? "";
      if (!EMAIL_RE.test(email)) { if (email) invalid.push(email); continue; }
      valid.push({
        email,
        firstName: firstIdx >= 0 ? (row[firstIdx]?.trim() || undefined) : undefined,
        lastName: lastIdx >= 0 ? (row[lastIdx]?.trim() || undefined) : undefined,
        company: companyIdx >= 0 ? (row[companyIdx]?.trim() || undefined) : undefined,
      });
    }

    if (valid.length === 0) {
      res.json({ imported: 0, skipped: 0, invalid: invalid.length, total: dataRows.length });
      return;
    }

    // Filter against suppression list
    const validEmails = valid.map(v => v.email);
    const suppressed = await db
      .select({ email: ownerSuppressionListTable.email })
      .from(ownerSuppressionListTable)
      .where(inArray(ownerSuppressionListTable.email, validEmails));
    const suppressedSet = new Set(suppressed.map(s => s.email));
    const toInsert = valid.filter(v => !suppressedSet.has(v.email));

    if (toInsert.length === 0) {
      res.json({ imported: 0, skipped: valid.length, invalid: invalid.length, total: dataRows.length, suppressedCount: suppressed.length });
      return;
    }

    // Bulk insert with conflict skip (deduplication on email)
    await db.insert(ownerContactsTable)
      .values(toInsert.map(c => ({
        email: c.email,
        firstName: c.firstName ?? null,
        lastName: c.lastName ?? null,
        company: c.company ?? null,
        tags: tags.length > 0 ? tags : [],
        source: "import" as const,
      })))
      .onConflictDoNothing();

    const auth = getAuth(req);
    await ownerAuditLog(
      auth.userId!,
      auth.sessionClaims?.email as string,
      "contacts_imported",
      "contacts",
      undefined,
      { count: toInsert.length, tags },
    );

    res.json({
      imported: toInsert.length,
      skipped: valid.length - toInsert.length,
      suppressedCount: suppressedSet.size,
      invalid: invalid.length,
      total: dataRows.length,
    });
  } catch (err) {
    req.log.error({ err }, "Error importing contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/owner/contacts/:id", requireOwner, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const { firstName, lastName, company, tags, unsubscribed } = req.body as {
      firstName?: string; lastName?: string; company?: string; tags?: string[]; unsubscribed?: boolean;
    };
    const update: Partial<typeof ownerContactsTable.$inferInsert> = { updatedAt: new Date() };
    if (firstName !== undefined) update.firstName = firstName;
    if (lastName !== undefined) update.lastName = lastName;
    if (company !== undefined) update.company = company;
    if (tags !== undefined) update.tags = tags;
    if (unsubscribed !== undefined) {
      update.unsubscribed = unsubscribed;
      // Sync to suppression list
      const [contact] = await db.select({ email: ownerContactsTable.email }).from(ownerContactsTable).where(eq(ownerContactsTable.id, id));
      if (contact && unsubscribed) {
        await db.insert(ownerSuppressionListTable)
          .values({ email: contact.email, reason: "unsubscribed" })
          .onConflictDoNothing();
      }
    }
    const [updated] = await db.update(ownerContactsTable).set(update).where(eq(ownerContactsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Contact not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/owner/contacts/:id", requireOwner, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    await db.delete(ownerContactsTable).where(eq(ownerContactsTable.id, id));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Error deleting contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Segments ─────────────────────────────────────────────────────────────── */

router.get("/owner/segments", requireOwner, async (req, res): Promise<void> => {
  try {
    const segments = await db.select().from(ownerSegmentsTable).orderBy(desc(ownerSegmentsTable.createdAt));
    res.json(segments);
  } catch (err) {
    req.log.error({ err }, "Error fetching segments");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/owner/segments", requireOwner, async (req, res): Promise<void> => {
  try {
    const { name, filterJson, segmentType = "external" } = req.body as {
      name: string; filterJson?: Record<string, unknown>; segmentType?: string;
    };
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [seg] = await db.insert(ownerSegmentsTable).values({ name, filterJson: filterJson ?? null, segmentType }).returning();
    res.status(201).json(seg);
  } catch (err) {
    req.log.error({ err }, "Error creating segment");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/owner/segments/:id", requireOwner, async (req, res): Promise<void> => {
  try {
    await db.delete(ownerSegmentsTable).where(eq(ownerSegmentsTable.id, parseInt(req.params.id as string, 10)));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Error deleting segment");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Platform user segment query ─────────────────────────────────────────── */

router.get("/owner/users/segment", requireOwner, async (req, res): Promise<void> => {
  try {
    const {
      subscriptionStatus,
      plan,
      trialEndsBefore,
      lastLoginBefore,
      onboardingComplete,
    } = req.query as Record<string, string | undefined>;

    const conditions = [];
    if (subscriptionStatus && subscriptionStatus !== "all") {
      if (subscriptionStatus === "paid") {
        conditions.push(sql`${usersTable.subscriptionStatus} IN ('active', 'paid')`);
      } else {
        conditions.push(eq(usersTable.subscriptionStatus, subscriptionStatus));
      }
    }
    if (plan && plan !== "all") {
      conditions.push(eq(usersTable.plan, plan));
    }
    if (trialEndsBefore) {
      conditions.push(lt(usersTable.trialEndsAt, new Date(trialEndsBefore)));
    }
    if (lastLoginBefore) {
      conditions.push(lt(usersTable.lastLoginAt, new Date(lastLoginBefore)));
    }
    if (onboardingComplete !== undefined) {
      conditions.push(eq(usersTable.onboardingComplete, onboardingComplete === "true"));
    }

    // Always exclude users with no email and owner accounts
    conditions.push(isNotNull(usersTable.email));
    conditions.push(eq(usersTable.isOwner, false));

    const where = conditions.length > 0 ? and(...(conditions as SQL[])) : undefined;

    const users = await db.select({
      id: usersTable.id,
      email: usersTable.email,
      plan: usersTable.plan,
      subscriptionStatus: usersTable.subscriptionStatus,
      trialEndsAt: usersTable.trialEndsAt,
      lastLoginAt: usersTable.lastLoginAt,
      onboardingComplete: usersTable.onboardingComplete,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(where).orderBy(desc(usersTable.createdAt)).limit(500);

    // Filter against suppression list
    const emails = users.map(u => u.email!).filter(Boolean);
    let suppressedEmails: Set<string> = new Set();
    if (emails.length > 0) {
      const suppressed = await db.select({ email: ownerSuppressionListTable.email })
        .from(ownerSuppressionListTable)
        .where(inArray(ownerSuppressionListTable.email, emails));
      suppressedEmails = new Set(suppressed.map(s => s.email));
    }

    const filtered = users.filter(u => u.email && !suppressedEmails.has(u.email));

    res.json({
      users: filtered,
      total: filtered.length,
      suppressedCount: users.length - filtered.length,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching user segment");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Campaigns ────────────────────────────────────────────────────────────── */

router.get("/owner/campaigns", requireOwner, async (req, res): Promise<void> => {
  try {
    const campaigns = await db.select().from(ownerCampaignsTable).orderBy(desc(ownerCampaignsTable.createdAt));
    res.json(campaigns);
  } catch (err) {
    req.log.error({ err }, "Error fetching campaigns");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/owner/campaigns", requireOwner, async (req, res): Promise<void> => {
  try {
    const { name, subject, body, targetType = "external", segmentId, filterJson } = req.body as {
      name: string; subject: string; body: string;
      targetType?: string; segmentId?: number; filterJson?: Record<string, unknown>;
    };
    if (!name || !subject || !body) {
      res.status(400).json({ error: "name, subject, and body are required" });
      return;
    }
    const [campaign] = await db.insert(ownerCampaignsTable).values({
      name, subject, body,
      targetType,
      segmentId: segmentId ?? null,
      filterJson: filterJson ?? null,
      status: "draft",
    }).returning();
    res.status(201).json(campaign);
  } catch (err) {
    req.log.error({ err }, "Error creating campaign");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/owner/campaigns/:id", requireOwner, async (req, res): Promise<void> => {
  try {
    const [campaign] = await db.select().from(ownerCampaignsTable)
      .where(eq(ownerCampaignsTable.id, parseInt(req.params.id as string, 10)));
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json(campaign);
  } catch (err) {
    req.log.error({ err }, "Error fetching campaign");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/owner/campaigns/:id", requireOwner, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const [existing] = await db.select({ status: ownerCampaignsTable.status }).from(ownerCampaignsTable).where(eq(ownerCampaignsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Campaign not found" }); return; }
    if (existing.status === "sent") { res.status(400).json({ error: "Cannot edit a sent campaign" }); return; }

    const { name, subject, body, targetType, segmentId, filterJson } = req.body as {
      name?: string; subject?: string; body?: string; targetType?: string; segmentId?: number; filterJson?: Record<string, unknown>;
    };
    const update: Partial<typeof ownerCampaignsTable.$inferInsert> = {};
    if (name !== undefined) update.name = name;
    if (subject !== undefined) update.subject = subject;
    if (body !== undefined) update.body = body;
    if (targetType !== undefined) update.targetType = targetType;
    if (segmentId !== undefined) update.segmentId = segmentId;
    if (filterJson !== undefined) update.filterJson = filterJson;

    const [updated] = await db.update(ownerCampaignsTable).set(update).where(eq(ownerCampaignsTable.id, id)).returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating campaign");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/owner/campaigns/:id", requireOwner, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const [existing] = await db.select({ status: ownerCampaignsTable.status }).from(ownerCampaignsTable).where(eq(ownerCampaignsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Campaign not found" }); return; }
    if (existing.status === "sent") { res.status(400).json({ error: "Cannot delete a sent campaign" }); return; }
    await db.delete(ownerCampaignsTable).where(eq(ownerCampaignsTable.id, id));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Error deleting campaign");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Campaign send ─────────────────────────────────────────────────────────── */

router.post("/owner/campaigns/:id/send", requireOwner, async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    const [campaign] = await db.select().from(ownerCampaignsTable).where(eq(ownerCampaignsTable.id, id));
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    if (campaign.status === "sent") { res.status(400).json({ error: "Campaign already sent" }); return; }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) { res.status(503).json({ error: "Email sending not configured" }); return; }

    // ── Resolve recipients ────────────────────────────────────────────────────
    let recipients: Array<{ email: string; firstName?: string | null; lastName?: string | null }> = [];

    if (campaign.targetType === "external") {
      // Resolve segment filter if a segmentId is set, otherwise send to all active contacts
      let resolvedTags: string[] | null = null;

      if (campaign.segmentId != null) {
        const [seg] = await db.select().from(ownerSegmentsTable).where(eq(ownerSegmentsTable.id, campaign.segmentId));
        if (!seg) {
          res.status(400).json({ error: `Segment ${campaign.segmentId} not found — it may have been deleted. Update the campaign to select a different segment.` });
          return;
        }
        const segFilter = seg.filterJson as { tags?: string[] } | null;
        resolvedTags = segFilter?.tags?.length ? segFilter.tags : null;
      }

      let contacts;
      if (resolvedTags && resolvedTags.length > 0) {
        contacts = await db.select().from(ownerContactsTable).where(
          and(
            eq(ownerContactsTable.unsubscribed, false),
            sql`${ownerContactsTable.tags} && ARRAY[${sql.join(resolvedTags.map(t => sql`${t}`), sql`, `)}]::text[]`,
          ),
        );
      } else {
        contacts = await db.select().from(ownerContactsTable).where(eq(ownerContactsTable.unsubscribed, false));
      }
      recipients = contacts.map(c => ({ email: c.email, firstName: c.firstName, lastName: c.lastName }));

    } else if (campaign.targetType === "broadcast") {
      const platformUsers = await db.select({ email: usersTable.email })
        .from(usersTable)
        .where(and(isNotNull(usersTable.email), eq(usersTable.isOwner, false)));
      recipients = platformUsers.map(u => ({ email: u.email! }));

    } else if (campaign.targetType === "platform_users") {
      const filter = campaign.filterJson as Record<string, string> | null;
      const conditions = [isNotNull(usersTable.email), eq(usersTable.isOwner, false)];
      if (filter?.subscriptionStatus && filter.subscriptionStatus !== "all") {
        if (filter.subscriptionStatus === "paid") {
          conditions.push(sql`${usersTable.subscriptionStatus} IN ('active', 'paid')`);
        } else {
          conditions.push(eq(usersTable.subscriptionStatus, filter.subscriptionStatus));
        }
      }
      if (filter?.plan && filter.plan !== "all") conditions.push(eq(usersTable.plan, filter.plan));
      const platformUsers = await db.select({ email: usersTable.email })
        .from(usersTable)
        .where(and(...(conditions as SQL[])));
      recipients = platformUsers.map(u => ({ email: u.email! }));
    }

    // ── Filter suppression list ────────────────────────────────────────────────
    const emails = recipients.map(r => r.email);
    if (emails.length > 0) {
      const suppressed = await db.select({ email: ownerSuppressionListTable.email })
        .from(ownerSuppressionListTable)
        .where(inArray(ownerSuppressionListTable.email, emails));
      const suppressedSet = new Set(suppressed.map(s => s.email));
      recipients = recipients.filter(r => !suppressedSet.has(r.email));
    }

    if (recipients.length === 0) {
      res.status(400).json({ error: "No eligible recipients after suppression filtering" });
      return;
    }

    // ── Send in batches of 50 ─────────────────────────────────────────────────
    const resend = new Resend(apiKey);
    const BATCH_SIZE = 50;
    let failCount = 0;

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      const messages = batch.map(r => {
        const { text, html } = injectUnsubscribeLink(campaign.body, r.email, id);
        const firstName = r.firstName || "";
        const subject = campaign.subject
          .replace(/\{\{first_name\}\}/gi, firstName || "there")
          .replace(/\{\{name\}\}/gi, firstName || "there");
        return { from: FROM_ADDRESS, to: r.email, subject, text, html };
      });

      const { error } = await resend.batch.send(messages);
      if (error) {
        req.log.error({ error, campaignId: id }, "Resend batch send failed");
        failCount += batch.length;
      }
    }

    const sentCount = recipients.length - failCount;

    if (sentCount === 0) {
      res.status(502).json({ error: "All sends failed. Check Resend configuration.", sentCount: 0, failCount });
      return;
    }

    // ── Mark campaign sent ────────────────────────────────────────────────────
    const [updated] = await db.update(ownerCampaignsTable)
      .set({ status: "sent", sentAt: new Date(), recipientCount: sentCount })
      .where(eq(ownerCampaignsTable.id, id))
      .returning();

    const auth = getAuth(req);
    await ownerAuditLog(
      auth.userId!,
      auth.sessionClaims?.email as string,
      "campaign_sent",
      "owner_campaign",
      String(id),
      { campaignName: campaign.name, sentCount, failCount, targetType: campaign.targetType },
    );

    res.json({ ...updated, sentCount, failCount });
  } catch (err) {
    req.log.error({ err }, "Error sending campaign");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Suppression list ──────────────────────────────────────────────────────── */

router.get("/owner/suppression", requireOwner, async (req, res): Promise<void> => {
  try {
    const entries = await db.select().from(ownerSuppressionListTable).orderBy(desc(ownerSuppressionListTable.addedAt)).limit(500);
    res.json(entries);
  } catch (err) {
    req.log.error({ err }, "Error fetching suppression list");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/owner/suppression/:email", requireOwner, async (req, res): Promise<void> => {
  try {
    const email = decodeURIComponent(req.params.email as string);
    await db.delete(ownerSuppressionListTable).where(eq(ownerSuppressionListTable.email, email));
    res.sendStatus(204);
  } catch (err) {
    req.log.error({ err }, "Error removing from suppression list");
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ─── Unsubscribe (public, no auth) ────────────────────────────────────────── */

router.get("/owner/unsubscribe", async (req, res): Promise<void> => {
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(400).send("<h2>Invalid unsubscribe link.</h2>");
    return;
  }

  const decoded = verifyUnsubscribeToken(token);
  if (!decoded) {
    res.status(400).send("<h2>Invalid or expired unsubscribe link.</h2>");
    return;
  }

  try {
    // Add to suppression list
    await db.insert(ownerSuppressionListTable)
      .values({ email: decoded.email, reason: "unsubscribed" })
      .onConflictDoNothing();

    // Mark contact as unsubscribed if they're in the contacts table
    await db.update(ownerContactsTable)
      .set({ unsubscribed: true, updatedAt: new Date() })
      .where(eq(ownerContactsTable.email, decoded.email));

    // Increment campaign unsubscribe count
    await db.update(ownerCampaignsTable)
      .set({ unsubscribeCount: sql`${ownerCampaignsTable.unsubscribeCount} + 1` })
      .where(eq(ownerCampaignsTable.id, decoded.campaignId));

    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Unsubscribed</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}
.card{background:#fff;border-radius:12px;padding:40px;max-width:440px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);}
h1{font-size:22px;color:#111;}p{color:#6b7280;line-height:1.6;}</style>
</head>
<body><div class="card">
<h1>✓ You've been unsubscribed</h1>
<p>${decoded.email} has been removed from our mailing list. You won't receive any further marketing emails from us.</p>
</div></body></html>`);
  } catch (err) {
    res.status(500).send("<h2>Something went wrong. Please try again later.</h2>");
  }
});

export default router;

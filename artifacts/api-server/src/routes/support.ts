import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { supportTicketsTable, supportKnowledgeBaseTable, usersTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { Resend } from "resend";
import { generateJsonFast } from "../lib/aiJson.js";
import { requireOwner } from "./owner.js";

const router: IRouter = Router();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const SUPPORT_FROM = "GrowthForge Support <support@usegrowthforge.com>";
const BASE_URL = process.env.PRODUCTION_URL ?? "https://usegrowthforge.com";
const ESCALATION_EMAIL = process.env.SUPPORT_ESCALATION_EMAIL ?? "growthforge101@gmail.com";

// ── Knowledge base cache ──────────────────────────────────────────────────────

let kbCache: { content: string; fetchedAt: number } | null = null;
const KB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getKnowledgeBase(): Promise<string> {
  if (kbCache && Date.now() - kbCache.fetchedAt < KB_CACHE_TTL_MS) {
    return kbCache.content;
  }
  try {
    const [row] = await db.select().from(supportKnowledgeBaseTable).limit(1);
    const content = row?.content ?? "";
    kbCache = { content, fetchedAt: Date.now() };
    return content;
  } catch {
    return kbCache?.content ?? "";
  }
}

function invalidateKbCache(): void {
  kbCache = null;
}

// ── Owner email lookup ────────────────────────────────────────────────────────

async function getOwnerEmail(): Promise<string | null> {
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;
    const [owner] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isOwner, true))
      .limit(1);
    if (!owner?.id) return null;
    const r = await fetch(`https://api.clerk.com/v1/users/${owner.id}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!r.ok) return null;
    const user = await r.json() as { email_addresses?: Array<{ email_address: string }> };
    return user.email_addresses?.[0]?.email_address ?? null;
  } catch {
    return null;
  }
}

// ── AI support agent ──────────────────────────────────────────────────────────

interface AiSupportResult {
  category: "technical" | "billing" | "sales" | "demo" | "partnership" | "feedback" | "other";
  response: string;
  escalate: boolean;
  escalateReason?: string;
}

const AGENT_INSTRUCTIONS = `You are the AI support agent for GrowthForge. Answer every ticket using ONLY the facts in the knowledge base below. Do not invent features, prices, or policies not listed there.

ESCALATE to a human when the customer:
- Demands a refund or disputes a charge
- Requests account deletion or data export
- Makes a legal threat, DMCA, or copyright claim
- Reports suspected fraud or unauthorized access
- Asks something you genuinely cannot answer accurately from the knowledge base

DO NOT escalate for: how-to questions, feature questions, trial questions, plan comparisons, general billing questions (explaining plans is fine — disputes need escalation), or any question the knowledge base answers clearly.

Write your response directly to the customer (first-person, warm, specific). Address them by first name. Never give a generic "we'll look into it" answer if the knowledge base has the real answer. Keep it to 2–4 paragraphs max.

Respond ONLY with this JSON object — no prose, no markdown wrapper:
{
  "category": "technical" | "billing" | "sales" | "demo" | "partnership" | "feedback" | "other",
  "response": "your full reply to the customer",
  "escalate": true | false,
  "escalateReason": "brief internal note if escalate is true, omit otherwise"
}`;

async function generateSupportResponse(
  name: string,
  subject: string,
  message: string,
): Promise<AiSupportResult> {
  const kb = await getKnowledgeBase();
  const kbSection = kb.trim()
    ? `\n\n--- GROWTHFORGE KNOWLEDGE BASE ---\n${kb.trim()}\n--- END KNOWLEDGE BASE ---`
    : "";

  return generateJsonFast<AiSupportResult>({
    system: AGENT_INSTRUCTIONS + kbSection,
    prompt: `Customer name: ${name}\nSubject: ${subject}\nMessage: ${message}`,
    maxTokens: 1024,
    label: "support-agent",
  });
}

// ── Email helpers ─────────────────────────────────────────────────────────────

function supportEmailHtml(customerName: string, aiResponse: string, ticketSubject: string): string {
  const escaped = aiResponse.replace(/\n/g, "<br>");
  return `
<div style="font-family:sans-serif;max-width:580px;margin:0 auto;background:#040B14;padding:32px;border-radius:14px;color:#e5e7eb;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
    <div style="background:#00E67620;border-radius:8px;padding:7px 10px;font-size:18px;">⚡</div>
    <span style="font-weight:800;font-size:17px;color:#fff;">GrowthForge Support</span>
  </div>
  <p style="color:#9ca3af;font-size:13px;margin:0 0 6px;">Re: <strong style="color:#e5e7eb;">${ticketSubject}</strong></p>
  <p style="color:#9ca3af;font-size:13px;margin:0 0 24px;">Hi ${customerName},</p>
  <div style="background:#0d1a0d;border:1px solid #00E67630;border-radius:10px;padding:20px 24px;color:#d1fae5;font-size:14px;line-height:1.7;margin-bottom:28px;">
    ${escaped}
  </div>
  <p style="color:#6b7280;font-size:12px;margin:0 0 20px;">If this answered your question, no reply is needed. If you need more help, just reply to this email — a real human will be in touch.</p>
  <a href="${BASE_URL}" style="display:inline-block;background:#00E676;color:#040B14;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;">Open GrowthForge →</a>
  <p style="color:#374151;font-size:11px;margin:28px 0 0;">GrowthForge · <a href="${BASE_URL}/contact" style="color:#374151;">Contact</a></p>
</div>`;
}

function escalationEmailHtml(name: string, email: string, subject: string, message: string, aiResponse: string, reason?: string): string {
  return `
<div style="font-family:sans-serif;max-width:580px;margin:0 auto;background:#040B14;padding:32px;border-radius:14px;color:#e5e7eb;">
  <h2 style="color:#ef4444;margin:0 0 20px;">🚨 Support Escalation</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
    <tr><td style="color:#9ca3af;font-size:13px;padding:4px 0;width:80px;">From</td><td style="color:#fff;font-size:13px;">${name} &lt;${email}&gt;</td></tr>
    <tr><td style="color:#9ca3af;font-size:13px;padding:4px 0;">Subject</td><td style="color:#fff;font-size:13px;">${subject}</td></tr>
    ${reason ? `<tr><td style="color:#9ca3af;font-size:13px;padding:4px 0;">Reason</td><td style="color:#fca5a5;font-size:13px;">${reason}</td></tr>` : ""}
  </table>
  <p style="color:#9ca3af;font-size:12px;margin:0 0 6px;">Customer message:</p>
  <div style="background:#1a0a0a;border:1px solid #ef444430;border-radius:8px;padding:16px;color:#fca5a5;font-size:13px;line-height:1.6;margin-bottom:20px;">${message.replace(/\n/g, "<br>")}</div>
  <p style="color:#9ca3af;font-size:12px;margin:0 0 6px;">AI's attempted response (sent to customer):</p>
  <div style="background:#0d1a0d;border:1px solid #00E67630;border-radius:8px;padding:16px;color:#d1fae5;font-size:13px;line-height:1.6;margin-bottom:24px;">${aiResponse.replace(/\n/g, "<br>")}</div>
  <a href="${BASE_URL}/admin/support" style="display:inline-block;background:#ef4444;color:#fff;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;">View in Admin Panel →</a>
</div>`;
}

// ── POST /support/tickets — public ────────────────────────────────────────────

router.post("/support/tickets", async (req, res): Promise<void> => {
  const { name, email, subject, message } = req.body as {
    name?: string; email?: string; subject?: string; message?: string;
  };

  if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
    res.status(400).json({ error: "name, email, subject, and message are required" });
    return;
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(email.trim())) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const [ticket] = await db.insert(supportTicketsTable).values({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    subject: subject.trim(),
    message: message.trim(),
    status: "open",
  }).returning();

  let aiResult: AiSupportResult;
  try {
    aiResult = await generateSupportResponse(name.trim(), subject.trim(), message.trim());
  } catch (err) {
    req.log.warn({ err }, "Support AI response failed — falling back to escalation");
    aiResult = {
      category: "other",
      response: `Hi ${name.trim().split(" ")[0]},\n\nThank you for reaching out to GrowthForge support. We've received your message and a member of our team will get back to you within 24 hours.\n\nBest regards,\nGrowthForge Support`,
      escalate: true,
      escalateReason: "AI response generation failed",
    };
  }

  const newStatus = aiResult.escalate ? "escalated" : "ai_responded";

  await db.update(supportTicketsTable)
    .set({
      category: aiResult.category,
      status: newStatus,
      aiResponse: aiResult.response,
      escalatedAt: aiResult.escalate ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(supportTicketsTable.id, ticket.id));

  if (resend) {
    resend.emails.send({
      from: SUPPORT_FROM,
      to: email.trim(),
      subject: `Re: ${subject.trim()} — GrowthForge Support`,
      html: supportEmailHtml(name.trim().split(" ")[0]!, aiResult.response, subject.trim()),
    }).catch(() => {});
  }

  if (aiResult.escalate && resend) {
    resend.emails.send({
      from: SUPPORT_FROM,
      to: ESCALATION_EMAIL,
      subject: `🚨 Support escalation: ${subject.trim()}`,
      html: escalationEmailHtml(name.trim(), email.trim(), subject.trim(), message.trim(), aiResult.response, aiResult.escalateReason),
    }).catch(() => {});
  }

  res.json({ ticketId: ticket.id, aiResponse: aiResult.response, escalated: aiResult.escalate });
});

// ── GET /owner/support/tickets ────────────────────────────────────────────────

router.get("/owner/support/tickets", requireOwner, async (req, res): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const tickets = await db
      .select()
      .from(supportTicketsTable)
      .where(status ? eq(supportTicketsTable.status, status) : undefined)
      .orderBy(desc(supportTicketsTable.createdAt));

    const [counts] = await db.select({ total: count() }).from(supportTicketsTable);
    const statusCounts = await db
      .select({ status: supportTicketsTable.status, cnt: count() })
      .from(supportTicketsTable)
      .groupBy(supportTicketsTable.status);

    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) byStatus[row.status] = Number(row.cnt);

    res.json({
      tickets: tickets.map(t => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        adminRepliedAt: t.adminRepliedAt?.toISOString() ?? null,
        escalatedAt: t.escalatedAt?.toISOString() ?? null,
      })),
      counts: {
        total: Number(counts?.total ?? 0),
        open: byStatus["open"] ?? 0,
        ai_responded: byStatus["ai_responded"] ?? 0,
        escalated: byStatus["escalated"] ?? 0,
        resolved: byStatus["resolved"] ?? 0,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching support tickets");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /owner/support/tickets/:id ─────────────────────────────────────────

router.patch("/owner/support/tickets/:id", requireOwner, async (req, res): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket ID" }); return; }

    const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id)).limit(1);
    if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }

    const { adminReply, status } = req.body as { adminReply?: string; status?: string };
    const update: Partial<typeof supportTicketsTable.$inferInsert> = { updatedAt: new Date() };
    if (adminReply !== undefined) {
      update.adminReply = adminReply.trim();
      update.adminRepliedAt = new Date();
      if (!status) update.status = "resolved";
    }
    if (status !== undefined) update.status = status;

    const [updated] = await db
      .update(supportTicketsTable).set(update).where(eq(supportTicketsTable.id, id)).returning();

    if (adminReply?.trim() && resend) {
      resend.emails.send({
        from: SUPPORT_FROM,
        to: ticket.email,
        subject: `Re: ${ticket.subject} — GrowthForge Support`,
        html: supportEmailHtml(ticket.name.split(" ")[0]!, adminReply.trim(), ticket.subject),
      }).catch(() => {});
    }

    res.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      adminRepliedAt: updated.adminRepliedAt?.toISOString() ?? null,
      escalatedAt: updated.escalatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Error updating support ticket");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /owner/support/tickets/:id/escalate ──────────────────────────────────

router.post("/owner/support/tickets/:id/escalate", requireOwner, async (req, res): Promise<void> => {
  try {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(rawId ?? "", 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ticket ID" }); return; }

    const [ticket] = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.id, id)).limit(1);
    if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }

    await db.update(supportTicketsTable)
      .set({ status: "escalated", escalatedAt: new Date(), updatedAt: new Date() })
      .where(eq(supportTicketsTable.id, id));

    if (resend) {
      resend.emails.send({
        from: SUPPORT_FROM,
        to: ESCALATION_EMAIL,
        subject: `🚨 Manually escalated: ${ticket.subject}`,
        html: escalationEmailHtml(ticket.name, ticket.email, ticket.subject, ticket.message, ticket.aiResponse ?? "(no AI response)", "Manually escalated by admin"),
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error escalating ticket");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /owner/support/knowledge-base ────────────────────────────────────────

router.get("/owner/support/knowledge-base", requireOwner, async (_req, res): Promise<void> => {
  try {
    const [row] = await db.select().from(supportKnowledgeBaseTable).limit(1);
    res.json({
      content: row?.content ?? "",
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /owner/support/knowledge-base ────────────────────────────────────────

router.put("/owner/support/knowledge-base", requireOwner, async (req, res): Promise<void> => {
  try {
    const { content } = req.body as { content?: string };
    if (typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const [existing] = await db.select({ id: supportKnowledgeBaseTable.id }).from(supportKnowledgeBaseTable).limit(1);

    let row;
    if (existing) {
      [row] = await db
        .update(supportKnowledgeBaseTable)
        .set({ content: content.trim(), updatedAt: new Date() })
        .where(eq(supportKnowledgeBaseTable.id, existing.id))
        .returning();
    } else {
      [row] = await db
        .insert(supportKnowledgeBaseTable)
        .values({ content: content.trim() })
        .returning();
    }

    invalidateKbCache();

    res.json({
      content: row.content,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

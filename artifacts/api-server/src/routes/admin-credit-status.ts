import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, platformCreditBanksTable, platformCreditTransactionsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { seedManualBanks } from "../lib/platformCredits.js";

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

async function fetchElevenLabsStatus() {
  const key = process.env["ELEVENLABS_API_KEY"];
  if (!key) return { keyConfigured: false, keyValid: null, used: null, limit: null, balance: null, pct: null };
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": key }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { keyConfigured: true, keyValid: false, used: null, limit: null, balance: null, pct: null };
    const d = await r.json() as { subscription?: { character_count?: number; character_limit?: number } };
    const sub = d.subscription ?? {};
    const used  = sub.character_count  ?? null;
    const limit = sub.character_limit  ?? null;
    const balance = (used !== null && limit !== null) ? limit - used : null;
    const pct   = (balance !== null && limit && limit > 0) ? Math.round((balance / limit) * 100) : null;
    return { keyConfigured: true, keyValid: true, used, limit, balance, pct };
  } catch {
    return { keyConfigured: true, keyValid: null, used: null, limit: null, balance: null, pct: null };
  }
}

async function fetchOpenAIStatus() {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return { keyConfigured: false, keyValid: null, balance: null, used: null, limit: null, pct: null, note: null };
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { keyConfigured: true, keyValid: false, balance: null, used: null, limit: null, pct: null, note: null };

    // Try prepaid credit grants (only works for prepaid accounts)
    const br = await fetch("https://api.openai.com/dashboard/billing/credit_grants", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    if (br.ok) {
      const bd = await br.json() as { total_granted?: number; total_used?: number; total_available?: number };
      const balance = bd.total_available ?? null;
      const used    = bd.total_used     ?? null;
      const limit   = bd.total_granted  ?? null;
      const pct     = (balance !== null && limit && limit > 0) ? Math.round((balance / limit) * 100) : null;
      return { keyConfigured: true, keyValid: true, balance, used, limit, pct, note: null };
    }
    return { keyConfigured: true, keyValid: true, balance: null, used: null, limit: null, pct: null,
      note: "Key active · Pay-as-you-go account — no fixed balance to display" };
  } catch {
    return { keyConfigured: true, keyValid: null, balance: null, used: null, limit: null, pct: null, note: null };
  }
}

async function fetchMiniMaxKeyValid() {
  const key = process.env["MINIMAX_API_KEY"];
  if (!key) return { keyConfigured: false, keyValid: null };
  try {
    const r = await fetch("https://api.minimaxi.com/v1/files?purpose=assistants", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
    });
    return { keyConfigured: true, keyValid: r.ok || r.status === 400 || r.status === 404 };
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

    const [elevenLabsLive, openAILive, miniMaxKey, shotstackKey, banks, anthropicSpend] =
      await Promise.all([
        fetchElevenLabsStatus(),
        fetchOpenAIStatus(),
        fetchMiniMaxKeyValid(),
        fetchShotstackKeyValid(),

        db.select().from(platformCreditBanksTable)
          .where(sql`${platformCreditBanksTable.provider} IN ('minimax','shotstack')`),

        db.select({
          total:   sql<number>`COALESCE(SUM(${platformCreditTransactionsTable.amount}), 0)`,
          monthly: sql<number>`COALESCE(SUM(CASE WHEN ${platformCreditTransactionsTable.createdAt} >= date_trunc('month', now()) THEN ${platformCreditTransactionsTable.amount} ELSE 0 END), 0)`,
        })
        .from(platformCreditTransactionsTable)
        .where(and(
          eq(platformCreditTransactionsTable.provider, "anthropic"),
          eq(platformCreditTransactionsTable.type, "deduction"),
        )),
      ]);

    const bankMap = Object.fromEntries(banks.map((b) => [b.provider, b]));
    const mmBank  = bankMap["minimax"]   ?? null;
    const ssBank  = bankMap["shotstack"] ?? null;
    const mmPct   = mmBank && mmBank.peakBalance > 0 ? Math.round((mmBank.balance / mmBank.peakBalance) * 100) : null;
    const ssPct   = ssBank && ssBank.peakBalance > 0 ? Math.round((ssBank.balance / ssBank.peakBalance) * 100) : null;
    const spend   = anthropicSpend[0] ?? { total: 0, monthly: 0 };

    res.json({
      anthropic: {
        type: "spend",
        displayName: "Anthropic (Claude)", icon: "🧠",
        managedBy: "Replit AI Integrations",
        dashboardUrl: "https://replit.com/account",
        totalSpend:   Number(spend.total)   ?? 0,
        monthlySpend: Number(spend.monthly) ?? 0,
        unit: "USD",
      },
      openai: {
        type: "live",
        displayName: "OpenAI (GPT Image)", icon: "🖼️",
        keyConfigured: openAILive.keyConfigured,
        keyValid:      openAILive.keyValid,
        balance:       openAILive.balance,
        used:          openAILive.used,
        limit:         openAILive.limit,
        pct:           openAILive.pct,
        unit: "USD",
        note: openAILive.note,
        dashboardUrl: "https://platform.openai.com/settings/organization/billing/overview",
      },
      elevenlabs: {
        type: "live",
        displayName: "ElevenLabs (Voice)", icon: "🎙️",
        keyConfigured: elevenLabsLive.keyConfigured,
        keyValid:      elevenLabsLive.keyValid,
        balance:       elevenLabsLive.balance,
        used:          elevenLabsLive.used,
        limit:         elevenLabsLive.limit,
        pct:           elevenLabsLive.pct,
        unit: "characters",
        note: null,
        dashboardUrl: "https://elevenlabs.io/subscription",
      },
      minimax: {
        type: "bank",
        displayName: "MiniMax (Video)", icon: "🎬",
        keyConfigured: miniMaxKey.keyConfigured,
        keyValid:      miniMaxKey.keyValid,
        balance:       mmBank?.balance          ?? null,
        peakBalance:   mmBank?.peakBalance      ?? null,
        totalAdded:    mmBank?.totalAdded       ?? null,
        pct:           mmPct,
        unit:          mmBank?.unit             ?? "generations",
        alertThresholdPct: mmBank?.alertThresholdPct ?? 30,
        alertEmail:    mmBank?.alertEmail       ?? null,
        alertEnabled:  mmBank?.alertEnabled     ?? true,
        dashboardUrl: "https://platform.minimaxi.com/user-center/basic-information",
        note: "MiniMax does not expose a token balance via API. Top up here after purchasing generations.",
      },
      shotstack: {
        type: "bank",
        displayName: "Shotstack (Render)", icon: "⚙️",
        keyConfigured: shotstackKey.keyConfigured,
        keyValid:      shotstackKey.keyValid,
        balance:       ssBank?.balance          ?? null,
        peakBalance:   ssBank?.peakBalance      ?? null,
        totalAdded:    ssBank?.totalAdded       ?? null,
        pct:           ssPct,
        unit:          ssBank?.unit             ?? "credits",
        alertThresholdPct: ssBank?.alertThresholdPct ?? 30,
        alertEmail:    ssBank?.alertEmail       ?? null,
        alertEnabled:  ssBank?.alertEnabled     ?? true,
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
    if (!["minimax", "shotstack"].includes(provider)) {
      res.status(400).json({ error: "Top-up only supported for minimax and shotstack" }); return;
    }
    const { amount, notes } = req.body as { amount: number; notes?: string };
    if (!amount || amount <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }

    const [bank] = await db.select().from(platformCreditBanksTable)
      .where(eq(platformCreditBanksTable.provider, provider));
    if (!bank) { res.status(404).json({ error: "Bank not found" }); return; }

    const newBalance  = bank.balance  + amount;
    const newPeak     = Math.max(bank.peakBalance, newBalance);
    const newTotal    = bank.totalAdded + amount;

    const [updated] = await db.update(platformCreditBanksTable)
      .set({ balance: newBalance, peakBalance: newPeak, totalAdded: newTotal, updatedAt: new Date() })
      .where(eq(platformCreditBanksTable.provider, provider))
      .returning();

    await db.insert(platformCreditTransactionsTable).values({
      provider, type: "topup", amount, balanceAfter: newBalance,
      description: notes?.trim() || "Manual top-up",
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error topping up bank");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Alert settings (MiniMax / Shotstack) ──────────────────────────────────────

router.patch("/admin/credits/bank/:provider/settings", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    const body = req.body as { alertThresholdPct?: number; alertEmail?: string; alertEnabled?: boolean };
    const update: Partial<typeof platformCreditBanksTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.alertThresholdPct === "number") update.alertThresholdPct = Math.max(1, Math.min(99, body.alertThresholdPct));
    if (typeof body.alertEmail === "string") update.alertEmail = body.alertEmail.trim() || null;
    if (typeof body.alertEnabled === "boolean") update.alertEnabled = body.alertEnabled;
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

export default router;

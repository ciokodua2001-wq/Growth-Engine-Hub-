import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, platformCreditTransactionsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router: IRouter = Router();

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

interface ProviderStatus {
  provider: string;
  displayName: string;
  icon: string;
  keyConfigured: boolean;
  keyValid: boolean | null;
  balance: number | null;
  used: number | null;
  limit: number | null;
  unit: string;
  pct: number | null;
  managedBy: string | null;
  dashboardUrl: string;
  error: string | null;
}

async function checkElevenLabs(): Promise<ProviderStatus> {
  const key = process.env["ELEVENLABS_API_KEY"];
  const base: ProviderStatus = {
    provider: "elevenlabs", displayName: "ElevenLabs", icon: "🎙️",
    keyConfigured: !!key, keyValid: null, balance: null, used: null,
    limit: null, unit: "characters", pct: null, managedBy: null,
    dashboardUrl: "https://elevenlabs.io/subscription", error: null,
  };
  if (!key) return base;
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { base.keyValid = false; base.error = `API returned ${r.status}`; return base; }
    const data = await r.json() as { subscription?: { character_count?: number; character_limit?: number; status?: string } };
    const sub = data.subscription ?? {};
    base.keyValid = true;
    base.used = sub.character_count ?? null;
    base.limit = sub.character_limit ?? null;
    if (base.used !== null && base.limit !== null && base.limit > 0) {
      base.balance = base.limit - base.used;
      base.pct = Math.round(((base.limit - base.used) / base.limit) * 100);
    }
  } catch (e: unknown) {
    base.error = e instanceof Error ? e.message : "Request failed";
  }
  return base;
}

async function checkOpenAI(): Promise<ProviderStatus> {
  const key = process.env["OPENAI_API_KEY"];
  const base: ProviderStatus = {
    provider: "openai", displayName: "OpenAI", icon: "🖼️",
    keyConfigured: !!key, keyValid: null, balance: null, used: null,
    limit: null, unit: "USD", pct: null, managedBy: null,
    dashboardUrl: "https://platform.openai.com/settings/organization/billing/overview", error: null,
  };
  if (!key) return base;
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    base.keyValid = r.ok;
    if (!r.ok) { base.error = `API key invalid (${r.status})`; return base; }

    const billing = await fetch("https://api.openai.com/dashboard/billing/credit_grants", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (billing.ok) {
      const bd = await billing.json() as { total_granted?: number; total_used?: number; total_available?: number };
      base.balance = bd.total_available ?? null;
      base.used = bd.total_used ?? null;
      base.limit = bd.total_granted ?? null;
      if (base.limit && base.limit > 0 && base.balance !== null) {
        base.pct = Math.round((base.balance / base.limit) * 100);
      }
    } else {
      base.error = "Key is valid — balance not available via API (pay-as-you-go account)";
    }
  } catch (e: unknown) {
    base.error = e instanceof Error ? e.message : "Request failed";
  }
  return base;
}

async function checkMiniMax(): Promise<ProviderStatus> {
  const key = process.env["MINIMAX_API_KEY"];
  const base: ProviderStatus = {
    provider: "minimax", displayName: "MiniMax", icon: "🎬",
    keyConfigured: !!key, keyValid: null, balance: null, used: null,
    limit: null, unit: "tokens", pct: null, managedBy: null,
    dashboardUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key", error: null,
  };
  if (!key) return base;
  try {
    const r = await fetch("https://api.minimaxi.com/v1/files?purpose=assistants", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    base.keyValid = r.ok || r.status === 400;
    if (!base.keyValid) { base.error = `API returned ${r.status}`; }
    base.error = base.keyValid
      ? "Key is valid — MiniMax does not expose a token balance via API. Check your balance at the dashboard."
      : base.error;
  } catch (e: unknown) {
    base.error = e instanceof Error ? e.message : "Request failed";
  }
  return base;
}

async function checkShotstack(): Promise<ProviderStatus> {
  const key = process.env["SHOTSTACK_API_KEY"];
  const base: ProviderStatus = {
    provider: "shotstack", displayName: "Shotstack", icon: "⚙️",
    keyConfigured: !!key, keyValid: null, balance: null, used: null,
    limit: null, unit: "credits", pct: null, managedBy: null,
    dashboardUrl: "https://dashboard.shotstack.io/billing", error: null,
  };
  if (!key) return base;
  try {
    const env = process.env["NODE_ENV"] === "production" ? "production" : "stage";
    const r = await fetch(`https://api.shotstack.io/edit/${env}/queued`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(8000),
    });
    base.keyValid = r.ok || r.status === 200;
    if (!base.keyValid && r.status === 401) { base.keyValid = false; base.error = "API key invalid"; }
    else if (base.keyValid) {
      base.error = "Key is valid — Shotstack credit balance is available in your dashboard only.";
    }
  } catch (e: unknown) {
    base.error = e instanceof Error ? e.message : "Request failed";
  }
  return base;
}

router.get("/admin/credits/live", requireAdmin, async (req, res): Promise<void> => {
  try {
    const [elevenlabs, openai, minimax, shotstack] = await Promise.all([
      checkElevenLabs(),
      checkOpenAI(),
      checkMiniMax(),
      checkShotstack(),
    ]);

    const anthropic: ProviderStatus = {
      provider: "anthropic", displayName: "Anthropic (Claude)", icon: "🧠",
      keyConfigured: true, keyValid: true, balance: null, used: null,
      limit: null, unit: "USD", pct: null,
      managedBy: "Replit AI Integrations",
      dashboardUrl: "https://replit.com",
      error: "Billed through Replit — no balance to manage here.",
    };

    res.json([anthropic, openai, elevenlabs, minimax, shotstack]);
  } catch (err) {
    req.log.error({ err }, "Error fetching live credit status");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/credits/live/:provider/transactions", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    const rows = await db
      .select()
      .from(platformCreditTransactionsTable)
      .where(eq(platformCreditTransactionsTable.provider, provider))
      .orderBy(desc(platformCreditTransactionsTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching transactions");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

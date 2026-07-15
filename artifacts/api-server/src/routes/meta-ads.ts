import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { connectedAdAccountsTable, campaignsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireProjectOwnershipParam } from "../lib/authz.js";

const router: IRouter = Router();
router.param("id", requireProjectOwnershipParam());

const META_GRAPH = "https://graph.facebook.com/v20.0";
const META_AUTH  = "https://www.facebook.com/v20.0/dialog/oauth";
const META_TOKEN = `${META_GRAPH}/oauth/access_token`;
const SCOPE      = "ads_read";

function appId()     { return process.env["META_APP_ID"]     ?? ""; }
function appSecret() { return process.env["META_APP_SECRET"] ?? ""; }
function redirectUri() {
  return process.env["META_REDIRECT_URI"] ??
    "https://usegrowthforge.com/api/auth/meta/callback";
}

// ── Token helpers ──────────────────────────────────────────────────────────────

async function exchangeForLongLived(shortToken: string): Promise<{ access_token: string; expires_in: number }> {
  const url = new URL(META_TOKEN);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId());
  url.searchParams.set("client_secret", appSecret());
  url.searchParams.set("fb_exchange_token", shortToken);
  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Token exchange failed: ${await r.text()}`);
  return r.json();
}

// ── Status ─────────────────────────────────────────────────────────────────────

router.get("/projects/:id/meta/status", async (req, res): Promise<void> => {
  const projectId = req.project!.id;

  const [account] = await db.select({
    id: connectedAdAccountsTable.id,
    customerId: connectedAdAccountsTable.customerId,
    accountName: connectedAdAccountsTable.accountName,
    accountEmail: connectedAdAccountsTable.accountEmail,
    tokenExpiresAt: connectedAdAccountsTable.tokenExpiresAt,
    lastSyncAt: connectedAdAccountsTable.lastSyncAt,
  }).from(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "meta"),
    ));

  // Warn if token expires in < 7 days
  const tokenExpiresSoon = account?.tokenExpiresAt
    ? account.tokenExpiresAt < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    : false;

  res.json({
    connected: !!account,
    oauthConfigured: !!appId() && !!appSecret(),
    tokenExpiresSoon,
    account: account ?? null,
  });
});

// ── Auth URL ───────────────────────────────────────────────────────────────────

router.get("/projects/:id/meta/auth-url", async (req, res): Promise<void> => {
  if (!appId()) { res.status(400).json({ error: "META_APP_ID not configured" }); return; }
  const state = Buffer.from(JSON.stringify({ projectId: req.project!.id })).toString("base64url");
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri(),
    scope: SCOPE,
    response_type: "code",
    state,
  });
  res.json({ url: `${META_AUTH}?${params.toString()}` });
});

// ── OAuth Callback ─────────────────────────────────────────────────────────────

router.get("/auth/meta/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error || !code || !state) {
    res.redirect(`/?meta_error=${encodeURIComponent(error ?? "cancelled")}`);
    return;
  }

  let projectId: number;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString()) as { projectId: number };
    projectId = decoded.projectId;
  } catch {
    res.status(400).send("Invalid state parameter");
    return;
  }

  try {
    // Exchange code for short-lived token
    const tokenUrl = new URL(META_TOKEN);
    tokenUrl.searchParams.set("client_id", appId());
    tokenUrl.searchParams.set("client_secret", appSecret());
    tokenUrl.searchParams.set("redirect_uri", redirectUri());
    tokenUrl.searchParams.set("code", code);
    const tokenRes = await fetch(tokenUrl.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const shortToken = await tokenRes.json() as { access_token: string };

    // Exchange for long-lived token (~60 days)
    const longToken = await exchangeForLongLived(shortToken.access_token);
    const expiresAt = new Date(Date.now() + longToken.expires_in * 1000);

    // Get user info + first ad account
    let accountEmail: string | null = null;
    let accountName: string | null = null;
    let customerId: string | null = null;

    try {
      const meRes = await fetch(
        `${META_GRAPH}/me?fields=id,name,email&access_token=${longToken.access_token}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      const me = await meRes.json() as { name?: string; email?: string };
      accountName  = me.name  ?? null;
      accountEmail = me.email ?? null;
    } catch { /* non-fatal */ }

    try {
      const accRes = await fetch(
        `${META_GRAPH}/me/adaccounts?fields=id,name&limit=1&access_token=${longToken.access_token}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      const accData = await accRes.json() as { data?: Array<{ id: string; name: string }> };
      if (accData.data && accData.data.length > 0) {
        customerId  = accData.data[0]!.id;   // format: "act_123456"
        accountName = accData.data[0]!.name ?? accountName;
      }
    } catch { /* non-fatal */ }

    // Upsert connection
    const existing = await db.select({ id: connectedAdAccountsTable.id })
      .from(connectedAdAccountsTable)
      .where(and(
        eq(connectedAdAccountsTable.projectId, projectId),
        eq(connectedAdAccountsTable.provider, "meta"),
      ));

    if (existing.length > 0) {
      await db.update(connectedAdAccountsTable).set({
        accessToken: longToken.access_token,
        tokenExpiresAt: expiresAt,
        customerId:   customerId  ?? undefined,
        accountName:  accountName ?? undefined,
        accountEmail: accountEmail ?? undefined,
        updatedAt: new Date(),
      }).where(eq(connectedAdAccountsTable.id, existing[0]!.id));
    } else {
      await db.insert(connectedAdAccountsTable).values({
        projectId,
        provider: "meta",
        accessToken: longToken.access_token,
        refreshToken: null,
        tokenExpiresAt: expiresAt,
        customerId,
        accountName,
        accountEmail,
      });
    }

    res.redirect(`/projects/${projectId}/campaigns?meta=connected`);
  } catch (err) {
    req.log.error({ err }, "Meta OAuth callback error");
    res.redirect(`/projects/${projectId}/campaigns?meta=error`);
  }
});

// ── Sync campaigns ─────────────────────────────────────────────────────────────

router.post("/projects/:id/meta/sync", async (req, res): Promise<void> => {
  const projectId = req.project!.id;

  const [account] = await db.select().from(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "meta"),
    ));

  if (!account)           { res.status(404).json({ error: "Meta account not connected" }); return; }
  if (!account.customerId){ res.status(400).json({ error: "No Meta ad account found. Re-connect your account." }); return; }

  try {
    const token = account.accessToken;

    // Fetch campaign-level insights for last 30 days
    const insightsUrl = new URL(`${META_GRAPH}/${account.customerId}/insights`);
    insightsUrl.searchParams.set("level", "campaign");
    insightsUrl.searchParams.set("fields", "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions");
    insightsUrl.searchParams.set("date_preset", "last_30_days");
    insightsUrl.searchParams.set("limit", "50");
    insightsUrl.searchParams.set("access_token", token);

    const insightsRes = await fetch(insightsUrl.toString(), { signal: AbortSignal.timeout(20_000) });
    if (!insightsRes.ok) throw new Error(`Insights fetch failed: ${await insightsRes.text()}`);
    const insightsData = await insightsRes.json() as {
      data?: Array<{
        campaign_id: string;
        campaign_name: string;
        impressions: string;
        clicks: string;
        spend: string;
        ctr: string;
        cpc: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
    };

    // Also fetch campaign statuses (insights only covers active campaigns)
    const campaignsUrl = new URL(`${META_GRAPH}/${account.customerId}/campaigns`);
    campaignsUrl.searchParams.set("fields", "id,name,status,objective");
    campaignsUrl.searchParams.set("limit", "50");
    campaignsUrl.searchParams.set("access_token", token);

    const campaignsRes = await fetch(campaignsUrl.toString(), { signal: AbortSignal.timeout(20_000) });
    const campaignsData = await campaignsRes.json() as {
      data?: Array<{ id: string; name: string; status: string; objective?: string }>;
    };

    const statusMap: Record<string, string> = {
      ACTIVE:   "active",
      PAUSED:   "paused",
      ARCHIVED: "completed",
      DELETED:  "completed",
    };

    // Build a status lookup from campaign list
    const campaignStatuses: Record<string, string> = {};
    for (const c of (campaignsData.data ?? [])) {
      campaignStatuses[c.id] = statusMap[c.status] ?? "draft";
    }

    const insights = insightsData.data ?? [];
    let synced = 0;

    for (const insight of insights) {
      const spend       = parseFloat(insight.spend ?? "0");
      const clicks      = parseInt(insight.clicks ?? "0", 10);
      const impressions = parseInt(insight.impressions ?? "0", 10);
      const ctr         = parseFloat(insight.ctr ?? "0");
      const cpc         = parseFloat(insight.cpc ?? "0");

      // Try to extract purchase conversions for ROAS estimate
      const purchases = insight.actions?.find(
        a => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase"
      );
      const conversions = purchases ? parseFloat(purchases.value) : 0;
      const roas = spend > 0 && conversions > 0 ? ((conversions * 50) / spend) : null;

      const campaignData = {
        projectId,
        source: "meta",
        externalId: insight.campaign_id,
        name: insight.campaign_name,
        platform: "Meta",
        status: campaignStatuses[insight.campaign_id] ?? "active",
        spent: spend.toFixed(2),
        impressions,
        clicks,
        conversions: Math.floor(conversions),
        ctr: ctr.toFixed(4),
        cpc: cpc.toFixed(2),
        roas: roas ? roas.toFixed(2) : null,
      };

      const [existing] = await db.select({ id: campaignsTable.id })
        .from(campaignsTable)
        .where(and(
          eq(campaignsTable.projectId, projectId),
          eq(campaignsTable.source, "meta"),
          eq(campaignsTable.externalId, insight.campaign_id),
        ));

      if (existing) {
        await db.update(campaignsTable).set(campaignData).where(eq(campaignsTable.id, existing.id));
      } else {
        await db.insert(campaignsTable).values(campaignData);
      }
      synced++;
    }

    await db.update(connectedAdAccountsTable)
      .set({ lastSyncAt: new Date() })
      .where(eq(connectedAdAccountsTable.id, account.id));

    res.json({ synced, message: `Synced ${synced} campaigns from Meta` });
  } catch (err) {
    req.log.error({ err }, "Meta sync error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

// ── Disconnect ─────────────────────────────────────────────────────────────────

router.delete("/projects/:id/meta/disconnect", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  await db.delete(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "meta"),
    ));
  await db.update(campaignsTable)
    .set({ source: "manual", externalId: null })
    .where(and(
      eq(campaignsTable.projectId, projectId),
      eq(campaignsTable.source, "meta"),
    ));
  res.json({ ok: true });
});

export default router;

import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { connectedAdAccountsTable, campaignsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireProjectOwnershipParam } from "../lib/authz.js";

const router: IRouter = Router();
router.param("id", requireProjectOwnershipParam());

const GOOGLE_ADS_API   = "https://googleads.googleapis.com/v18";
const GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/adwords";

function clientId()     { return process.env["GOOGLE_ADS_CLIENT_ID"]     ?? ""; }
function clientSecret() { return process.env["GOOGLE_ADS_CLIENT_SECRET"] ?? ""; }
function devToken()     { return process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] ?? ""; }
function redirectUri()  {
  return process.env["GOOGLE_ADS_REDIRECT_URI"] ??
    "https://usegrowthforge.com/api/auth/google-ads/callback";
}

// ── Token helpers ──────────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string) {
  const r = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${await r.text()}`);
  const d = await r.json() as { access_token: string; expires_in: number };
  return d;
}

async function getValidToken(account: typeof connectedAdAccountsTable.$inferSelect): Promise<string> {
  const now = new Date();
  if (account.tokenExpiresAt && account.tokenExpiresAt > new Date(now.getTime() + 60_000)) {
    return account.accessToken;
  }
  if (!account.refreshToken) throw new Error("No refresh token available");
  const refreshed = await refreshAccessToken(account.refreshToken);
  const expiresAt = new Date(now.getTime() + refreshed.expires_in * 1000);
  await db.update(connectedAdAccountsTable)
    .set({ accessToken: refreshed.access_token, tokenExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(connectedAdAccountsTable.id, account.id));
  return refreshed.access_token;
}

// ── Google Ads API helpers ─────────────────────────────────────────────────────

async function listAccessibleCustomers(accessToken: string): Promise<string[]> {
  const r = await fetch(`${GOOGLE_ADS_API}/customers:listAccessibleCustomers`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": devToken(),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`listAccessibleCustomers failed: ${await r.text()}`);
  const d = await r.json() as { resourceNames?: string[] };
  return (d.resourceNames ?? []).map((n) => n.replace("customers/", ""));
}

async function fetchCampaigns(accessToken: string, customerId: string) {
  const query = [
    "SELECT",
    "  campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,",
    "  metrics.impressions, metrics.clicks, metrics.conversions,",
    "  metrics.cost_micros, metrics.ctr, metrics.average_cpc",
    "FROM campaign",
    "WHERE segments.date DURING LAST_30_DAYS",
    "  AND campaign.status != 'REMOVED'",
    "ORDER BY metrics.impressions DESC",
    "LIMIT 50",
  ].join(" ");

  const r = await fetch(`${GOOGLE_ADS_API}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": devToken(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Campaign fetch failed: ${await r.text()}`);
  const d = await r.json() as { results?: Array<{
    campaign: { id: string; name: string; status: string; advertisingChannelType: string };
    metrics: { impressions: string; clicks: string; conversions: string; costMicros: string; ctr: string; averageCpc: string };
  }> };
  return d.results ?? [];
}

// ── Status ─────────────────────────────────────────────────────────────────────

router.get("/projects/:id/google-ads/status", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const devTokenSet = !!devToken();
  const clientSet = !!clientId() && !!clientSecret();

  const [account] = await db.select({
    id: connectedAdAccountsTable.id,
    customerId: connectedAdAccountsTable.customerId,
    accountName: connectedAdAccountsTable.accountName,
    accountEmail: connectedAdAccountsTable.accountEmail,
    lastSyncAt: connectedAdAccountsTable.lastSyncAt,
  }).from(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "google_ads"),
    ));

  res.json({
    connected: !!account,
    devTokenConfigured: devTokenSet,
    oauthConfigured: clientSet,
    account: account ?? null,
  });
});

// ── Auth URL ───────────────────────────────────────────────────────────────────

router.get("/projects/:id/google-ads/auth-url", async (req, res): Promise<void> => {
  if (!clientId()) { res.status(400).json({ error: "GOOGLE_ADS_CLIENT_ID not configured" }); return; }
  const state = Buffer.from(JSON.stringify({ projectId: req.project!.id })).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  res.json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
});

// ── OAuth Callback (public — Google redirects here) ────────────────────────────

router.get("/auth/google-ads/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error || !code || !state) {
    res.redirect(`/?google_ads_error=${encodeURIComponent(error ?? "cancelled")}`);
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
    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokens = await tokenRes.json() as {
      access_token: string; refresh_token?: string; expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Get accessible customer IDs
    let customerId: string | null = null;
    let accountName: string | null = null;
    try {
      const customers = await listAccessibleCustomers(tokens.access_token);
      customerId = customers[0] ?? null;
    } catch {
      // Customer list may fail if developer token not yet approved — store tokens anyway
    }

    // Get user email from Google
    let accountEmail: string | null = null;
    try {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userInfo = await userRes.json() as { email?: string; name?: string };
      accountEmail = userInfo.email ?? null;
      accountName = userInfo.name ?? null;
    } catch { /* non-fatal */ }

    // Upsert the connection
    const existing = await db.select({ id: connectedAdAccountsTable.id })
      .from(connectedAdAccountsTable)
      .where(and(
        eq(connectedAdAccountsTable.projectId, projectId),
        eq(connectedAdAccountsTable.provider, "google_ads"),
      ));

    if (existing.length > 0) {
      await db.update(connectedAdAccountsTable).set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        tokenExpiresAt: expiresAt,
        customerId: customerId ?? undefined,
        accountName: accountName ?? undefined,
        accountEmail: accountEmail ?? undefined,
        updatedAt: new Date(),
      }).where(eq(connectedAdAccountsTable.id, existing[0]!.id));
    } else {
      await db.insert(connectedAdAccountsTable).values({
        projectId,
        provider: "google_ads",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: expiresAt,
        customerId,
        accountName,
        accountEmail,
      });
    }

    res.redirect(`/project/${projectId}/campaigns?google_ads=connected`);
  } catch (err) {
    req.log.error({ err }, "Google Ads OAuth callback error");
    res.redirect(`/project/${projectId}/campaigns?google_ads=error`);
  }
});

// ── Sync campaigns ─────────────────────────────────────────────────────────────

router.post("/projects/:id/google-ads/sync", async (req, res): Promise<void> => {
  const projectId = req.project!.id;

  const [account] = await db.select().from(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "google_ads"),
    ));

  if (!account) { res.status(404).json({ error: "Google Ads account not connected" }); return; }
  if (!devToken()) { res.status(400).json({ error: "GOOGLE_ADS_DEVELOPER_TOKEN not configured" }); return; }
  if (!account.customerId) { res.status(400).json({ error: "No Google Ads customer ID. Re-connect your account." }); return; }

  try {
    const accessToken = await getValidToken(account);
    const results = await fetchCampaigns(accessToken, account.customerId);

    let synced = 0;
    for (const r of results) {
      const costMicros = parseInt(r.metrics.costMicros ?? "0", 10);
      const clicks     = parseInt(r.metrics.clicks     ?? "0", 10);
      const impressions= parseInt(r.metrics.impressions?? "0", 10);
      const conversions= parseFloat(r.metrics.conversions ?? "0");
      const spent      = costMicros / 1_000_000;
      const ctr        = parseFloat(r.metrics.ctr ?? "0") * 100;
      const cpc        = parseInt(r.metrics.averageCpc ?? "0", 10) / 1_000_000;
      const roas       = spent > 0 ? (conversions * 50) / spent : null; // estimated

      const statusMap: Record<string, string> = {
        ENABLED: "active", PAUSED: "paused", REMOVED: "completed",
      };

      const campaignData = {
        projectId,
        source: "google_ads",
        externalId: r.campaign.id,
        name: r.campaign.name,
        platform: r.campaign.advertisingChannelType === "SEARCH" ? "Google Search"
          : r.campaign.advertisingChannelType === "DISPLAY" ? "Google Display"
          : r.campaign.advertisingChannelType === "VIDEO" ? "YouTube"
          : "Google",
        status: statusMap[r.campaign.status] ?? "draft",
        spent: spent.toFixed(2),
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
          eq(campaignsTable.source, "google_ads"),
          eq(campaignsTable.externalId, r.campaign.id),
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

    res.json({ synced, message: `Synced ${synced} campaigns from Google Ads` });
  } catch (err) {
    req.log.error({ err }, "Google Ads sync error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

// ── Disconnect ─────────────────────────────────────────────────────────────────

router.delete("/projects/:id/google-ads/disconnect", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  await db.delete(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "google_ads"),
    ));
  // Mark synced campaigns as manual so they remain visible
  await db.update(campaignsTable)
    .set({ source: "manual", externalId: null })
    .where(and(
      eq(campaignsTable.projectId, projectId),
      eq(campaignsTable.source, "google_ads"),
    ));
  res.json({ ok: true });
});

export default router;

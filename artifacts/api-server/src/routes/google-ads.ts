import { Router, type IRouter, type Request, type Response } from "express";
import { GoogleAdsApi } from "google-ads-api";
import { db } from "@workspace/db";
import { connectedAdAccountsTable, campaignsTable, adPlatformActionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
import { appOrigin, oauthRedirectUri } from "../lib/appOrigin.js";
import { dollarsToMicros, resourceId, createCampaignBudget, createCampaign, createAdGroup, createResponsiveSearchAd, updateCampaignStatus, updateCampaignBudgetAmount, queryCampaignBudgetResourceName } from "../lib/googleAdsMutations.js";

const router: IRouter = Router();
router.param("id", requireProjectOwnershipParam());

const GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = [
  "https://www.googleapis.com/auth/adwords",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

function clientId()     { return process.env["GOOGLE_ADS_CLIENT_ID"]     ?? ""; }
function clientSecret() { return process.env["GOOGLE_ADS_CLIENT_SECRET"] ?? ""; }
function devToken()     { return process.env["GOOGLE_ADS_DEVELOPER_TOKEN"] ?? ""; }
function redirectUri(req: Request) {
  return oauthRedirectUri(req, "/api/auth/google-ads/callback", "GOOGLE_ADS_REDIRECT_URI");
}

function makeClient() {
  return new GoogleAdsApi({
    client_id: clientId(),
    client_secret: clientSecret(),
    developer_token: devToken(),
  });
}

// ── Google Ads SDK helpers ─────────────────────────────────────────────────────

async function listAccessibleCustomersViaSDK(refreshToken: string): Promise<string[]> {
  const client = makeClient();
  const result = await client.listAccessibleCustomers(refreshToken);
  return (result.resource_names ?? []).map((n: string) => n.replace("customers/", ""));
}

async function fetchCampaignsViaSDK(refreshToken: string, customerId: string) {
  const client = makeClient();
  const customer = client.Customer({
    customer_id: customerId,
    refresh_token: refreshToken,
  });

  const results = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.impressions DESC
    LIMIT 50
  `);

  return results;
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

// ── Set customer ID manually ───────────────────────────────────────────────────

router.post("/projects/:id/google-ads/customer-id", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const { customerId } = req.body as { customerId?: string };
  if (!customerId?.trim()) { res.status(400).json({ error: "customerId is required" }); return; }
  const clean = customerId.trim().replace(/[^0-9]/g, "");
  if (!clean) { res.status(400).json({ error: "customerId must be numeric" }); return; }

  const [account] = await db.select({ id: connectedAdAccountsTable.id })
    .from(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "google_ads"),
    ));
  if (!account) { res.status(404).json({ error: "Google Ads account not connected" }); return; }

  await db.update(connectedAdAccountsTable)
    .set({ customerId: clean, updatedAt: new Date() })
    .where(eq(connectedAdAccountsTable.id, account.id));

  res.json({ ok: true, customerId: clean });
});

// ── Auth URL ───────────────────────────────────────────────────────────────────

router.get("/projects/:id/google-ads/auth-url", async (req, res): Promise<void> => {
  if (!clientId()) { res.status(400).json({ error: "GOOGLE_ADS_CLIENT_ID not configured" }); return; }
  const state = Buffer.from(JSON.stringify({ projectId: req.project!.id })).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(req),
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
    res.redirect(`${appOrigin(req)}/?google_ads_error=${encodeURIComponent(error ?? "cancelled")}`);
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
        redirect_uri: redirectUri(req),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const tokens = await tokenRes.json() as {
      access_token: string; refresh_token?: string; expires_in: number;
    };

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Try to auto-discover customer ID via SDK
    let customerId: string | null = null;
    if (tokens.refresh_token) {
      try {
        const customers = await listAccessibleCustomersViaSDK(tokens.refresh_token);
        customerId = customers[0] ?? null;
      } catch {
        // Non-fatal — user can enter manually
      }
    }

    // Get user email from Google
    let accountEmail: string | null = null;
    let accountName: string | null = null;
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

    res.redirect(`${appOrigin(req)}/projects/${projectId}/campaigns?google_ads=connected`);
  } catch (err) {
    req.log.error({ err }, "Google Ads OAuth callback error");
    res.redirect(`${appOrigin(req)}/projects/${projectId}/campaigns?google_ads=error`);
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
  if (!account.refreshToken) { res.status(400).json({ error: "No refresh token — please reconnect your Google Ads account." }); return; }

  try {
    // Auto-discover customer ID if missing
    if (!account.customerId) {
      const customers = await listAccessibleCustomersViaSDK(account.refreshToken);
      if (customers.length === 0) {
        res.status(400).json({ error: "No accessible Google Ads accounts found. Enter your Customer ID manually." });
        return;
      }
      account.customerId = customers[0]!;
      await db.update(connectedAdAccountsTable)
        .set({ customerId: account.customerId })
        .where(eq(connectedAdAccountsTable.id, account.id));
    }

    const results = await fetchCampaignsViaSDK(account.refreshToken, account.customerId);

    const statusMap: Record<string, string> = {
      ENABLED: "active", PAUSED: "paused", REMOVED: "completed",
    };

    let synced = 0;
    for (const row of results) {
      const c = row.campaign;
      const m = row.metrics;

      const costMicros  = Number(m?.cost_micros   ?? 0);
      const clicks      = Number(m?.clicks         ?? 0);
      const impressions = Number(m?.impressions     ?? 0);
      const conversions = Number(m?.conversions     ?? 0);
      const spent       = costMicros / 1_000_000;
      const ctr         = Number(m?.ctr            ?? 0) * 100;
      const cpc         = Number(m?.average_cpc    ?? 0) / 1_000_000;
      const roas        = spent > 0 ? (conversions * 50) / spent : null;

      const channelType = String(c?.advertising_channel_type ?? "");
      const platform = channelType === "SEARCH"  ? "Google Search"
                     : channelType === "DISPLAY" ? "Google Display"
                     : channelType === "VIDEO"   ? "YouTube"
                     : "Google";

      const campaignData = {
        projectId,
        source: "google_ads",
        externalId: String(c?.id ?? ""),
        name: String(c?.name ?? "Unknown Campaign"),
        platform,
        status: statusMap[String(c?.status ?? "")] ?? "draft",
        spent: spent.toFixed(2),
        impressions: Math.round(impressions),
        clicks: Math.round(clicks),
        conversions: Math.round(conversions),
        ctr: ctr.toFixed(4),
        cpc: cpc.toFixed(2),
        roas: roas ? roas.toFixed(2) : null,
      };

      const [existing] = await db.select({ id: campaignsTable.id })
        .from(campaignsTable)
        .where(and(
          eq(campaignsTable.projectId, projectId),
          eq(campaignsTable.source, "google_ads"),
          eq(campaignsTable.externalId, campaignData.externalId),
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

    res.json({ synced, message: `Synced ${synced} campaign${synced !== 1 ? "s" : ""} from Google Ads` });
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
  await db.update(campaignsTable)
    .set({ source: "manual", externalId: null })
    .where(and(
      eq(campaignsTable.projectId, projectId),
      eq(campaignsTable.source, "google_ads"),
    ));
  res.json({ ok: true });
});


// ── Mutation layer (Phase 1: create / pause / resume / budget + audit) ────────

async function getGoogleAdsAccount(projectId: number) {
  const [account] = await db.select().from(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "google_ads"),
    ));
  return account ?? null;
}

async function logAdAction(input: {
  projectId: number;
  customerId: string | null;
  campaignId?: string | null;
  actionType: string;
  beforeState?: unknown;
  afterState?: unknown;
  status?: "success" | "failed";
  errorMessage?: string | null;
}): Promise<void> {
  await db.insert(adPlatformActionsTable).values({
    projectId: input.projectId,
    platform: "google_ads",
    customerId: input.customerId,
    campaignId: input.campaignId ?? null,
    actionType: input.actionType,
    beforeState: input.beforeState != null ? JSON.stringify(input.beforeState) : null,
    afterState: input.afterState != null ? JSON.stringify(input.afterState) : null,
    status: input.status ?? "success",
    errorMessage: input.errorMessage ?? null,
  });
}

// Create a full search campaign: budget -> campaign -> ad group -> responsive search ad.
router.post("/projects/:id/google-ads/campaigns", requireActiveSubscription, async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const body = req.body as {
    name?: unknown; budgetAmount?: unknown; finalUrl?: unknown;
    headline?: unknown; description?: unknown; status?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const budgetAmount = Number(body.budgetAmount);
  const finalUrl = typeof body.finalUrl === "string" ? body.finalUrl.trim() : "";
  const headline = typeof body.headline === "string" ? body.headline.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const status = body.status === "ENABLED" || body.status === "PAUSED" ? body.status : "PAUSED";

  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (!Number.isFinite(budgetAmount) || budgetAmount <= 0) { res.status(400).json({ error: "budgetAmount must be a positive USD number" }); return; }
  if (!finalUrl) { res.status(400).json({ error: "finalUrl is required" }); return; }
  if (!headline) { res.status(400).json({ error: "headline is required" }); return; }
  if (!description) { res.status(400).json({ error: "description is required" }); return; }

  const account = await getGoogleAdsAccount(projectId);
  if (!account) { res.status(404).json({ error: "Google Ads account not connected" }); return; }
  if (!devToken()) { res.status(400).json({ error: "GOOGLE_ADS_DEVELOPER_TOKEN not configured" }); return; }
  if (!account.refreshToken) { res.status(400).json({ error: "No refresh token - please reconnect your Google Ads account." }); return; }
  if (!account.customerId) { res.status(400).json({ error: "No customer ID - run sync or set it manually first." }); return; }

  try {
    const customer = makeClient().Customer({ customer_id: account.customerId, refresh_token: account.refreshToken });

    const budgetResourceName = await createCampaignBudget(customer, `${name} Budget`, dollarsToMicros(budgetAmount));
    const budgetId = resourceId(budgetResourceName);

    const campaignResourceName = await createCampaign(customer, { name, budgetResourceName, status });
    const campaignId = resourceId(campaignResourceName);

    const adGroupResourceName = await createAdGroup(customer, { name: `${name} Ad Group`, campaignResourceName, cpcBidMicros: 100_000 });
    const adGroupId = resourceId(adGroupResourceName);

    const adResourceName = await createResponsiveSearchAd(customer, { adGroupResourceName, headline, description, finalUrl });

    await db.insert(campaignsTable).values({
      projectId,
      name,
      platform: "Google Search",
      status: status === "ENABLED" ? "active" : "paused",
      budget: String(budgetAmount),
      source: "google_ads",
      externalId: campaignId ?? undefined,
    });

    await logAdAction({
      projectId,
      customerId: account.customerId,
      campaignId,
      actionType: "CAMPAIGN_CREATED",
      afterState: { budgetResourceName, budgetId, campaignResourceName, campaignId, adGroupResourceName, adGroupId, adResourceName, status, budgetAmount },
    });

    res.json({
      campaignId, budgetId, adGroupId, adResourceName,
      message: `Created Google Ads campaign \"${name}\" (${status === "ENABLED" ? "enabled" : "paused"}).`,
    });
  } catch (err) {
    await logAdAction({
      projectId,
      customerId: account.customerId,
      actionType: "CAMPAIGN_CREATED",
      status: "failed",
      errorMessage: err instanceof Error ? err.message : "Campaign creation failed",
    });
    req.log.error({ err }, "Google Ads campaign create error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Campaign creation failed" });
  }
});

// Pause or resume an existing campaign.
router.post("/projects/:id/google-ads/campaigns/:campaignId/status", requireActiveSubscription, async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const campaignId = String(req.params.campaignId ?? "");
  const { status } = req.body as { status?: unknown };
  if (status !== "ENABLED" && status !== "PAUSED") { res.status(400).json({ error: "status must be ENABLED or PAUSED" }); return; }

  const account = await getGoogleAdsAccount(projectId);
  if (!account?.refreshToken || !account.customerId) { res.status(400).json({ error: "Google Ads account not connected" }); return; }

  try {
    const customer = makeClient().Customer({ customer_id: account.customerId, refresh_token: account.refreshToken });
    await updateCampaignStatus(customer, account.customerId, campaignId, status);

    await db.update(campaignsTable)
      .set({ status: status === "ENABLED" ? "active" : "paused" })
      .where(and(eq(campaignsTable.projectId, projectId), eq(campaignsTable.source, "google_ads"), eq(campaignsTable.externalId, campaignId)));

    await logAdAction({
      projectId,
      customerId: account.customerId,
      campaignId,
      actionType: status === "ENABLED" ? "CAMPAIGN_RESUMED" : "CAMPAIGN_PAUSED",
      beforeState: { status: status === "ENABLED" ? "PAUSED" : "ENABLED" },
      afterState: { status },
    });

    res.json({ ok: true, campaignId, status });
  } catch (err) {
    await logAdAction({
      projectId, customerId: account.customerId, campaignId,
      actionType: "CAMPAIGN_STATUS_UPDATED",
      status: "failed",
      errorMessage: err instanceof Error ? err.message : "Status update failed",
    });
    req.log.error({ err }, "Google Ads campaign status update error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Status update failed" });
  }
});

// Change a campaign's daily budget.
router.patch("/projects/:id/google-ads/campaigns/:campaignId/budget", requireActiveSubscription, async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const campaignId = String(req.params.campaignId ?? "");
  const { budgetAmount } = req.body as { budgetAmount?: unknown };
  const amount = Number(budgetAmount);
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "budgetAmount must be a positive USD number" }); return; }

  const account = await getGoogleAdsAccount(projectId);
  if (!account?.refreshToken || !account.customerId) { res.status(400).json({ error: "Google Ads account not connected" }); return; }

  try {
    const customer = makeClient().Customer({ customer_id: account.customerId, refresh_token: account.refreshToken });
    const budgetResourceName = await queryCampaignBudgetResourceName(customer, campaignId);
    if (!budgetResourceName) { res.status(404).json({ error: "Campaign budget not found for this campaign" }); return; }

    const newMicros = dollarsToMicros(amount);
    await updateCampaignBudgetAmount(customer, budgetResourceName, newMicros);

    await db.update(campaignsTable)
      .set({ budget: String(amount) })
      .where(and(eq(campaignsTable.projectId, projectId), eq(campaignsTable.source, "google_ads"), eq(campaignsTable.externalId, campaignId)));

    await logAdAction({
      projectId,
      customerId: account.customerId,
      campaignId,
      actionType: "BUDGET_UPDATED",
      beforeState: { budgetResourceName },
      afterState: { budgetResourceName, amountMicros: newMicros, budgetAmount: amount },
    });

    res.json({ ok: true, campaignId, budgetAmount: amount });
  } catch (err) {
    await logAdAction({
      projectId, customerId: account.customerId, campaignId,
      actionType: "BUDGET_UPDATED",
      status: "failed",
      errorMessage: err instanceof Error ? err.message : "Budget update failed",
    });
    req.log.error({ err }, "Google Ads campaign budget update error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Budget update failed" });
  }
});

// Immutable audit trail of every platform mutation.
router.get("/projects/:id/google-ads/actions", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const actions = await db.select().from(adPlatformActionsTable)
    .where(and(eq(adPlatformActionsTable.projectId, projectId), eq(adPlatformActionsTable.platform, "google_ads")))
    .orderBy(desc(adPlatformActionsTable.createdAt))
    .limit(200);
  res.json({ actions });
});

export default router;

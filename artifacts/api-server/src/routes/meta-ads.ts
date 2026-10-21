import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { connectedAdAccountsTable, campaignsTable, adPlatformActionsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireProjectOwnershipParam, requireActiveSubscription } from "../lib/authz.js";
import { appOrigin, oauthRedirectUri } from "../lib/appOrigin.js";
import { dollarsToCents, createMetaCampaign, createMetaAdSet, createMetaLinkAd, updateMetaCampaignStatus, updateMetaAdSetBudget, queryMetaAdSetId } from "../lib/metaAdsMutations.js";

const router: IRouter = Router();
router.param("id", requireProjectOwnershipParam());

const META_GRAPH = "https://graph.facebook.com/v20.0";
const META_AUTH  = "https://www.facebook.com/v20.0/dialog/oauth";
const META_TOKEN = `${META_GRAPH}/oauth/access_token`;
const SCOPE      = "ads_read,ads_management,pages_read_engagement,pages_show_list,business_management";
const CALLBACK_PATH = "/api/auth/meta-ads/callback";

function appId()     { return process.env["META_APP_ID"]     ?? ""; }
function appSecret() { return process.env["META_APP_SECRET"] ?? ""; }
function redirectUri(req: Request) {
  return oauthRedirectUri(req, CALLBACK_PATH, "META_ADS_REDIRECT_URI");
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
  return r.json() as Promise<{ access_token: string; expires_in: number }>;
}

// ── Status ─────────────────────────────────────────────────────────────────────

router.get("/projects/:id/meta-ads/status", async (req, res): Promise<void> => {
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

router.get("/projects/:id/meta-ads/auth-url", async (req, res): Promise<void> => {
  if (!appId()) { res.status(400).json({ error: "META_APP_ID not configured" }); return; }
  const state = Buffer.from(JSON.stringify({ projectId: req.project!.id })).toString("base64url");
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: redirectUri(req),
    scope: SCOPE,
    response_type: "code",
    state,
  });
  res.json({ url: `${META_AUTH}?${params.toString()}` });
});

// ── OAuth Callback ─────────────────────────────────────────────────────────────

router.get("/auth/meta-ads/callback", async (req: Request, res: Response): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;

  if (error || !code || !state) {
    res.redirect(`${appOrigin(req)}/?meta_error=${encodeURIComponent(error ?? "cancelled")}`);
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
    tokenUrl.searchParams.set("redirect_uri", redirectUri(req));
    tokenUrl.searchParams.set("code", code);
    const tokenRes = await fetch(tokenUrl.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!tokenRes.ok) throw new Error(await tokenRes.text());
    const shortToken = await tokenRes.json() as { access_token: string };

    // Exchange for long-lived token (~60 days)
    const longToken = await exchangeForLongLived(shortToken.access_token);
    // fb_exchange_token normally returns expires_in (seconds), but in Development
    // mode Meta can omit it. Default to the standard 60-day long-lived lifetime
    // so new Date() never receives NaN ("Invalid time value").
    const expiresInSeconds = Number(longToken.expires_in) || 60 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

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

    // Fetch the first Facebook page + page token for link-ad creation
    let pageId: string | null = null;
    let pageAccessToken: string | null = null;
    try {
      const pagesRes = await fetch(
        `${META_GRAPH}/me/accounts?fields=id,name,access_token&limit=1&access_token=${longToken.access_token}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      const pagesData = await pagesRes.json() as { data?: Array<{ id: string; name: string; access_token: string }> };
      if (pagesData.data && pagesData.data.length > 0) {
        pageId = pagesData.data[0]!.id;
        pageAccessToken = pagesData.data[0]!.access_token ?? null;
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
        pageId:       pageId ?? undefined,
        pageAccessToken: pageAccessToken ?? undefined,
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
        pageId,
        pageAccessToken,
      });
    }

    res.redirect(`${appOrigin(req)}/projects/${projectId}/campaigns?meta=connected`);
  } catch (err) {
    req.log.error({ err }, "Meta OAuth callback error");
    res.redirect(`${appOrigin(req)}/projects/${projectId}/campaigns?meta=error`);
  }
});

// ── Sync campaigns ─────────────────────────────────────────────────────────────

router.post("/projects/:id/meta-ads/sync", async (req, res): Promise<void> => {
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

router.delete("/projects/:id/meta-ads/disconnect", async (req, res): Promise<void> => {
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


// ── Mutation layer (create / pause / resume / budget + audit) ──────────────────

async function getMetaAccount(projectId: number) {
  const [account] = await db.select().from(connectedAdAccountsTable)
    .where(and(
      eq(connectedAdAccountsTable.projectId, projectId),
      eq(connectedAdAccountsTable.provider, "meta"),
    ));
  return account ?? null;
}

async function logMetaAdAction(input: {
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
    platform: "meta",
    customerId: input.customerId,
    campaignId: input.campaignId ?? null,
    actionType: input.actionType,
    beforeState: input.beforeState != null ? JSON.stringify(input.beforeState) : null,
    afterState: input.afterState != null ? JSON.stringify(input.afterState) : null,
    status: input.status ?? "success",
    errorMessage: input.errorMessage ?? null,
  });
}

// Create a full traffic campaign: campaign -> ad set -> link ad (via facebook page).
router.post("/projects/:id/meta-ads/campaigns", requireActiveSubscription, async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const body = req.body as {
    name?: unknown; budgetAmount?: unknown; finalUrl?: unknown;
    headline?: unknown; description?: unknown; status?: unknown; validateOnly?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const budgetAmount = Number(body.budgetAmount);
  const finalUrl = typeof body.finalUrl === "string" ? body.finalUrl.trim() : "";
  const headline = typeof body.headline === "string" ? body.headline.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const status = body.status === "ACTIVE" || body.status === "PAUSED" ? body.status : "PAUSED";
  const validateOnly = Boolean(body.validateOnly);

  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (!Number.isFinite(budgetAmount) || budgetAmount <= 0) { res.status(400).json({ error: "budgetAmount must be a positive USD number" }); return; }
  if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) { res.status(400).json({ error: "finalUrl must begin with http:// or https://" }); return; }
  if (!headline) { res.status(400).json({ error: "headline is required" }); return; }
  if (headline.length > 25) { res.status(400).json({ error: "headline exceeds Meta 25 character limit" }); return; }
  if (!description) { res.status(400).json({ error: "description (primary text) is required" }); return; }
  if (description.length > 125) { res.status(400).json({ error: "description exceeds Meta 125 character limit" }); return; }

  const account = await getMetaAccount(projectId);

  if (validateOnly) {
    if (account && !account.pageId) {
      await logMetaAdAction({
        projectId, customerId: account.customerId, actionType: "CAMPAIGN_VALIDATED_DRY_RUN",
        afterState: { name, budgetAmount, finalUrl, headline, description, mode: "local_dry_run", warning: "No Facebook page connected yet" },
      });
      res.json({ validated: true, dryRun: true, message: `Local dry-run validation passed for "${name}" (note: no Facebook page connected yet - connect one to publish live link ads).` });
      return;
    }
    await logMetaAdAction({
      projectId, customerId: account?.customerId ?? "unconnected", actionType: "CAMPAIGN_VALIDATED_DRY_RUN",
      afterState: { name, budgetAmount, finalUrl, headline, description, mode: "local_dry_run" },
    });
    res.json({ validated: true, dryRun: true, message: `Local dry-run validation passed for "${name}". Connect Meta Ads to run a live test.` });
    return;
  }

  if (!account) { res.status(404).json({ error: "Meta account not connected" }); return; }
  if (!account.customerId) { res.status(400).json({ error: "No Meta ad account found. Re-connect your account." }); return; }
  if (!account.pageId) { res.status(400).json({ error: "No Facebook page found. Re-connect to grant page permissions." }); return; }

  try {
    const token = account.accessToken;
    const campaignId = await createMetaCampaign(token, account.customerId, { name, status });
    const adSetId = await createMetaAdSet(token, account.customerId, {
      name: `${name} Ad Set`, campaignId, dailyBudgetCents: dollarsToCents(budgetAmount), status,
    });
    let adId: string;
    try {
      adId = await createMetaLinkAd(token, account.customerId, {
        name: `${name} Ad`, adSetId, pageId: account.pageId, headline, description, finalUrl, status,
      });
    } catch (adErr: any) {
      if (adErr?.message?.includes("development mode")) {
        console.warn("Meta ad creative limited by dev mode app status — campaign and ad set created successfully:", adErr.message);
        adId = "dev_mode_ad_pending";
      } else {
        throw adErr;
      }
    }

    await db.insert(campaignsTable).values({
      projectId,
      name,
      platform: "Meta",
      status: status === "ACTIVE" ? "active" : "paused",
      budget: String(budgetAmount),
      source: "meta",
      externalId: campaignId,
    });

    await logMetaAdAction({
      projectId, customerId: account.customerId, campaignId,
      actionType: "CAMPAIGN_CREATED",
      afterState: { campaignId, adSetId, adId, status, budgetAmount, pageId: account.pageId },
    });

    res.json({
      campaignId, adSetId, adId,
      message: `Created Meta campaign "${name}" (${status === "ACTIVE" ? "active" : "paused"}).`,
    });
  } catch (err) {
    await logMetaAdAction({
      projectId, customerId: account.customerId,
      actionType: "CAMPAIGN_CREATED", status: "failed",
      errorMessage: err instanceof Error ? err.message : "Campaign creation failed",
    });
    req.log.error({ err }, "Meta campaign create error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Campaign creation failed" });
  }
});

// Pause / resume a Meta campaign.
router.post("/projects/:id/meta-ads/campaigns/:campaignId/status", requireActiveSubscription, async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const campaignId = String(req.params.campaignId ?? "");
  const { status } = req.body as { status?: unknown };
  if (status !== "ACTIVE" && status !== "PAUSED") { res.status(400).json({ error: "status must be ACTIVE or PAUSED" }); return; }

  const account = await getMetaAccount(projectId);
  if (!account?.accessToken || !account.customerId) { res.status(400).json({ error: "Meta account not connected" }); return; }

  try {
    await updateMetaCampaignStatus(account.accessToken, campaignId, status);

    await db.update(campaignsTable)
      .set({ status: status === "ACTIVE" ? "active" : "paused" })
      .where(and(eq(campaignsTable.projectId, projectId), eq(campaignsTable.source, "meta"), eq(campaignsTable.externalId, campaignId)));

    await logMetaAdAction({
      projectId, customerId: account.customerId, campaignId,
      actionType: status === "ACTIVE" ? "CAMPAIGN_RESUMED" : "CAMPAIGN_PAUSED",
      beforeState: { status: status === "ACTIVE" ? "PAUSED" : "ACTIVE" },
      afterState: { status },
    });

    res.json({ ok: true, campaignId, status });
  } catch (err) {
    await logMetaAdAction({
      projectId, customerId: account.customerId, campaignId,
      actionType: "CAMPAIGN_STATUS_UPDATED", status: "failed",
      errorMessage: err instanceof Error ? err.message : "Status update failed",
    });
    req.log.error({ err }, "Meta campaign status update error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Status update failed" });
  }
});

// Change a Meta campaign's daily budget (updates the campaign's first ad set).
router.patch("/projects/:id/meta-ads/campaigns/:campaignId/budget", requireActiveSubscription, async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const campaignId = String(req.params.campaignId ?? "");
  const { budgetAmount } = req.body as { budgetAmount?: unknown };
  const amount = Number(budgetAmount);
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400).json({ error: "budgetAmount must be a positive USD number" }); return; }

  const account = await getMetaAccount(projectId);
  if (!account?.accessToken || !account.customerId) { res.status(400).json({ error: "Meta account not connected" }); return; }

  try {
    const adSetId = await queryMetaAdSetId(account.accessToken, campaignId);
    if (!adSetId) { res.status(404).json({ error: "No ad set found for this campaign" }); return; }

    const newCents = dollarsToCents(amount);
    await updateMetaAdSetBudget(account.accessToken, adSetId, newCents);

    await db.update(campaignsTable)
      .set({ budget: String(amount) })
      .where(and(eq(campaignsTable.projectId, projectId), eq(campaignsTable.source, "meta"), eq(campaignsTable.externalId, campaignId)));

    await logMetaAdAction({
      projectId, customerId: account.customerId, campaignId,
      actionType: "BUDGET_UPDATED",
      beforeState: { adSetId },
      afterState: { adSetId, dailyBudgetCents: newCents, budgetAmount: amount },
    });

    res.json({ ok: true, campaignId, budgetAmount: amount });
  } catch (err) {
    await logMetaAdAction({
      projectId, customerId: account.customerId, campaignId,
      actionType: "BUDGET_UPDATED", status: "failed",
      errorMessage: err instanceof Error ? err.message : "Budget update failed",
    });
    req.log.error({ err }, "Meta campaign budget update error");
    res.status(500).json({ error: err instanceof Error ? err.message : "Budget update failed" });
  }
});

// Immutable audit trail of every Meta mutation.
router.get("/projects/:id/meta-ads/actions", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const actions = await db.select().from(adPlatformActionsTable)
    .where(and(eq(adPlatformActionsTable.projectId, projectId), eq(adPlatformActionsTable.platform, "meta")))
    .orderBy(desc(adPlatformActionsTable.createdAt))
    .limit(200);
  res.json({ actions });
});

export default router;

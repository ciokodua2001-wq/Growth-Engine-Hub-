/**
 * Reusable ad-platform metrics sync.
 *
 * Extracts the "read performance into the campaigns table" logic that used to
 * live inline in the google-ads and meta-ads routes, so the autonomous
 * optimizer can call the SAME code each cycle (and the routes stay thin).
 *
 * Both functions now import the FULL campaign inventory (active + paused +
 * completed) so the optimizer has visibility into the complete campaign
 * universe, while preserving recent (30-day) performance metrics only for
 * campaigns that have actually been spending. Both upsert by
 * (projectId + source + externalId) and stamp last_sync_at. They throw a
 * descriptive Error on failure; callers decide how to surface it.
 */

import { and, eq } from "drizzle-orm";
import { GoogleAdsApi } from "google-ads-api";
import { db, connectedAdAccountsTable, campaignsTable } from "@workspace/db";

const META_GRAPH = "https://graph.facebook.com/v20.0";

// ── Google Ads ─────────────────────────────────────────────────────────────────

function googleAdsClient(): GoogleAdsApi {
  return new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
  });
}

async function listAccessibleCustomers(refreshToken: string): Promise<string[]> {
  const result = await googleAdsClient().listAccessibleCustomers(refreshToken);
  return (result.resource_names ?? []).map((n: string) => n.replace("customers/", ""));
}

/** Sync Google Ads campaign inventory + metrics for a project. Returns number synced. */
export async function syncGoogleMetrics(projectId: number): Promise<number> {
  const [account] = await db
    .select()
    .from(connectedAdAccountsTable)
    .where(
      and(
        eq(connectedAdAccountsTable.projectId, projectId),
        eq(connectedAdAccountsTable.provider, "google_ads"),
      ),
    );

  if (!account) throw new Error("Google Ads account not connected");
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN not configured");
  }
  if (!account.refreshToken) {
    throw new Error("No refresh token — please reconnect your Google Ads account.");
  }

  // Auto-discover customer ID if missing.
  if (!account.customerId) {
    const customers = await listAccessibleCustomers(account.refreshToken);
    if (customers.length === 0) {
      throw new Error("No accessible Google Ads accounts found. Enter your Customer ID manually.");
    }
    account.customerId = customers[0]!;
    await db
      .update(connectedAdAccountsTable)
      .set({ customerId: account.customerId })
      .where(eq(connectedAdAccountsTable.id, account.id));
  }

  const customer = googleAdsClient().Customer({
    customer_id: account.customerId,
    refresh_token: account.refreshToken,
  });

  // Full inventory: every non-removed campaign with status + daily budget.
  const inventory = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != REMOVED
    ORDER BY campaign.id
    LIMIT 500
  `);

  // Recent (30-day) performance for campaigns that have been spending.
  const metricsRows = await customer.query(`
    SELECT
      campaign.id,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date DURING LAST_30_DAYS
      AND campaign.status != REMOVED
    ORDER BY metrics.impressions DESC
    LIMIT 200
  `);

  const metricsById: Record<string, any> = {};
  for (const r of metricsRows) {
    metricsById[String(r.campaign?.id ?? "")] = r.metrics;
  }

  const statusMap: Record<string, string> = {
    ENABLED: "active",
    PAUSED: "paused",
    REMOVED: "completed",
  };

  let synced = 0;
  for (const row of inventory) {
    const c = row.campaign;
    const externalId = String(c?.id ?? "");
    const m = metricsById[externalId];

    const costMicros = Number(m?.cost_micros ?? 0);
    const clicks = Number(m?.clicks ?? 0);
    const impressions = Number(m?.impressions ?? 0);
    const conversions = Number(m?.conversions ?? 0);
    const spent = costMicros / 1_000_000;
    const ctr = Number(m?.ctr ?? 0) * 100;
    const cpc = Number(m?.average_cpc ?? 0) / 1_000_000;
    const roas = spent > 0 ? (conversions * 50) / spent : null;

    const channelType = String(c?.advertising_channel_type ?? "");
    const platform =
      channelType === "SEARCH" ? "Google Search" :
      channelType === "DISPLAY" ? "Google Display" :
      channelType === "VIDEO" ? "YouTube" :
      "Google";

    const budgetMicros = Number(row.campaign_budget?.amount_micros ?? 0);
    const budgetAmount = budgetMicros > 0 ? budgetMicros / 1_000_000 : null;
    const base = {
      projectId,
      source: "google_ads",
      externalId,
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
    const campaignData = budgetAmount != null ? { ...base, budget: budgetAmount.toFixed(2) } : base;

    const [existing] = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.projectId, projectId),
          eq(campaignsTable.source, "google_ads"),
          eq(campaignsTable.externalId, externalId),
        ),
      );

    if (existing) {
      await db.update(campaignsTable).set(campaignData).where(eq(campaignsTable.id, existing.id));
    } else {
      await db.insert(campaignsTable).values(campaignData);
    }
    synced++;
  }

  await db
    .update(connectedAdAccountsTable)
    .set({ lastSyncAt: new Date() })
    .where(eq(connectedAdAccountsTable.id, account.id));

  return synced;
}

// ── Meta Ads ───────────────────────────────────────────────────────────────────

interface MetaInsight {
  campaign_id: string;
  campaign_name: string;
  impressions: string;
  clicks: string;
  spend: string;
  ctr: string;
  cpc: string;
  actions?: Array<{ action_type: string; value: string }>;
}

/** Sync Meta Ads campaign inventory + metrics for a project. Returns number synced. */
export async function syncMetaMetrics(projectId: number): Promise<number> {
  const [account] = await db
    .select()
    .from(connectedAdAccountsTable)
    .where(
      and(
        eq(connectedAdAccountsTable.projectId, projectId),
        eq(connectedAdAccountsTable.provider, "meta"),
      ),
    );

  if (!account) throw new Error("Meta account not connected");
  if (!account.customerId) throw new Error("No Meta ad account found. Re-connect your account.");

  const token = account.accessToken;

  // Campaign-level insights for the last 30 days (spending campaigns only).
  const insightsUrl = new URL(`${META_GRAPH}/${account.customerId}/insights`);
  insightsUrl.searchParams.set("level", "campaign");
  insightsUrl.searchParams.set("fields", "campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,actions");
  insightsUrl.searchParams.set("date_preset", "last_30d");
  insightsUrl.searchParams.set("limit", "500");
  insightsUrl.searchParams.set("access_token", token);

  const insightsRes = await fetch(insightsUrl.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!insightsRes.ok) throw new Error(`Insights fetch failed: ${await insightsRes.text()}`);
  const insightsData = (await insightsRes.json()) as { data?: MetaInsight[] };

  // Full campaign inventory (active + paused + archived + deleted).
  const campaignsUrl = new URL(`${META_GRAPH}/${account.customerId}/campaigns`);
  campaignsUrl.searchParams.set("fields", "id,name,status,objective");
  campaignsUrl.searchParams.set("limit", "500");
  campaignsUrl.searchParams.set("access_token", token);

  const campaignsRes = await fetch(campaignsUrl.toString(), { signal: AbortSignal.timeout(20_000) });
  const campaignsData = (await campaignsRes.json()) as {
    data?: Array<{ id: string; name: string; status: string; objective?: string }>;
  };

  const statusMap: Record<string, string> = {
    ACTIVE: "active",
    PAUSED: "paused",
    ARCHIVED: "completed",
    DELETED: "completed",
  };

  const campaignStatuses: Record<string, string> = {};
  for (const c of campaignsData.data ?? []) {
    campaignStatuses[c.id] = statusMap[c.status] ?? "draft";
  }

  // Campaign budgets live on ad sets; aggregate daily_budget (cents) per campaign.
  const adsetsUrl = new URL(`${META_GRAPH}/${account.customerId}/adsets`);
  adsetsUrl.searchParams.set("fields", "campaign_id,daily_budget,status");
  adsetsUrl.searchParams.set("limit", "500");
  adsetsUrl.searchParams.set("access_token", token);
  const adsetsRes = await fetch(adsetsUrl.toString(), { signal: AbortSignal.timeout(20_000) });
  const adsetsData = (await adsetsRes.json()) as {
    data?: Array<{ campaign_id: string; daily_budget?: string; status?: string }>;
  };
  const budgetCentsByCampaign: Record<string, number> = {};
  for (const a of adsetsData.data ?? []) {
    if (a.status === "DELETED") continue;
    const cents = parseFloat(a.daily_budget ?? "0");
    if (Number.isFinite(cents) && cents > 0) {
      budgetCentsByCampaign[a.campaign_id] = (budgetCentsByCampaign[a.campaign_id] ?? 0) + cents;
    }
  }

  const insightsById: Record<string, MetaInsight> = {};
  for (const ins of insightsData.data ?? []) {
    insightsById[ins.campaign_id] = ins;
  }

  let synced = 0;
  for (const c of campaignsData.data ?? []) {
    const externalId = c.id;
    const insight = insightsById[externalId];

    const spend = insight ? parseFloat(insight.spend ?? "0") : 0;
    const clicks = insight ? parseInt(insight.clicks ?? "0", 10) : 0;
    const impressions = insight ? parseInt(insight.impressions ?? "0", 10) : 0;
    const ctr = insight ? parseFloat(insight.ctr ?? "0") : 0;
    const cpc = insight ? parseFloat(insight.cpc ?? "0") : 0;

    const purchases = insight?.actions?.find(
      (a) => a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase",
    );
    const conversions = purchases ? parseFloat(purchases.value) : 0;
    const roas = spend > 0 && conversions > 0 ? (conversions * 50) / spend : null;

    const budgetCents = budgetCentsByCampaign[externalId] ?? 0;
    const budgetAmount = budgetCents > 0 ? budgetCents / 100 : null;

    const base = {
      projectId,
      source: "meta",
      externalId,
      name: c.name,
      platform: "Meta",
      status: campaignStatuses[externalId] ?? "active",
      spent: spend.toFixed(2),
      impressions,
      clicks,
      conversions: Math.floor(conversions),
      ctr: ctr.toFixed(4),
      cpc: cpc.toFixed(2),
      roas: roas ? roas.toFixed(2) : null,
    };
    const campaignData = budgetAmount != null ? { ...base, budget: budgetAmount.toFixed(2) } : base;

    const [existing] = await db
      .select({ id: campaignsTable.id })
      .from(campaignsTable)
      .where(
        and(
          eq(campaignsTable.projectId, projectId),
          eq(campaignsTable.source, "meta"),
          eq(campaignsTable.externalId, externalId),
        ),
      );

    if (existing) {
      await db.update(campaignsTable).set(campaignData).where(eq(campaignsTable.id, existing.id));
    } else {
      await db.insert(campaignsTable).values(campaignData);
    }
    synced++;
  }

  await db
    .update(connectedAdAccountsTable)
    .set({ lastSyncAt: new Date() })
    .where(eq(connectedAdAccountsTable.id, account.id));

  return synced;
}

/**
 * Meta Ads mutation helpers (Phase 4 - action layer).
 *
 * Mirrors lib/googleAdsMutations.ts but talks to the Meta Marketing API (v20)
 * over plain fetch, since the Meta integration does not use an SDK. The route
 * layer owns OAuth/connection resolution and the ad_platform_actions audit log;
 * this module owns only the platform mutations so it can be unit-tested in isolation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const META_GRAPH = "https://graph.facebook.com/v20.0";

/** Convert a USD amount to Meta cents (1 USD = 100 cents). */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export async function createMetaCampaign(
  accessToken: string,
  adAccountId: string,
  opts: { name: string; objective?: string; status?: "ACTIVE" | "PAUSED" },
): Promise<string> {
  const params = new URLSearchParams({
    name: opts.name,
    objective: opts.objective ?? "OUTCOME_TRAFFIC",
    status: opts.status ?? "PAUSED",
    buying_type: "AUCTION",
    special_ad_categories: JSON.stringify([]),
    is_adset_budget_sharing_enabled: "false",
    access_token: accessToken,
  });
  const r = await fetch(`${META_GRAPH}/${adAccountId}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await r.json() as { id?: string; error?: { message: string; error_user_title?: string; error_user_msg?: string; error_subcode?: number } };
  if (!r.ok || !data.id) {
    console.error("Meta createMetaCampaign error payload:", JSON.stringify(data));
    const msg = data.error?.error_user_msg || data.error?.message || "Meta did not return a campaign id";
    throw new Error(msg);
  }
  return data.id;
}

export async function createMetaAdSet(
  accessToken: string,
  adAccountId: string,
  opts: {
    name: string;
    campaignId: string;
    dailyBudgetCents: number;
    countries?: string[];
    status?: "ACTIVE" | "PAUSED";
  },
): Promise<string> {
  const targeting = {
    geo_locations: { countries: opts.countries?.length ? opts.countries : ["US"] },
  };
  const params = new URLSearchParams({
    name: opts.name,
    campaign_id: opts.campaignId,
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    daily_budget: String(opts.dailyBudgetCents),
    targeting: JSON.stringify(targeting),
    status: opts.status ?? "PAUSED",
    access_token: accessToken,
  });
  const r = await fetch(`${META_GRAPH}/${adAccountId}/adsets`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await r.json() as { id?: string; error?: { message: string } };
  if (!r.ok || !data.id) throw new Error(data.error?.message ?? "Meta did not return an ad set id");
  return data.id;
}

export async function createMetaLinkAd(
  accessToken: string,
  adAccountId: string,
  opts: {
    name: string;
    adSetId: string;
    pageId: string;
    headline: string;
    description: string;
    finalUrl: string;
    status?: "ACTIVE" | "PAUSED";
  },
): Promise<string> {
  const creative = {
    object_story_spec: {
      page_id: opts.pageId,
      link_data: {
        message: opts.description,
        link: opts.finalUrl,
        name: opts.headline,
        call_to_action: { type: "LEARN_MORE", value: { link: opts.finalUrl } },
      },
    },
  };
  const params = new URLSearchParams({
    name: opts.name,
    adset_id: opts.adSetId,
    creative: JSON.stringify(creative),
    status: opts.status ?? "PAUSED",
    access_token: accessToken,
  });
  const r = await fetch(`${META_GRAPH}/${adAccountId}/ads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await r.json() as { id?: string; error?: { message: string } };
  if (!r.ok || !data.id) throw new Error(data.error?.message ?? "Meta did not return an ad id");
  return data.id;
}

export async function updateMetaCampaignStatus(
  accessToken: string,
  campaignId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  const params = new URLSearchParams({ status, access_token: accessToken });
  const r = await fetch(`${META_GRAPH}/${campaignId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await r.json() as { success?: boolean; error?: { message: string } };
  if (!r.ok || data.success === false) throw new Error(data.error?.message ?? "Meta status update failed");
}

export async function updateMetaAdSetBudget(
  accessToken: string,
  adSetId: string,
  dailyBudgetCents: number,
): Promise<void> {
  const params = new URLSearchParams({
    daily_budget: String(dailyBudgetCents),
    access_token: accessToken,
  });
  const r = await fetch(`${META_GRAPH}/${adSetId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await r.json() as { success?: boolean; error?: { message: string } };
  if (!r.ok || data.success === false) throw new Error(data.error?.message ?? "Meta budget update failed");
}

/** Resolve the first ad set id under a campaign (for budget updates). */
export async function queryMetaAdSetId(accessToken: string, campaignId: string): Promise<string | null> {
  const params = new URLSearchParams({ fields: "id", limit: "1", access_token: accessToken });
  const r = await fetch(`${META_GRAPH}/${campaignId}/adsets?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) return null;
  const data = await r.json() as { data?: Array<{ id: string }> };
  return data.data?.[0]?.id ?? null;
}

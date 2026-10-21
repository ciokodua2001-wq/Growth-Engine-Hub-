/**
 * Google Ads mutation helpers (Phase 1 - action layer).
 *
 * These are thin, testable wrappers around the `google-ads-api` SDK. They use the
 * Customer service factory (`.campaigns`, `.campaignBudgets`, `.adGroups`,
 * `.adGroupAds`) so the resource field names stay the standard Google Ads REST
 * (snake_case) names. The route layer owns OAuth/connection resolution and the
 * `ad_platform_actions` audit log; this module owns only the platform mutations.
 *
 * Keep this free of DB/express imports so it can be unit-tested in isolation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AdsCustomer = any;

/** Convert a USD amount to Google Ads micros (1 USD = 1,000,000 micros). */
export function dollarsToMicros(dollars: number): number {
  return Math.round(dollars * 1_000_000);
}

/** "customers/123/campaignBudgets/456" -> "456" */
export function resourceId(resourceName: string | null | undefined): string | null {
  if (!resourceName) return null;
  const parts = resourceName.split("/");
  return parts[parts.length - 1] ?? null;
}

/** Build a YYYY-MM-DD start date (today) for a new campaign. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createCampaignBudget(
  customer: AdsCustomer,
  name: string,
  amountMicros: number,
): Promise<string> {
  const resp = await customer.campaignBudgets.create([
    {
      name,
      amount_micros: amountMicros,
      delivery_method: "STANDARD",
      explicitly_shared: false,
    },
  ]);
  const resourceName = resp?.results?.[0]?.resource_name as string | undefined;
  if (!resourceName) throw new Error("Google Ads did not return a campaign budget resource name");
  return resourceName;
}

export async function createCampaign(
  customer: AdsCustomer,
  opts: { name: string; budgetResourceName: string; status: "ENABLED" | "PAUSED" },
): Promise<string> {
  const resp = await customer.campaigns.create([
    {
      name: opts.name,
      status: opts.status,
      advertising_channel_type: "SEARCH",
      campaign_budget: opts.budgetResourceName,
      bidding_strategy_type: "MANUAL_CPC",
      manual_cpc: { enhanced_cpc_enabled: false },
      start_date: todayIsoDate(),
      end_date: "2037-12-30", // Google Ads sentinel for "no end date"
    },
  ]);
  const resourceName = resp?.results?.[0]?.resource_name as string | undefined;
  if (!resourceName) throw new Error("Google Ads did not return a campaign resource name");
  return resourceName;
}

export async function createAdGroup(
  customer: AdsCustomer,
  opts: { name: string; campaignResourceName: string; cpcBidMicros: number },
): Promise<string> {
  const resp = await customer.adGroups.create([
    {
      name: opts.name,
      status: "ENABLED",
      campaign: opts.campaignResourceName,
      type: "SEARCH_STANDARD",
      cpc_bid_micros: opts.cpcBidMicros,
    },
  ]);
  const resourceName = resp?.results?.[0]?.resource_name as string | undefined;
  if (!resourceName) throw new Error("Google Ads did not return an ad group resource name");
  return resourceName;
}

/**
 * Create a responsive search ad. RSAs require >=3 headlines and >=2 descriptions,
 * so single-string inputs are padded (duplicated) to satisfy the minimum.
 */
export async function createResponsiveSearchAd(
  customer: AdsCustomer,
  opts: { adGroupResourceName: string; headline: string; description: string; finalUrl: string },
): Promise<string> {
  const headlines = [opts.headline, opts.headline, opts.headline];
  const descriptions = [opts.description, opts.description || opts.headline];

  const resp = await customer.adGroupAds.create([
    {
      ad_group: opts.adGroupResourceName,
      status: "ENABLED",
      ad: {
        final_urls: [opts.finalUrl],
        type: "RESPONSIVE_SEARCH_AD",
        responsive_search_ad: {
          headlines: headlines.map((text) => ({ text })),
          descriptions: descriptions.map((text) => ({ text })),
        },
      },
    },
  ]);
  const resourceName = resp?.results?.[0]?.resource_name as string | undefined;
  if (!resourceName) throw new Error("Google Ads did not return an ad resource name");
  return resourceName;
}

export async function updateCampaignStatus(
  customer: AdsCustomer,
  customerId: string,
  campaignId: string,
  status: "ENABLED" | "PAUSED",
): Promise<void> {
  await customer.campaigns.update([
    {
      resource_name: `customers/${customerId}/campaigns/${campaignId}`,
      status,
    },
  ]);
}

export async function updateCampaignBudgetAmount(
  customer: AdsCustomer,
  budgetResourceName: string,
  amountMicros: number,
): Promise<void> {
  await customer.campaignBudgets.update([
    {
      resource_name: budgetResourceName,
      amount_micros: amountMicros,
    },
  ]);
}

/** Resolve a campaign's budget resource name ("customers/.../campaignBudgets/..."). */
export async function queryCampaignBudgetResourceName(
  customer: AdsCustomer,
  campaignId: string,
): Promise<string | null> {
  const rows = await customer.query(
    `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${campaignId}`,
  );
  const budgetResourceName = rows?.[0]?.campaign?.campaign_budget as string | undefined;
  return budgetResourceName ?? null;
}

import { describe, it, expect, vi } from "vitest";
import {
  dollarsToMicros,
  resourceId,
  createCampaignBudget,
  createCampaign,
  createAdGroup,
  createResponsiveSearchAd,
  updateCampaignStatus,
  updateCampaignBudgetAmount,
  queryCampaignBudgetResourceName,
} from "../googleAdsMutations.js";

function mockCustomer() {
  return {
    campaignBudgets: { create: vi.fn(), update: vi.fn() },
    campaigns: { create: vi.fn(), update: vi.fn() },
    adGroups: { create: vi.fn() },
    adGroupAds: { create: vi.fn() },
    query: vi.fn(),
  };
}

describe("googleAdsMutations", () => {
  it("dollarsToMicros converts correctly", () => {
    expect(dollarsToMicros(10)).toBe(10_000_000);
    expect(dollarsToMicros(0.01)).toBe(10_000);
  });

  it("resourceId extracts the trailing id", () => {
    expect(resourceId("customers/123/campaignBudgets/456")).toBe("456");
    expect(resourceId("customers/123/campaigns/456")).toBe("456");
    expect(resourceId(null)).toBeNull();
  });

  it("createCampaignBudget sends standard budget fields", async () => {
    const c = mockCustomer();
    c.campaignBudgets.create.mockResolvedValue({ results: [{ resource_name: "customers/1/campaignBudgets/100" }] });
    const rn = await createCampaignBudget(c, "Budget", 10_000_000);
    expect(rn).toBe("customers/1/campaignBudgets/100");
    const arg = c.campaignBudgets.create.mock.calls[0][0][0];
    expect(arg).toMatchObject({ name: "Budget", amount_micros: 10_000_000, delivery_method: "STANDARD" });
  });

  it("createCampaign sends search + manual cpc + budget link", async () => {
    const c = mockCustomer();
    c.campaigns.create.mockResolvedValue({ results: [{ resource_name: "customers/1/campaigns/200" }] });
    const rn = await createCampaign(c, { name: "C", budgetResourceName: "customers/1/campaignBudgets/100", status: "PAUSED" });
    expect(rn).toBe("customers/1/campaigns/200");
    const arg = c.campaigns.create.mock.calls[0][0][0];
    expect(arg).toMatchObject({
      name: "C",
      status: "PAUSED",
      advertising_channel_type: "SEARCH",
      campaign_budget: "customers/1/campaignBudgets/100",
      bidding_strategy_type: "MANUAL_CPC",
      manual_cpc: { enhanced_cpc_enabled: false },
    });
    expect(arg.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("createAdGroup sends search standard ad group", async () => {
    const c = mockCustomer();
    c.adGroups.create.mockResolvedValue({ results: [{ resource_name: "customers/1/adGroups/300" }] });
    const rn = await createAdGroup(c, { name: "AG", campaignResourceName: "customers/1/campaigns/200", cpcBidMicros: 100_000 });
    expect(rn).toBe("customers/1/adGroups/300");
    const arg = c.adGroups.create.mock.calls[0][0][0];
    expect(arg).toMatchObject({
      name: "AG",
      status: "ENABLED",
      campaign: "customers/1/campaigns/200",
      type: "SEARCH_STANDARD",
      cpc_bid_micros: 100_000,
    });
  });

  it("createResponsiveSearchAd pads to >=3 headlines and >=2 descriptions", async () => {
    const c = mockCustomer();
    c.adGroupAds.create.mockResolvedValue({ results: [{ resource_name: "customers/1/adGroupAds/300~400" }] });
    const rn = await createResponsiveSearchAd(c, {
      adGroupResourceName: "customers/1/adGroups/300",
      headline: "H",
      description: "D",
      finalUrl: "https://example.com",
    });
    expect(rn).toBe("customers/1/adGroupAds/300~400");
    const arg = c.adGroupAds.create.mock.calls[0][0][0];
    expect(arg.ad.type).toBe("RESPONSIVE_SEARCH_AD");
    expect(arg.ad.final_urls).toEqual(["https://example.com"]);
    expect(arg.ad.responsive_search_ad.headlines).toHaveLength(3);
    expect(arg.ad.responsive_search_ad.descriptions).toHaveLength(2);
  });

  it("updateCampaignStatus sends resource_name + status", async () => {
    const c = mockCustomer();
    c.campaigns.update.mockResolvedValue({});
    await updateCampaignStatus(c, "1", "200", "ENABLED");
    const arg = c.campaigns.update.mock.calls[0][0][0];
    expect(arg).toEqual({ resource_name: "customers/1/campaigns/200", status: "ENABLED" });
  });

  it("updateCampaignBudgetAmount updates amount_micros", async () => {
    const c = mockCustomer();
    c.campaignBudgets.update.mockResolvedValue({});
    await updateCampaignBudgetAmount(c, "customers/1/campaignBudgets/100", 20_000_000);
    const arg = c.campaignBudgets.update.mock.calls[0][0][0];
    expect(arg).toEqual({ resource_name: "customers/1/campaignBudgets/100", amount_micros: 20_000_000 });
  });

  it("queryCampaignBudgetResourceName returns the budget resource name", async () => {
    const c = mockCustomer();
    c.query.mockResolvedValue([{ campaign: { campaign_budget: "customers/1/campaignBudgets/100" } }]);
    const rn = await queryCampaignBudgetResourceName(c, "200");
    expect(rn).toBe("customers/1/campaignBudgets/100");
    expect(c.query.mock.calls[0][0]).toContain("campaign.campaign_budget");
  });
});

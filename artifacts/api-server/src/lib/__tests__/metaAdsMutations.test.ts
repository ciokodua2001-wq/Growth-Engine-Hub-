import { describe, it, expect, vi, afterEach } from "vitest";
import {
  dollarsToCents,
  createMetaCampaign,
  createMetaAdSet,
  createMetaLinkAd,
  updateMetaCampaignStatus,
  updateMetaAdSetBudget,
  queryMetaAdSetId,
} from "../metaAdsMutations.js";

const META_GRAPH = "https://graph.facebook.com/v20.0";

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init ?? {});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "application/json" },
  });
}

describe("metaAdsMutations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dollarsToCents converts correctly", () => {
    expect(dollarsToCents(10)).toBe(1000);
    expect(dollarsToCents(0.5)).toBe(50);
  });

  it("createMetaCampaign posts name/objective/status and returns id", async () => {
    const fetchMock = mockFetch(async (url) => {
      expect(url).toBe(`${META_GRAPH}/act_123/campaigns`);
      return jsonResponse({ id: "111" });
    });
    const id = await createMetaCampaign("tok", "act_123", { name: "C", status: "PAUSED" });
    expect(id).toBe("111");
    const body = fetchMock.mock.calls[0]![1]!.body as string;
    expect(body).toContain("name=C");
    expect(body).toContain("objective=OUTCOME_TRAFFIC");
    expect(body).toContain("status=PAUSED");
    expect(body).toContain("access_token=tok");
  });

  it("createMetaAdSet posts campaign_id, budget and targeting", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ id: "222" }));
    const id = await createMetaAdSet("tok", "act_123", {
      name: "AS", campaignId: "111", dailyBudgetCents: 1000,
    });
    expect(id).toBe("222");
    const body = fetchMock.mock.calls[0]![1]!.body as string;
    expect(body).toContain("campaign_id=111");
    expect(body).toContain("daily_budget=1000");
    expect(body).toContain("optimization_goal=LINK_CLICKS");
    expect(body).toContain("geo_locations");
  });

  it("createMetaLinkAd posts page_id + link_data creative", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ id: "333" }));
    const id = await createMetaLinkAd("tok", "act_123", {
      name: "Ad", adSetId: "222", pageId: "page_9",
      headline: "H", description: "D", finalUrl: "https://example.com",
    });
    expect(id).toBe("333");
    const body = fetchMock.mock.calls[0]![1]!.body as string;
    expect(body).toContain("adset_id=222");
    expect(body).toContain("page_9");
    expect(body).toContain("LEARN_MORE");
    expect(body).toContain("https%3A%2F%2Fexample.com");
  });

  it("updateMetaCampaignStatus posts status", async () => {
    const fetchMock = mockFetch(async (url) => {
      expect(url).toBe(`${META_GRAPH}/111`);
      return jsonResponse({ success: true });
    });
    await updateMetaCampaignStatus("tok", "111", "ACTIVE");
    const body = fetchMock.mock.calls[0]![1]!.body as string;
    expect(body).toContain("status=ACTIVE");
  });

  it("updateMetaAdSetBudget posts daily_budget", async () => {
    const fetchMock = mockFetch(async (url) => {
      expect(url).toBe(`${META_GRAPH}/222`);
      return jsonResponse({ success: true });
    });
    await updateMetaAdSetBudget("tok", "222", 2500);
    const body = fetchMock.mock.calls[0]![1]!.body as string;
    expect(body).toContain("daily_budget=2500");
  });

  it("queryMetaAdSetId returns first adset id", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ data: [{ id: "222" }] }));
    const id = await queryMetaAdSetId("tok", "111");
    expect(id).toBe("222");
    expect(fetchMock.mock.calls[0]![0]).toContain("/111/adsets");
  });

  it("createMetaCampaign surfaces Meta error message", async () => {
    mockFetch(async () => jsonResponse({ error: { message: "Bad objective" } }, false));
    await expect(createMetaCampaign("tok", "act_123", { name: "C" }))
      .rejects.toThrow("Bad objective");
  });
});

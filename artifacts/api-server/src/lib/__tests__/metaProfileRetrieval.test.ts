import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  metaConnectionsTable: {},
  businessSourcesTable: {},
}));

import { formatFacebookSource, formatInstagramSource } from "../metaProfileRetrieval.js";

describe("metaProfileRetrieval formatting", () => {
  it("formats a Facebook Page profile with provenance labels and no invented fields", () => {
    const { text } = formatFacebookSource(
      {
        id: "123",
        name: "Adanma Styles",
        category: "Women's clothing store",
        about: "Lagos fashion brand",
        fan_count: 4200,
      },
      [{ id: "p1", message: "New Ankara drop is live!", created_time: "2026-10-01" }],
    );

    expect(text).toContain("[Retrieved via Meta Graph API - Facebook Page]");
    expect(text).toContain("Name: Adanma Styles");
    expect(text).toContain("Category: Women's clothing store");
    expect(text).toContain("About: Lagos fashion brand");
    expect(text).toContain("Page followers (as reported by Meta): 4200");
    expect(text).toContain("New Ankara drop is live!");
  });

  it("formats an Instagram profile with provenance labels and no invented fields", () => {
    const { text } = formatInstagramSource(
      {
        id: "ig1",
        username: "adanma.styles",
        name: "Adanma Styles",
        biography: "Ankara & lace * Lagos * DM to order",
        media_count: 180,
        followers_count: 5200,
      },
      [{ id: "m1", caption: "Bridal gele tutorial ✨", media_type: "VIDEO" }],
    );

    expect(text).toContain("[Retrieved via Meta Graph API - Instagram]");
    expect(text).toContain("Handle: @adanma.styles");
    expect(text).toContain("Bio: Ankara & lace * Lagos * DM to order");
    expect(text).toContain("Followers (as reported by Meta): 5200");
    expect(text).toContain("Media count (as reported by Meta): 180");
    expect(text).toContain("Bridal gele tutorial ✨");
  });

  it("omits follower counts when Meta did not return them (no fabrication)", () => {
    const { text } = formatInstagramSource(
      { id: "ig2", username: "small.biz", name: "Small Biz", biography: "A small shop" },
      [],
    );

    expect(text).not.toContain("Followers");
    expect(text).not.toContain("Media count");
    expect(text).toContain("Handle: @small.biz");
  });
});

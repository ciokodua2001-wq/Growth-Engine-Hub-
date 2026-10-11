import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../websiteFetcher.js", () => ({
  fetchWebsiteContent: vi.fn(),
  WebsiteFetchError: class WebsiteFetchError extends Error {},
}));

import { fetchWebsiteContent } from "../websiteFetcher.js";
import {
  ingestSource,
  buildGroundingText,
  isSufficientGrounding,
} from "../businessSourceIngestor.js";

const mockedFetch = vi.mocked(fetchWebsiteContent);

describe("businessSourceIngestor", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("ingests a manual/social source using only declared content (no retrieval)", async () => {
    const source = await ingestSource({
      sourceType: "instagram",
      sourceUrl: "instagram.com/jollof_kitchen",
      declaredContent: "Lagos-based jollof and small chops caterer.",
    });

    expect(source.retrievalMethod).toBe("none");
    expect(source.retrievedContent).toBeNull();
    expect(source.retrievedAt).toBeNull();
    expect(source.text).toBe("Lagos-based jollof and small chops caterer.");
    expect(source.declaredContent).toBe("Lagos-based jollof and small chops caterer.");
  });

  it("ingests a website source by reusing the website fetcher", async () => {
    mockedFetch.mockResolvedValue({
      url: "https://shop.example",
      title: "Example Shop",
      metaDescription: "Quality goods",
      text: "We sell quality goods for every home.",
    });

    const source = await ingestSource({
      sourceType: "website",
      websiteUrl: "https://shop.example",
    });

    expect(mockedFetch).toHaveBeenCalledWith("https://shop.example");
    expect(source.retrievalMethod).toBe("http_fetch");
    expect(source.retrievedContent).toBe("We sell quality goods for every home.");
    expect(source.text).toBe("We sell quality goods for every home.");
  });

  it("falls back to declared content when website fetch fails (never invents)", async () => {
    mockedFetch.mockRejectedValue(new Error("connection refused"));

    const source = await ingestSource({
      sourceType: "website",
      websiteUrl: "https://down.example",
      declaredContent: "Manual description of the business.",
    });

    expect(source.retrievalMethod).toBe("none");
    expect(source.retrievedContent).toBeNull();
    expect(source.text).toBe("Manual description of the business.");
  });

  it("buildGroundingText merges multiple sources and drops empty ones", () => {
    const merged = buildGroundingText([
      {
        sourceType: "instagram",
        sourceUrl: "instagram.com/a",
        declaredContent: "First source content.",
        retrievedContent: null,
        retrievalMethod: "none",
        retrievedAt: null,
        title: null,
        metaDescription: null,
        text: "First source content.",
      },
      {
        sourceType: "manual",
        sourceUrl: null,
        declaredContent: "",
        retrievedContent: null,
        retrievalMethod: "none",
        retrievedAt: null,
        title: null,
        metaDescription: null,
        text: "",
      },
      {
        sourceType: "website",
        sourceUrl: "https://shop.example",
        declaredContent: null,
        retrievedContent: "Website body text.",
        retrievalMethod: "http_fetch",
        retrievedAt: new Date(),
        title: "Example Shop",
        metaDescription: "Meta desc",
        text: "Website body text.",
      },
    ]);

    expect(merged.title).toBe("Example Shop");
    expect(merged.metaDescription).toBe("Meta desc");
    expect(merged.text).toContain("First source content.");
    expect(merged.text).toContain("Website body text.");
  });

  it("isSufficientGrounding enforces a minimum content length", () => {
    expect(isSufficientGrounding("short")).toBe(false);
    expect(isSufficientGrounding("A sufficiently long business description goes here.")).toBe(true);
  });
});

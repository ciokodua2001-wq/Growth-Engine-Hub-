import { describe, it, expect } from "vitest";
import { detectCrossBusinessMismatch } from "../sourceIdentityGuard.js";
import type { RetrievedSource } from "../businessSourceIngestor.js";

function source(partial: Partial<RetrievedSource> & { sourceType: string; text: string }): RetrievedSource {
  return {
    sourceUrl: null,
    declaredContent: null,
    retrievedContent: null,
    retrievalMethod: "none",
    retrievedAt: null,
    title: null,
    metaDescription: null,
    ...partial,
  };
}

const INSURANCE_FB = source({
  sourceType: "facebook",
  sourceUrl: "https://www.facebook.com/1236823922842171",
  title: "Alberta & BC Property Insurance",
  text: "[Retrieved via Meta Graph API - Facebook Page]\nName: Alberta & BC Property Insurance\nCategory: Insurance Broker\nAbout: Property insurance made simple for Alberta & BC. Get your free quote at getinsuredab.ca & homequotebc.ca",
});

const INSURANCE_WEBSITE = source({
  sourceType: "website",
  sourceUrl: "https://getinsuredab.ca",
  title: "Get Insured AB",
  text: "Property insurance brokerage serving Alberta and British Columbia. Free online insurance quotes for homeowners and landlords.",
});

const MUSIC_PROFILE = source({
  sourceType: "facebook",
  sourceUrl: "https://www.facebook.com/profile.php?id=61576065945040",
  title: "Imolife Okos",
  text: "Imolife Okos. 780 followers. Imolife is a Canadian-Nigerian singer and songwriter.",
});

describe("detectCrossBusinessMismatch", () => {
  it("does not flag a single source (social-only or website-only)", () => {
    expect(detectCrossBusinessMismatch([INSURANCE_FB]).requiresConfirmation).toBe(false);
    expect(detectCrossBusinessMismatch([INSURANCE_WEBSITE]).requiresConfirmation).toBe(false);
    expect(detectCrossBusinessMismatch([]).requiresConfirmation).toBe(false);
  });

  it("does not flag a genuine hybrid (website + social, same business)", () => {
    const r = detectCrossBusinessMismatch([INSURANCE_WEBSITE, INSURANCE_FB], { sourceType: "website", websiteUrl: "https://getinsuredab.ca" });
    expect(r.requiresConfirmation).toBe(false);
    expect(r.warnings).toHaveLength(0);
  });

  it("does not flag same-business different brand names across platforms", () => {
    // getinsuredab.ca (website) vs "Alberta & BC Property Insurance" (Page) share
    // no literal brand token, but both are insurance — must NOT be flagged.
    const r = detectCrossBusinessMismatch([INSURANCE_WEBSITE, INSURANCE_FB], { sourceType: "website", websiteUrl: "https://getinsuredab.ca" });
    expect(r.requiresConfirmation).toBe(false);
  });

  it("flags cross-business contamination (music profile mixed with insurance business)", () => {
    const r = detectCrossBusinessMismatch([INSURANCE_FB, MUSIC_PROFILE], { sourceType: "website", websiteUrl: "https://getinsuredab.ca" });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/different businesses/i);
  });

  it("flags a personal Facebook profile URL configured as the website source", () => {
    const r = detectCrossBusinessMismatch([INSURANCE_FB], {
      sourceType: "website",
      websiteUrl: "https://www.facebook.com/profile.php?id=61576065945040",
    });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/personal Facebook profile/i);
  });

  it("does not silently discard sources — it only reports", () => {
    const r = detectCrossBusinessMismatch([INSURANCE_FB, MUSIC_PROFILE], {});
    // The safeguard reports but returns no mutation of the source list.
    expect(r.details.length).toBeGreaterThan(0);
    expect(r.requiresConfirmation).toBe(true);
  });
});

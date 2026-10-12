import { describe, it, expect } from "vitest";
import { getLocaleProfile, getSupportedLocales, injectCulturalNuance } from "../localization.js";
import { detectLocaleFromUrl, mapToSupportedLocale } from "../../utils/urlLocaleDetector.js";

describe("Nigeria localization (en-NG)", () => {
  it("registers en-NG as a supported locale with a profile", () => {
    expect(getSupportedLocales()).toContain("en-NG");
    const profile = getLocaleProfile("en-NG");
    expect(profile).not.toBeNull();
    expect(profile!.language_name).toBe("English (Nigeria)");
  });

  it("formats currency as NGN and time as Africa/Lagos", () => {
    const profile = getLocaleProfile("en-NG")!;
    expect(profile.formatting.currency).toContain("NGN");
    expect(profile.formatting.currency).toContain("₦");
    expect(profile.formatting.time_format).toContain("Africa/Lagos");
  });

  it("routes en-NG through the English-aware directive block (no translation rules)", () => {
    const profile = getLocaleProfile("en-NG")!;
    const out = injectCulturalNuance("BASE.", profile, "en-NG");
    expect(out).toContain("English (Nigeria)");
    expect(out).toContain("Nigerian Naira");
    // The translation-only rule ("zero English words") must NOT apply to English locales.
    expect(out).not.toContain("Zero English words");
  });

  it("detects the .ng ccTLD as en-NG without a network fetch", async () => {
    const result = await detectLocaleFromUrl("https://shop.ng");
    expect(result.locale).toBe("en-NG");
    expect(result.confidence).toBe("tld");
    expect(mapToSupportedLocale(result, ["en-NG", "es-MX"])).toBe("en-NG");
  });
});

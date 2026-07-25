/**
 * POST /api/analyze-website
 *
 * Lightweight market-detection endpoint. Takes a URL, runs the two-pass
 * locale detector (TLD → HTML fetch), and returns a structured market
 * suggestion the frontend can show as a pre-filled confirmation card.
 *
 * Requires Clerk auth — called from onboarding (user is already signed in).
 * Never throws: detector errors surface as confidence:"default" in the payload.
 */

import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod/v4";
import { detectLocaleFromUrl, mapToSupportedLocale } from "../utils/urlLocaleDetector.js";
import { getSupportedLocales, getLocaleProfile } from "../lib/localization.js";

// ── Market display metadata ────────────────────────────────────────────────────
// Used to enrich the raw detection result with human-readable display names
// and flag emoji before sending to the frontend.

interface MarketDisplay {
  marketName: string;
  languageName: string;
  flag: string;
}

const MARKET_DISPLAY: Record<string, MarketDisplay> = {
  // Currently supported profile locales
  "es-MX": { marketName: "Mexico",        languageName: "Spanish",    flag: "🇲🇽" },
  "de-DE": { marketName: "Germany",       languageName: "German",     flag: "🇩🇪" },
  "fr-FR": { marketName: "France",        languageName: "French",     flag: "🇫🇷" },
  "pt-BR": { marketName: "Brazil",        languageName: "Portuguese", flag: "🇧🇷" },
  // Extended — no profile yet, but detector can return these
  "en-US": { marketName: "United States", languageName: "English",    flag: "🇺🇸" },
  "en-GB": { marketName: "United Kingdom",languageName: "English",    flag: "🇬🇧" },
  "en-AU": { marketName: "Australia",     languageName: "English",    flag: "🇦🇺" },
  "en-CA": { marketName: "Canada",        languageName: "English",    flag: "🇨🇦" },
  "en-IE": { marketName: "Ireland",       languageName: "English",    flag: "🇮🇪" },
  "en-NZ": { marketName: "New Zealand",   languageName: "English",    flag: "🇳🇿" },
  "en-ZA": { marketName: "South Africa",  languageName: "English",    flag: "🇿🇦" },
  "en-IN": { marketName: "India",         languageName: "English",    flag: "🇮🇳" },
  "es-ES": { marketName: "Spain",         languageName: "Spanish",    flag: "🇪🇸" },
  "es-AR": { marketName: "Argentina",     languageName: "Spanish",    flag: "🇦🇷" },
  "es-CL": { marketName: "Chile",         languageName: "Spanish",    flag: "🇨🇱" },
  "es-CO": { marketName: "Colombia",      languageName: "Spanish",    flag: "🇨🇴" },
  "es-PE": { marketName: "Peru",          languageName: "Spanish",    flag: "🇵🇪" },
  "pt-PT": { marketName: "Portugal",      languageName: "Portuguese", flag: "🇵🇹" },
  "de-AT": { marketName: "Austria",       languageName: "German",     flag: "🇦🇹" },
  "de-CH": { marketName: "Switzerland",   languageName: "German",     flag: "🇨🇭" },
  "it-IT": { marketName: "Italy",         languageName: "Italian",    flag: "🇮🇹" },
  "nl-NL": { marketName: "Netherlands",   languageName: "Dutch",      flag: "🇳🇱" },
  "nl-BE": { marketName: "Belgium",       languageName: "Dutch",      flag: "🇧🇪" },
  "pl-PL": { marketName: "Poland",        languageName: "Polish",     flag: "🇵🇱" },
  "ru-RU": { marketName: "Russia",        languageName: "Russian",    flag: "🇷🇺" },
  "uk-UA": { marketName: "Ukraine",       languageName: "Ukrainian",  flag: "🇺🇦" },
  "sv-SE": { marketName: "Sweden",        languageName: "Swedish",    flag: "🇸🇪" },
  "nb-NO": { marketName: "Norway",        languageName: "Norwegian",  flag: "🇳🇴" },
  "da-DK": { marketName: "Denmark",       languageName: "Danish",     flag: "🇩🇰" },
  "fi-FI": { marketName: "Finland",       languageName: "Finnish",    flag: "🇫🇮" },
  "cs-CZ": { marketName: "Czech Republic",languageName: "Czech",      flag: "🇨🇿" },
  "hu-HU": { marketName: "Hungary",       languageName: "Hungarian",  flag: "🇭🇺" },
  "ro-RO": { marketName: "Romania",       languageName: "Romanian",   flag: "🇷🇴" },
  "tr-TR": { marketName: "Turkey",        languageName: "Turkish",    flag: "🇹🇷" },
  "ja-JP": { marketName: "Japan",         languageName: "Japanese",   flag: "🇯🇵" },
  "zh-CN": { marketName: "China",         languageName: "Chinese",    flag: "🇨🇳" },
  "zh-TW": { marketName: "Taiwan",        languageName: "Chinese",    flag: "🇹🇼" },
  "ko-KR": { marketName: "South Korea",   languageName: "Korean",     flag: "🇰🇷" },
  "hi-IN": { marketName: "India",         languageName: "Hindi",      flag: "🇮🇳" },
  "ar-SA": { marketName: "Saudi Arabia",  languageName: "Arabic",     flag: "🇸🇦" },
  "ar-AE": { marketName: "UAE",           languageName: "Arabic",     flag: "🇦🇪" },
  "he-IL": { marketName: "Israel",        languageName: "Hebrew",     flag: "🇮🇱" },
  "id-ID": { marketName: "Indonesia",     languageName: "Indonesian", flag: "🇮🇩" },
  "vi-VN": { marketName: "Vietnam",       languageName: "Vietnamese", flag: "🇻🇳" },
  "th-TH": { marketName: "Thailand",      languageName: "Thai",       flag: "🇹🇭" },
};

function getMarketDisplay(locale: string): MarketDisplay {
  if (MARKET_DISPLAY[locale]) return MARKET_DISPLAY[locale];
  // Fallback: parse locale code to build a generic display
  const [lang, country] = locale.split("-");
  return {
    marketName: country ?? lang.toUpperCase(),
    languageName: lang.toUpperCase(),
    flag: "🌐",
  };
}

// ── Request schema ─────────────────────────────────────────────────────────────

const AnalyzeWebsiteBody = z.object({
  url: z.string().min(3, "URL is required"),
});

// ── Route ──────────────────────────────────────────────────────────────────────

const router: IRouter = Router();

router.post("/analyze-website", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = AnalyzeWebsiteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    const { url } = parsed.data;

    // ── Run the two-pass detector ──────────────────────────────────────────────
    const detected = await detectLocaleFromUrl(url);

    req.log.info(
      { url, locale: detected.locale, confidence: detected.confidence, source: detected.source },
      "analyze-website detection result",
    );

    // ── Map to nearest supported profile ──────────────────────────────────────
    const supported = getSupportedLocales();
    const mappedLocale = mapToSupportedLocale(detected, supported);

    // The "effective" locale: mappedLocale if supported, else the raw detected
    // locale (for display purposes — the UI shows what was detected even if no
    // profile exists, and lets the user pick a supported one).
    const displayLocale = mappedLocale ?? detected.locale;
    const marketDisplay = getMarketDisplay(displayLocale);

    // ── Build the supported-locales list for the "Change" dropdown ─────────────
    const supportedMarketsMenu = supported.map(localeCode => {
      const profile = getLocaleProfile(localeCode);
      const display = getMarketDisplay(localeCode);
      return {
        locale: localeCode,
        marketName: display.marketName,
        languageName: profile?.language_name ?? display.languageName,
        flag: display.flag,
      };
    });

    res.json({
      url,
      detected: {
        language: detected.language,
        country: detected.country,
        locale: detected.locale,
        confidence: detected.confidence,
        source: detected.source,
      },
      suggestion: {
        /** Locale code that maps to a GrowthForge profile (null = English/global) */
        locale: mappedLocale,
        marketName: marketDisplay.marketName,
        languageName: marketDisplay.languageName,
        flag: marketDisplay.flag,
        /** Whether we have a full AI profile for this market */
        isSupported: mappedLocale !== null,
        /** True when detection fell back to en-US (no signal found) */
        isDefault: detected.confidence === "default",
      },
      /** All available locale profiles — powers the "Choose different market" dropdown */
      supportedMarkets: supportedMarketsMenu,
    });
  } catch (err) {
    req.log.error({ err }, "analyze-website error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

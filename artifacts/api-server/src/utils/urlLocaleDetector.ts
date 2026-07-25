/**
 * urlLocaleDetector.ts
 *
 * Automatically infers a user's target market from their website URL using a
 * two-pass strategy:
 *
 * PASS 1 — TLD inspection (instant, zero network cost)
 *   Country-code TLDs (.de, .mx, .br …) resolve immediately to a locale.
 *
 * PASS 2 — Lightweight HTML fetch (generic TLDs only: .com, .net, .org …)
 *   Fetches only the first 50 KB of the homepage with a 5-second timeout.
 *   Reads, in priority order:
 *     1. <meta property="og:locale" content="...">
 *     2. <html lang="...">
 *   Both the underscore form (og:locale: "es_MX") and hyphen form ("es-MX")
 *   are normalised before returning.
 *
 * Always returns a UrlLocaleResult — never throws. If every signal fails or
 * the site blocks the request, falls back to { language: 'en', country: 'US' }.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000;
/** Cap HTML reads at 50 KB — we only need the <head> section. */
const MAX_HTML_BYTES = 50_000;

// ── Types ──────────────────────────────────────────────────────────────────────

export type LocaleConfidence =
  | "tld"             // Resolved from a ccTLD in the URL (highest)
  | "og-locale"       // Resolved from <meta property="og:locale">
  | "html-lang"       // Resolved from <html lang="…">
  | "default";        // All signals failed — fell back to en-US

export interface UrlLocaleResult {
  /** ISO 639-1 language code, lowercase. e.g. "es" */
  language: string;
  /** ISO 3166-1 alpha-2 country code, uppercase. e.g. "MX" */
  country: string;
  /** BCP-47 locale tag, e.g. "es-MX". Use this to index localizationProfiles. */
  locale: string;
  /** How certain the detection is. */
  confidence: LocaleConfidence;
  /** Human-readable description of the winning signal — useful for logging. */
  source: string;
}

const DEFAULT_RESULT: UrlLocaleResult = {
  language: "en",
  country: "US",
  locale: "en-US",
  confidence: "default",
  source: "All detection signals failed — defaulting to en-US",
};

// ── ccTLD → locale map ─────────────────────────────────────────────────────────
//
// Covers the major country-code TLDs. Deliberately omits ambiguous TLDs like
// .co (used globally) and .io (tech/global). Ordered for readability, not lookup
// speed (object key lookup is O(1)).

const TLD_TO_LOCALE: Record<string, { language: string; country: string }> = {
  // Spanish-speaking Latin America
  mx: { language: "es", country: "MX" },
  ar: { language: "es", country: "AR" },
  cl: { language: "es", country: "CL" },
  pe: { language: "es", country: "PE" },
  ve: { language: "ve", country: "VE" },
  ec: { language: "es", country: "EC" },
  uy: { language: "es", country: "UY" },
  py: { language: "es", country: "PY" },
  bo: { language: "es", country: "BO" },
  // Spanish — Europe
  es: { language: "es", country: "ES" },
  // Portuguese
  br: { language: "pt", country: "BR" },
  pt: { language: "pt", country: "PT" },
  // German
  de: { language: "de", country: "DE" },
  at: { language: "de", country: "AT" },
  // French
  fr: { language: "fr", country: "FR" },
  // Italian
  it: { language: "it", country: "IT" },
  // Dutch / Flemish
  nl: { language: "nl", country: "NL" },
  be: { language: "nl", country: "BE" },
  // Nordic
  se: { language: "sv", country: "SE" },
  no: { language: "nb", country: "NO" },
  dk: { language: "da", country: "DK" },
  fi: { language: "fi", country: "FI" },
  // Eastern Europe
  pl: { language: "pl", country: "PL" },
  ru: { language: "ru", country: "RU" },
  ua: { language: "uk", country: "UA" },
  cz: { language: "cs", country: "CZ" },
  sk: { language: "sk", country: "SK" },
  hu: { language: "hu", country: "HU" },
  ro: { language: "ro", country: "RO" },
  // Asia-Pacific
  jp: { language: "ja", country: "JP" },
  cn: { language: "zh", country: "CN" },
  kr: { language: "ko", country: "KR" },
  tw: { language: "zh", country: "TW" },
  hk: { language: "zh", country: "HK" },
  in: { language: "hi", country: "IN" },
  id: { language: "id", country: "ID" },
  th: { language: "th", country: "TH" },
  vn: { language: "vi", country: "VN" },
  // Middle East
  sa: { language: "ar", country: "SA" },
  ae: { language: "ar", country: "AE" },
  eg: { language: "ar", country: "EG" },
  il: { language: "he", country: "IL" },
  tr: { language: "tr", country: "TR" },
  // English-speaking — explicit ccTLDs (not inferred)
  uk: { language: "en", country: "GB" },
  au: { language: "en", country: "AU" },
  nz: { language: "en", country: "NZ" },
  ca: { language: "en", country: "CA" },
  ie: { language: "en", country: "IE" },
  za: { language: "en", country: "ZA" },
  // Switzerland / multilingual — German majority web presence
  ch: { language: "de", country: "CH" },
};

/**
 * TLDs that are generic / global and require an HTML fetch to determine locale.
 * We also fall through to fetch for any TLD not found in TLD_TO_LOCALE.
 */
const GENERIC_TLDS = new Set([
  "com", "net", "org", "io", "co", "app", "ai", "dev",
  "info", "biz", "online", "site", "web", "store", "shop",
]);

// ── HTML parsing helpers ───────────────────────────────────────────────────────

/**
 * Extracts the value of <html lang="..."> from raw HTML.
 * Handles single-quotes, double-quotes, and no quotes (rare but valid).
 */
function extractHtmlLang(html: string): string | null {
  const match = html.match(/<html[^>]+\blang=["']?([a-zA-Z]{2,8}(?:[-_][a-zA-Z]{2,8})*)["']?/i);
  return match?.[1]?.trim() ?? null;
}

/**
 * Extracts the value of <meta property="og:locale" content="..."> or the
 * reversed-attribute form <meta content="..." property="og:locale">.
 */
function extractOgLocale(html: string): string | null {
  // Standard order: property then content
  const fwd = html.match(
    /<meta[^>]+property=["']og:locale["'][^>]+content=["']([^"']+)["']/i,
  );
  if (fwd?.[1]) return fwd[1].trim();

  // Reversed order: content then property
  const rev = html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:locale["']/i,
  );
  return rev?.[1]?.trim() ?? null;
}

// ── Locale tag normaliser ──────────────────────────────────────────────────────

/**
 * Accepts locale strings in any of these formats and returns { language, country }:
 *   "es_MX"  "es-MX"  "es-mx"  "es"  "de"
 *
 * Returns null if the string cannot be parsed into at least a language code.
 */
function parseLocaleTag(raw: string): { language: string; country: string } | null {
  if (!raw) return null;

  // Normalise separators: og:locale uses underscores, HTML lang uses hyphens
  const normalised = raw.trim().replace(/_/g, "-");

  // Must start with a 2-3 char language code
  const langMatch = normalised.match(/^([a-zA-Z]{2,3})(?:-([a-zA-Z]{2,4}))?/);
  if (!langMatch) return null;

  const language = langMatch[1].toLowerCase();
  // Country code: use the explicit subtag if present, otherwise infer from language
  const country = langMatch[2]
    ? langMatch[2].toUpperCase()
    : inferCountryFromLanguage(language);

  return { language, country };
}

/**
 * Best-effort country inference when only a bare language code is available
 * (e.g. <html lang="de"> with no region subtag).
 * Returns the most common country for that language online.
 */
function inferCountryFromLanguage(language: string): string {
  const map: Record<string, string> = {
    de: "DE", fr: "FR", es: "ES", pt: "BR", it: "IT",
    nl: "NL", pl: "PL", ru: "RU", ja: "JP", zh: "CN",
    ko: "KR", ar: "SA", sv: "SE", nb: "NO", da: "DK",
    fi: "FI", tr: "TR", he: "IL", cs: "CZ", hu: "HU",
    ro: "RO", uk: "UA", vi: "VN", th: "TH", id: "ID",
    hi: "IN", en: "US",
  };
  return map[language] ?? language.toUpperCase();
}

// ── TLD extraction ─────────────────────────────────────────────────────────────

/**
 * Extracts the effective TLD from a URL, handling second-level TLDs like
 * .co.uk, .com.br, .com.mx, .com.au, etc.
 *
 * Returns the TLD string in lowercase (e.g. "de", "co.uk", "com").
 */
function extractTld(rawUrl: string): string {
  try {
    const url = new URL(
      rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`,
    );
    const hostname = url.hostname.replace(/^www\./, "");
    const parts = hostname.split(".");

    if (parts.length < 2) return "";

    // Detect compound TLDs: co.uk, com.br, com.mx, com.au, com.ar, net.au …
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    const compoundSecond = ["co", "com", "net", "org", "gov", "edu", "ac"];

    if (compoundSecond.includes(secondLast) && last.length === 2) {
      // e.g. "co.uk" → country = "uk"; "com.br" → country = "br"
      return `${secondLast}.${last}`;
    }

    return last;
  } catch {
    return "";
  }
}

/**
 * Given a TLD string (possibly compound like "co.uk"), returns the ccTLD key
 * to look up in TLD_TO_LOCALE. Returns null for generic or unrecognised TLDs.
 */
function resolveCcTld(tld: string): string | null {
  // Compound ccTLD: take the last segment (the actual country code)
  const parts = tld.split(".");
  const cc = parts[parts.length - 1];

  // If the whole tld is a generic, bail
  if (GENERIC_TLDS.has(tld) || GENERIC_TLDS.has(cc)) return null;

  // The cc part must be exactly 2 chars for a real ccTLD
  if (cc.length !== 2) return null;

  return cc;
}

// ── HTML fetch ─────────────────────────────────────────────────────────────────

/**
 * Fetches only the first MAX_HTML_BYTES of a URL's homepage with a hard
 * timeout. Returns null on any error — callers must handle null gracefully.
 */
async function fetchHeadHtml(rawUrl: string): Promise<string | null> {
  try {
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          // Present as a browser so sites don't return 403
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          // Explicitly request no transformation — we want the raw HTML, not
          // a translated version the CDN might serve based on our own locale.
          "Accept-Language": "*",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return null;

    const ct = response.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;

    // Read only the first MAX_HTML_BYTES — the <head> is always in this range
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer.slice(0, MAX_HTML_BYTES)).toString("utf-8");
  } catch {
    // AbortError (timeout), network error, DNS failure, TLS error — all handled
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Detects the locale implied by a website URL using a two-pass heuristic.
 *
 * Never throws. Falls back to { language: 'en', country: 'US', locale: 'en-US' }
 * when every signal fails or the site blocks the request.
 *
 * @example
 * await detectLocaleFromUrl("https://example.de")
 * // → { language: 'de', country: 'DE', locale: 'de-DE', confidence: 'tld', source: '...' }
 *
 * await detectLocaleFromUrl("https://acme.com")
 * // → { language: 'es', country: 'MX', locale: 'es-MX', confidence: 'og-locale', source: '...' }
 * // (if <meta property="og:locale" content="es_MX"> is found on the homepage)
 */
export async function detectLocaleFromUrl(
  rawUrl: string,
): Promise<UrlLocaleResult> {
  try {
    // ── Pass 1: TLD inspection ───────────────────────────────────────────────
    const tld = extractTld(rawUrl);
    const cc = tld ? resolveCcTld(tld) : null;

    if (cc && TLD_TO_LOCALE[cc]) {
      const { language, country } = TLD_TO_LOCALE[cc];
      return {
        language,
        country,
        locale: `${language}-${country}`,
        confidence: "tld",
        source: `ccTLD .${tld} maps to ${language}-${country}`,
      };
    }

    // ── Pass 2: HTML fetch (generic TLD or unrecognised ccTLD) ───────────────
    const html = await fetchHeadHtml(rawUrl);

    if (html) {
      // Priority 2a: og:locale is the most explicit localisation signal authors set
      const ogLocale = extractOgLocale(html);
      if (ogLocale) {
        const parsed = parseLocaleTag(ogLocale);
        if (parsed) {
          return {
            ...parsed,
            locale: `${parsed.language}-${parsed.country}`,
            confidence: "og-locale",
            source: `og:locale meta tag value "${ogLocale}"`,
          };
        }
      }

      // Priority 2b: <html lang="..."> — widely used, slightly less specific
      const htmlLang = extractHtmlLang(html);
      if (htmlLang) {
        const parsed = parseLocaleTag(htmlLang);
        if (parsed) {
          return {
            ...parsed,
            locale: `${parsed.language}-${parsed.country}`,
            confidence: "html-lang",
            source: `<html lang="${htmlLang}"> attribute`,
          };
        }
      }
    }

    // ── All signals exhausted — return safe default ──────────────────────────
    return { ...DEFAULT_RESULT };
  } catch {
    // Belt-and-suspenders: catch any unexpected error in the outer try block
    return { ...DEFAULT_RESULT };
  }
}

/**
 * Maps a detected UrlLocaleResult to the nearest supported GrowthForge locale
 * profile code. Returns null when no profile is available for the detected market
 * (e.g. Japanese), indicating the caller should fall back to English generation.
 *
 * Matching priority:
 *   1. Exact locale match (e.g. "es-MX" → "es-MX")
 *   2. Language-only match (e.g. "es-AR" → first "es-*" profile found)
 *
 * @param result  Output of detectLocaleFromUrl()
 * @param supportedLocales  Array from getSupportedLocales() in localization.ts
 */
export function mapToSupportedLocale(
  result: UrlLocaleResult,
  supportedLocales: string[],
): string | null {
  // 1. Exact match
  if (supportedLocales.includes(result.locale)) return result.locale;

  // 2. Language-only match (use the first profile for that language)
  const languageMatch = supportedLocales.find(
    l => l.toLowerCase().startsWith(result.language.toLowerCase() + "-"),
  );
  return languageMatch ?? null;
}

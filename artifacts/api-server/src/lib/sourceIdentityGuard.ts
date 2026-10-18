import type { RetrievedSource } from "./businessSourceIngestor.js";

export interface SourceMismatchDetail {
  sourceType: string;
  sourceLabel: string;
  reason: string;
}

export interface CrossBusinessMismatch {
  requiresConfirmation: boolean;
  warnings: string[];
  details: SourceMismatchDetail[];
}

/**
 * Reusable safeguard that detects likely cross-business source mixing.
 *
 * It is deliberately conservative: it only raises a confirmation requirement
 * when there is a STRONG signal that two sources belong to different
 * businesses. It never relies on exact name equality (legitimate businesses
 * often use different brand names across platforms) and it never discards a
 * user-supplied source - it only reports.
 */
export interface MismatchContext {
  projectName?: string | null;
  websiteUrl?: string | null;
  sourceType?: string | null;
}

// Coarse industry buckets. A source whose text is dominated by one of these
// keywords clearly belongs to that line of business. This is used to catch a
// music-artist profile mixed in with an insurance brokerage, etc. Substring
// matching is intentional (e.g. "song" also matches "songwriter").
const INDUSTRY_BUCKETS: Array<{ key: string; keywords: string[] }> = [
  { key: "insurance", keywords: ["insurance", "insure", "broker", "brokerage", "coverage", "underwriting", "policy", "quote", "premium"] },
  { key: "music", keywords: ["music", "singer", "songwriter", "musician", "afrobeat", "afrobeats", "album", "song", "vocals", "r&b", "rnb", "artist", "lyric"] },
  { key: "legal", keywords: ["law firm", "attorney", "lawyer", "litigation", "legal service", "legal"] },
  { key: "real-estate", keywords: ["real estate", "realtor", "mortgage", "home", "property", "landlord", "tenant"] },
];

// Pairs that can never describe the same business.
const CONTRADICTS: Record<string, string[]> = {
  insurance: ["music", "legal"],
  music: ["insurance", "legal", "real-estate"],
  legal: ["insurance", "music"],
  "real-estate": ["music"],
};

function industryBucketOf(text: string): string | null {
  const lower = text.toLowerCase();
  let bestKey: string | null = null;
  let bestHits = 0;
  for (const b of INDUSTRY_BUCKETS) {
    let hits = 0;
    for (const k of b.keywords) if (lower.includes(k)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      bestKey = b.key;
    }
  }
  return bestHits > 0 ? bestKey : null;
}

function isPersonalProfileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.includes("facebook.com/profile.php") || u.includes("fb.com/profile");
}

function sourceLabel(s: RetrievedSource): string {
  return s.sourceUrl ?? s.title ?? s.sourceType;
}

export function detectCrossBusinessMismatch(
  sources: RetrievedSource[],
  context: MismatchContext = {},
): CrossBusinessMismatch {
  const warnings: string[] = [];
  const details: SourceMismatchDetail[] = [];

  // 1. Personal social profile URL being used as a website-crawl target.
  if (context.sourceType === "website" && isPersonalProfileUrl(context.websiteUrl)) {
    warnings.push("A personal Facebook profile URL is configured as the website source, but personal profiles are not crawlable business websites.");
    details.push({
      sourceType: "website",
      sourceLabel: context.websiteUrl ?? "website",
      reason: "personal Facebook profile URL is not a business website",
    });
  }

  // 2. Cross-business industry contradictions between retrieved/declared sources.
  const withText = sources.filter((s) => s.text && s.text.trim().length > 0);
  const identified = withText
    .map((s) => ({ source: s, bucket: industryBucketOf(s.text) }))
    .filter((b) => b.bucket !== null);

  for (let i = 0; i < identified.length; i++) {
    for (let j = i + 1; j < identified.length; j++) {
      const a = identified[i];
      const b = identified[j];
      if (a.bucket !== b.bucket && (CONTRADICTS[a.bucket!]?.includes(b.bucket!) ?? false)) {
        warnings.push(
          `Sources appear to belong to different businesses: "${sourceLabel(a.source)}" (${a.bucket}) vs "${sourceLabel(b.source)}" (${b.bucket}).`,
        );
        details.push({ sourceType: a.source.sourceType, sourceLabel: sourceLabel(a.source), reason: `${a.bucket} industry signal` });
        details.push({ sourceType: b.source.sourceType, sourceLabel: sourceLabel(b.source), reason: `${b.bucket} industry signal` });
      }
    }
  }

  const uniqueWarnings = [...new Set(warnings)];
  const uniqueDetails = details.filter(
    (d, idx, arr) => arr.findIndex((x) => x.sourceLabel === d.sourceLabel && x.reason === d.reason) === idx,
  );

  return {
    requiresConfirmation: uniqueWarnings.length > 0,
    warnings: uniqueWarnings,
    details: uniqueDetails,
  };
}

import { fetchWebsiteContent } from "./websiteFetcher.js";

/**
 * Future-extensible source registry. Adding a new platform is a code-only
 * change (add it here + a retriever in ingestSource) - no schema migration,
 * because business_sources.source_type is a plain text column.
 */
export const SOURCE_TYPES = [
  "website",
  "instagram",
  "facebook",
  "tiktok",
  "whatsapp",
  "youtube",
  "linkedin",
  "manual",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const MIN_GROUNDING_CHARS = 20;

export interface SourceInput {
  sourceType: SourceType;
  /** Used only for sourceType === "website". */
  websiteUrl?: string | null;
  /** Canonical URL/handle for social sources. */
  sourceUrl?: string | null;
  /** User-provided text (always allowed, never fabricated). */
  declaredContent?: string | null;
}

export interface RetrievedSource {
  sourceType: SourceType;
  sourceUrl: string | null;
  declaredContent: string | null;
  retrievedContent: string | null;
  retrievalMethod: "none" | "http_fetch" | "meta_graph_api";
  retrievedAt: Date | null;
  title: string | null;
  metaDescription: string | null;
  text: string;
}

/**
 * Ingests a single source into a normalized RetrievedSource.
 *
 * - website: reuses the existing website fetcher. On failure, falls back to
 *   declared content and marks retrievalMethod "none" (never invents content).
 * - instagram/facebook/tiktok/whatsapp/youtube/linkedin/manual: manual declared
 *   content only. Authorized API reads (e.g. Meta Graph) are intentionally NOT
 *   implemented here - they are a separate, opt-in integration. We never scrape
 *   social platforms and never claim content was retrieved when it was not.
 */
export async function ingestSource(input: SourceInput): Promise<RetrievedSource> {
  if (input.sourceType === "website" && input.websiteUrl) {
    try {
      const site = await fetchWebsiteContent(input.websiteUrl);
      return {
        sourceType: "website",
        sourceUrl: site.url,
        declaredContent: input.declaredContent ?? null,
        retrievedContent: site.text,
        retrievalMethod: "http_fetch",
        retrievedAt: new Date(),
        title: site.title,
        metaDescription: site.metaDescription,
        text: site.text,
      };
    } catch {
      return {
        sourceType: "website",
        sourceUrl: input.websiteUrl,
        declaredContent: input.declaredContent ?? null,
        retrievedContent: null,
        retrievalMethod: "none",
        retrievedAt: null,
        title: null,
        metaDescription: null,
        text: input.declaredContent ?? "",
      };
    }
  }

  // Social and manual sources: manual declared content only.
  return {
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    declaredContent: input.declaredContent ?? null,
    retrievedContent: null,
    retrievalMethod: "none",
    retrievedAt: null,
    title: null,
    metaDescription: null,
    text: input.declaredContent ?? "",
  };
}

/**
 * Merges retrieved sources into the single { title, metaDescription, text }
 * shape consumed by analyzeBusinessWithAi(), so the existing 14-field pipeline
 * is reused unchanged regardless of how many sources grounded the analysis.
 */
export function buildGroundingText(sources: RetrievedSource[]): {
  title: string | null;
  metaDescription: string | null;
  text: string;
} {
  const withText = sources.filter((s) => s.text && s.text.trim().length > 0);
  const title = withText.find((s) => s.title)?.title ?? null;
  const metaDescription = withText.find((s) => s.metaDescription)?.metaDescription ?? null;
  const text = withText.map((s) => s.text).join("\n\n").trim();
  return { title, metaDescription, text };
}

/** Blocks AI analysis when there is no usable grounding content. */
export function isSufficientGrounding(text: string): boolean {
  return text.trim().length >= MIN_GROUNDING_CHARS;
}

/**
 * Hard cap on the combined grounding text so multi-source analysis cannot blow
 * past AI token limits (and therefore cost) as sources are added.
 */
export const MAX_TOTAL_GROUNDING_CHARS = 30000;

/** Cap the merged grounding text before it reaches the AI prompt. */
export function capGroundingText(text: string): string {
  if (text.length <= MAX_TOTAL_GROUNDING_CHARS) return text;
  return text.slice(0, MAX_TOTAL_GROUNDING_CHARS) + "\n\n[content truncated at limit]";
}

/** De-duplicate sources by (sourceType, sourceUrl) preserving first occurrence. */
export function dedupeSources(sources: RetrievedSource[]): RetrievedSource[] {
  const seen = new Set<string>();
  const out: RetrievedSource[] = [];
  for (const s of sources) {
    const key = `${s.sourceType}::${s.sourceUrl ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Build a RetrievedSource from a persisted ledger row's DECLARED content only.
 * Used for secondary social/manual sources during multi-source analysis; the
 * retrieval fields remain null so provenance stays honest (nothing fabricated).
 */
export function retrievedSourceFromDeclared(
  sourceType: SourceType,
  sourceUrl: string | null,
  declaredContent: string | null,
): RetrievedSource {
  return {
    sourceType,
    sourceUrl: sourceUrl ?? null,
    declaredContent: declaredContent ?? null,
    retrievedContent: null,
    retrievalMethod: "none",
    retrievedAt: null,
    title: null,
    metaDescription: null,
    text: declaredContent ?? "",
  };
}

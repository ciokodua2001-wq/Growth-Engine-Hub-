export interface ProjectIdentityLike {
  name?: string;
  websiteUrl?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
}

/**
 * Consistent project identity for display, mirroring the backend helper:
 * website URL → social profile / creator identity → project name.
 * Never renders "null" / "undefined" / a fabricated URL.
 */
export function projectIdentityLabel(p: ProjectIdentityLike): string {
  if (p.websiteUrl) return p.websiteUrl;
  if (p.sourceUrl) return `${p.sourceType ?? "source"}: ${p.sourceUrl}`;
  return p.name || "this business";
}

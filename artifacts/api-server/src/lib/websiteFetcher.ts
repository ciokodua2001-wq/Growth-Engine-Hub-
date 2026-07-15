const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 12_000;
const MIN_TEXT_CHARS = 10;

const FALLBACK_PATHS = ["/about", "/company", "/services", "/product", "/home", "/about-us"];

export class WebsiteFetchError extends Error {}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function extractTag(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : null;
}

function extractMeta(html: string, ...attrs: string[]): string | null {
  for (const attr of attrs) {
    const m = html.match(
      new RegExp(`<meta[^>]+(?:name|property)=["']${attr}["'][^>]+content=["']([^"']*)["']`, "i"),
    ) ?? html.match(
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${attr}["']`, "i"),
    );
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function htmlToText(html: string): string {
  const withoutNonContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  return withoutNonContent
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) return null;
    const ct = response.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer.slice(0, MAX_HTML_BYTES)).toString("utf-8");
  } catch {
    return null;
  }
}

export interface FetchedWebsite {
  url: string;
  title: string | null;
  metaDescription: string | null;
  text: string;
}

export async function fetchWebsiteContent(rawUrl: string): Promise<FetchedWebsite> {
  const url = normalizeUrl(rawUrl);
  const origin = new URL(url).origin;

  // Try main URL first; fall back if it fails or has too little text
  let html: string | null = null;
  let usedUrl = url;

  // Attempt main page with real browser UA (handles redirects, doesn't throw)
  const mainHtml = await fetchHtml(url);
  if (!mainHtml) {
    throw new WebsiteFetchError(`Could not reach ${url}: connection refused or network error`);
  }
  html = mainHtml;

  // Extract metadata from the primary page
  const title = extractTag(html, "title") ?? extractMeta(html, "og:title", "twitter:title");
  const metaDescription = extractMeta(
    html,
    "description", "og:description", "twitter:description",
  );
  const keywords = extractMeta(html, "keywords");
  const siteName = extractMeta(html, "og:site_name");

  // Extract visible body text
  const bodyMatch = html.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i);
  let bodyText = htmlToText(bodyMatch ? bodyMatch[1] : html);

  // If body text is thin (JS SPA), try a few fallback pages and accumulate text
  if (bodyText.length < 300) {
    const extras: string[] = [];
    for (const path of FALLBACK_PATHS) {
      if (extras.join(" ").length > 3000) break;
      const fallbackHtml = await fetchHtml(`${origin}${path}`);
      if (!fallbackHtml) continue;
      const fb = fallbackHtml.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i);
      const fbText = htmlToText(fb ? fb[1] : fallbackHtml);
      if (fbText.length > 100) {
        extras.push(fbText.slice(0, 2000));
        usedUrl = `${origin}${path}`;
      }
    }
    if (extras.length) {
      bodyText = [bodyText, ...extras].join(" ").trim();
    }
  }

  // Build a rich text blob from all available signals
  const signals: string[] = [];
  if (siteName) signals.push(`Site: ${siteName}`);
  if (title) signals.push(`Title: ${title}`);
  if (metaDescription) signals.push(`Description: ${metaDescription}`);
  if (keywords) signals.push(`Keywords: ${keywords}`);
  if (bodyText) signals.push(bodyText);

  const text = signals.join("\n").slice(0, MAX_TEXT_CHARS);

  if (text.length < MIN_TEXT_CHARS) {
    throw new WebsiteFetchError(
      `${url} returned almost no readable text content. The site may be entirely JavaScript-rendered. Try entering your business details manually.`,
    );
  }

  return {
    url: usedUrl,
    title,
    metaDescription,
    text,
  };
}

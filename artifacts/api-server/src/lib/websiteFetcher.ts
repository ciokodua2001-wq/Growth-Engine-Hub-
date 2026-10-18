const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 12_000;
const MIN_TEXT_CHARS = 10;

const FALLBACK_PATHS = ["/about", "/company", "/services", "/product", "/home", "/about-us"];

const USER_AGENTS = [
  "GrowthForgeBot/1.0 (+https://usegrowthforge.com/bot)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

const SOCIAL_DOMAINS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "linkedin.com",
  "twitter.com",
  "x.com",
];

function isSocialDomain(origin: string): boolean {
  const host = origin.toLowerCase();
  return SOCIAL_DOMAINS.some((d) => host.includes(d));
}

export class WebsiteFetchError extends Error {
  public statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "WebsiteFetchError";
    this.statusCode = statusCode;
  }
}

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

async function fetchHtmlWithFallback(url: string): Promise<{ html: string | null; status?: number; errorMsg?: string }> {
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (const ua of USER_AGENTS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent": ua,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
        });
      } finally {
        clearTimeout(timeout);
      }

      lastStatus = response.status;
      if (!response.ok) {
        lastError = `HTTP ${response.status} ${response.statusText}`;
        continue;
      }

      const ct = response.headers.get("content-type") ?? "";
      if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
        lastError = `Invalid Content-Type: ${ct || "unknown"}`;
        continue;
      }

      const buffer = await response.arrayBuffer();
      const html = Buffer.from(buffer.slice(0, MAX_HTML_BYTES)).toString("utf-8");
      return { html, status: response.status };
    } catch (err: any) {
      lastError = err?.message || "Network request failed";
    }
  }

  return { html: null, status: lastStatus, errorMsg: lastError };
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

  const mainResult = await fetchHtmlWithFallback(url);
  if (!mainResult.html) {
    const statusInfo = mainResult.status ? ` (HTTP ${mainResult.status})` : "";
    const detail = mainResult.errorMsg ? `: ${mainResult.errorMsg}` : "";
    throw new WebsiteFetchError(
      `Could not reach ${url}${statusInfo}${detail}`,
      mainResult.status
    );
  }

  let html = mainResult.html;
  let usedUrl = url;

  const title = extractTag(html, "title") ?? extractMeta(html, "og:title", "twitter:title");
  const metaDescription = extractMeta(
    html,
    "description", "og:description", "twitter:description",
  );
  const keywords = extractMeta(html, "keywords");
  const siteName = extractMeta(html, "og:site_name");

  const bodyMatch = html.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i);
  let bodyText = htmlToText(bodyMatch ? bodyMatch[1] : html);

  if (bodyText.length < 300 && !isSocialDomain(origin)) {
    const extras: string[] = [];
    for (const path of FALLBACK_PATHS) {
      if (extras.join(" ").length > 3000) break;
      const fbResult = await fetchHtmlWithFallback(`${origin}${path}`);
      if (!fbResult.html) continue;
      const fb = fbResult.html.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i);
      const fbText = htmlToText(fb ? fb[1] : fbResult.html);
      if (fbText.length > 100) {
        extras.push(fbText.slice(0, 2000));
        usedUrl = `${origin}${path}`;
      }
    }
    if (extras.length) {
      bodyText = [bodyText, ...extras].join(" ").trim();
    }
  }

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

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 12_000;

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

function extractMeta(html: string, name: string): string | null {
  const match = html.match(
    new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`, "i"),
  );
  return match ? match[1].trim() : null;
}

function htmlToText(html: string): string {
  const withoutNonContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

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

export interface FetchedWebsite {
  url: string;
  title: string | null;
  metaDescription: string | null;
  text: string;
}

export async function fetchWebsiteContent(rawUrl: string): Promise<FetchedWebsite> {
  const url = normalizeUrl(rawUrl);

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; GrowthForgeAI/1.0; +https://usegrowthforge.com)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    throw new WebsiteFetchError(
      `Could not reach ${url}: ${err instanceof Error ? err.message : "unknown network error"}`,
    );
  }

  if (!response.ok) {
    throw new WebsiteFetchError(`${url} responded with HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new WebsiteFetchError(`${url} did not return an HTML page (content-type: ${contentType || "unknown"})`);
  }

  const buffer = await response.arrayBuffer();
  const html = Buffer.from(buffer.slice(0, MAX_HTML_BYTES)).toString("utf-8");

  const title = extractTag(html, "title");
  const metaDescription = extractMeta(html, "description") ?? extractMeta(html, "og:description");
  const bodyMatch = html.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i);
  const text = htmlToText(bodyMatch ? bodyMatch[1] : html).slice(0, MAX_TEXT_CHARS);

  if (text.length < 50) {
    throw new WebsiteFetchError(`${url} returned almost no readable text content`);
  }

  return { url, title, metaDescription, text };
}

import { describe, it, expect, vi, afterEach } from "vitest";
import { isBlockPage, fetchWebsiteContent } from "../websiteFetcher.js";

describe("websiteFetcher.isBlockPage", () => {
  it("detects Patagonia's virtual queue page", () => {
    expect(
      isBlockPage("Hang Tight! Routing to checkout...", "Sit tight, we've got our hands full at the moment"),
    ).toBe(true);
  });

  it("detects Cloudflare / anti-bot challenge pages", () => {
    expect(isBlockPage("Just a moment...", "Checking your browser before accessing example.com")).toBe(true);
    expect(isBlockPage(null, "Please enable JavaScript and cookies to continue")).toBe(true);
  });

  it("detects maintenance pages", () => {
    expect(isBlockPage("Down for maintenance", "The site is temporarily unavailable")).toBe(true);
    expect(isBlockPage("We are undergoing maintenance", "Please check back later")).toBe(true);
  });

  it("detects access-denied / security pages", () => {
    expect(isBlockPage("Access Denied", "You do not have permission")).toBe(true);
    expect(isBlockPage(null, "We are performing a security check on your browser")).toBe(true);
  });

  it("does not false-positive on legitimate business copy", () => {
    expect(isBlockPage("Acme Plumbing", "We offer maintenance and repair services for homes and offices")).toBe(false);
    expect(isBlockPage("Acme Security", "Professional security check and assessment services")).toBe(false);
    expect(isBlockPage("Coffee Shop", "Hang out with us and enjoy a moment of calm")).toBe(false);
  });
});

describe("websiteFetcher.fetchWebsiteContent block-page recovery", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("recovers real content from a fallback path when the homepage is a queue page", async () => {
    const html = (title: string, body: string) =>
      `<html><head><title>${title}</title></head><body>${body}</body></html>`;

    globalThis.fetch = vi.fn(async (input: unknown) => {
      const u = String(input);
      if (u.includes("/about")) {
        return new Response(
          html(
            "Our Story | Patagonia",
            "We make outdoor clothing and gear for the planet. Our mission is to build the best product, cause no unnecessary harm, and use business to protect nature. We prioritize durable, repairable, and recyclable products for every season.",
          ),
          { status: 200, headers: { "content-type": "text/html" } },
        );
      }
      return new Response(html("Hang Tight! Routing to checkout...", "Sit tight, we've got our hands full."), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;

    const r = await fetchWebsiteContent("https://www.patagonia.com");

    expect(r.url).toContain("/about");
    expect(r.title).toContain("Our Story");
    expect(r.text).toContain("outdoor clothing and gear");
    expect(r.text).not.toContain("Hang Tight");
  });

  it("throws a clear error when every page is behind a queue", async () => {
    const html = (title: string) =>
      `<html><head><title>${title}</title></head><body>Sit tight, we've got our hands full.</body></html>`;

    globalThis.fetch = vi.fn(async () => {
      return new Response(html("Hang Tight! Routing to checkout..."), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;

    await expect(fetchWebsiteContent("https://www.patagonia.com")).rejects.toThrow(
      /anti-bot, queue, or maintenance page/i,
    );
  });
});

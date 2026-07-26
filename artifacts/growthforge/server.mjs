/**
 * GrowthForge production static server
 *
 * Handles ALL URL variants before serving any content:
 *   http://usegrowthforge.com  → 301 → https://usegrowthforge.com
 *   http://www.usegrowthforge.com → 301 → https://usegrowthforge.com
 *   https://www.usegrowthforge.com → 301 → https://usegrowthforge.com
 *   usegrowthforge.com (bare, handled by DNS → https redirect above)
 *
 * Then serves the Vite/React SPA from dist/public with correct
 * cache headers and a /*.* → index.html SPA fallback.
 *
 * Zero non-built-in dependencies — runs with plain `node server.mjs`.
 */

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "dist", "public");
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const CANONICAL_HOST = "usegrowthforge.com";

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".otf":  "font/otf",
  ".mp4":  "video/mp4",
  ".webm": "video/webm",
  ".txt":  "text/plain; charset=utf-8",
  ".xml":  "application/xml",
  ".pdf":  "application/pdf",
};

function getMime(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

// ── Cache-control headers ─────────────────────────────────────────────────────
// HTML files: no-cache so the browser always re-checks (SPA shell may change).
// Assets (JS/CSS/fonts/images): 1 year — Vite content-hashes them.
function getCacheControl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" || ext === "") return "no-cache, no-store, must-revalidate";
  return "public, max-age=31536000, immutable";
}

// ── Serve a file ──────────────────────────────────────────────────────────────
function serveFile(filePath, res) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback — serve index.html for any unresolved path
      const index = path.join(PUBLIC_DIR, "index.html");
      fs.readFile(index, (err2, data) => {
        if (err2) {
          res.writeHead(500);
          res.end("Server error");
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(data);
      });
      return;
    }

    fs.readFile(filePath, (err3, data) => {
      if (err3) {
        res.writeHead(500);
        res.end("Server error");
        return;
      }
      res.writeHead(200, {
        "Content-Type": getMime(filePath),
        "Cache-Control": getCacheControl(filePath),
        "Content-Length": stat.size,
      });
      res.end(data);
    });
  });
}

// ── Request handler ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const host   = (req.headers.host ?? "").toLowerCase().replace(/:.*$/, ""); // strip port
  const proto  = (req.headers["x-forwarded-proto"] ?? "https").toLowerCase();
  const url    = req.url ?? "/";

  // ── 1. Redirect HTTP → HTTPS ─────────────────────────────────────────────
  if (proto === "http") {
    res.writeHead(301, { Location: `https://${CANONICAL_HOST}${url}` });
    res.end();
    return;
  }

  // ── 2. Redirect www (or any non-canonical host) → canonical ──────────────
  //   Covers: www.usegrowthforge.com, growth-engine-hub-charliemanno.replit.app, etc.
  //   Exception: localhost / 127.0.0.1 (dev previews) pass through.
  if (host && host !== CANONICAL_HOST && !host.startsWith("localhost") && !host.startsWith("127.")) {
    res.writeHead(301, { Location: `https://${CANONICAL_HOST}${url}` });
    res.end();
    return;
  }

  // ── 3. Health-check endpoint (used by Replit startup probe) ──────────────
  if (url === "/healthz" || url === "/_health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  // Compute clean path once for all subsequent handlers
  const cleanPath = decodeURIComponent(url.split("?")[0]).replace(/\.\./g, "");

  // ── 3b. robots.txt ───────────────────────────────────────────────────────
  if (cleanPath === "/robots.txt") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" });
    res.end(`User-agent: *\nAllow: /\nSitemap: https://${CANONICAL_HOST}/sitemap.xml\n`);
    return;
  }

  // ── 3c. /sitemap.xml — standard location, no Clerk/CORS/auth cookies ────
  //    Proxies from the API server and strips auth/cookie headers so
  //    Google Search Console gets a clean public response.
  if (cleanPath === "/sitemap.xml") {
    // Project 20 = usegrowthforge.com — fetch from API, strip auth/cookie headers
    https.get(`https://${CANONICAL_HOST}/api/sitemap/20/sitemap.xml`, (apiRes) => {
      let body = "";
      apiRes.on("data", (chunk) => { body += chunk; });
      apiRes.on("end", () => {
        if (apiRes.statusCode === 200) {
          res.writeHead(200, {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          });
          res.end(body);
        } else {
          res.writeHead(503, { "Content-Type": "text/plain" });
          res.end("Sitemap not ready. Generate one from GrowthForge.");
        }
      });
    }).on("error", () => {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("Sitemap temporarily unavailable.");
    });
    return;
  }

  // ── 4. Serve static files ─────────────────────────────────────────────────
  let filePath = path.join(PUBLIC_DIR, cleanPath);

  // If path ends with "/" try index.html in that directory
  if (cleanPath.endsWith("/") || path.extname(cleanPath) === "") {
    const dirIndex = path.join(filePath, "index.html");
    if (fs.existsSync(dirIndex)) {
      serveFile(dirIndex, res);
    } else {
      // SPA fallback
      serveFile(path.join(PUBLIC_DIR, "index.html"), res);
    }
    return;
  }

  serveFile(filePath, res);
});

server.listen(PORT, () => {
  console.log(`GrowthForge server listening on port ${PORT}`);
  console.log(`Serving static files from: ${PUBLIC_DIR}`);
  console.log(`Canonical host: ${CANONICAL_HOST}`);
});

server.on("error", (err) => {
  console.error("Server error:", err);
  process.exit(1);
});

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware.js";
import router from "./routes/index.js";
import resendWebhookHandler from "./routes/resendWebhook.js";
import { logger } from "./lib/logger.js";
import { WebhookHandlers } from "./webhookHandlers.js";
import { db } from "@workspace/db";
import { seoSitemapTable, seoComparisonPagesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const app: Express = express();

// www → apex 301 redirect (must be first)
app.use((req, res, next) => {
  const host = req.headers.host ?? "";
  if (host.startsWith("www.")) {
    const apex = host.slice(4);
    res.redirect(301, `https://${apex}${req.originalUrl}`);
    return;
  }
  next();
});

// Public comparison pages — served before ALL middleware (no Clerk, no CORS)
// URL includes projectId to guarantee uniqueness: /compare/:projectId/:slug
// e.g. https://usegrowthforge.com/compare/20/jasper-alternative
app.get("/compare/:projectId/:slug", async (req, res) => {
  const projectId = parseInt(String(req.params["projectId"] ?? ""), 10);
  const slug = req.params["slug"];
  if (isNaN(projectId) || !slug) { res.status(400).send("Invalid URL"); return; }
  try {
    const [row] = await db
      .select({ contentHtml: seoComparisonPagesTable.contentHtml })
      .from(seoComparisonPagesTable)
      .where(and(eq(seoComparisonPagesTable.projectId, projectId), eq(seoComparisonPagesTable.slug, slug)))
      .limit(1);
    if (!row) { res.status(404).send("Page not found."); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(row.contentHtml);
  } catch (err) {
    logger.error({ err }, "Comparison page fetch failed");
    res.status(500).send("Internal error");
  }
});

// Public sitemap — registered before ALL middleware (no Clerk, no CORS, no credentials)
// so Google's crawler gets a clean response with Cache-Control: public.
app.get("/api/sitemap/:projectId/sitemap.xml", async (req, res) => {
  const projectId = parseInt(String(req.params["projectId"] ?? ""), 10);
  if (isNaN(projectId)) { res.status(400).send("Invalid project id"); return; }
  try {
    const [row] = await db
      .select({ xml: seoSitemapTable.xml })
      .from(seoSitemapTable)
      .where(eq(seoSitemapTable.projectId, projectId));
    if (!row) { res.status(404).send("Sitemap not found. Generate one from GrowthForge."); return; }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Robots-Tag", "noindex");
    res.removeHeader("set-cookie");
    res.send(row.xml);
  } catch (err) {
    logger.error({ err }, "Sitemap fetch failed");
    res.status(500).send("Internal error");
  }
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// 1. Clerk FAPI proxy (production only, no-op in dev)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// 2a. Stripe webhook — must be registered BEFORE express.json() parses the body.
//     The webhook handler needs the raw Buffer to verify the Stripe signature.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const signature = Array.isArray(sig) ? sig[0] : sig;
    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, signature);
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      logger.error({ err }, "Stripe webhook processing failed");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

// 2b. Resend webhook — must be registered BEFORE express.json() to access the raw body.
app.post("/api/owner/resend-webhook", express.raw({ type: "application/json" }), resendWebhookHandler);

// 2b. Body parsers (after webhook so json() doesn't intercept the raw buffer)
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Clerk session middleware
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// 4. API routes
app.use("/api", router);

export default app;

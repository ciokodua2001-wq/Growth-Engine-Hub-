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

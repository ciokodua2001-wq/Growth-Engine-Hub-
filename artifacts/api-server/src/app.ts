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
import { WebhookHandlers } from "./webhookHandlers.js";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

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

// 1. Stripe webhook — MUST be before express.json() (needs raw Buffer)
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      logger.error({ err }, "Stripe webhook error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

// 2. Clerk FAPI proxy (production only, no-op in dev)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// 3. Body parsers
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Clerk session middleware
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// 5. API routes
app.use("/api", router);

export default app;

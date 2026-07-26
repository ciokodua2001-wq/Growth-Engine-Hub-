import app from "./app.js";
import { logger } from "./lib/logger.js";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient.js";
import { startArchivalJob } from "./lib/archivalJob.js";
import { startStuckPublishRecovery } from "./lib/stuckPublishRecovery.js";
import { startScheduledPublisher } from "./lib/scheduledPublisher.js";
import { startRenderMonitor } from "./lib/renderMonitor.js";
import { checkEncryptionKey, isEncryptedFormat, decryptToken } from "./lib/tokenCrypto.js";
import { db } from "@workspace/db";
import { metaConnectionsTable, commercialAssembliesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

// Startup key check — surface missing/invalid TOKEN_ENCRYPTION_KEY before any user
// hits a publish failure.  We check the dedicated key specifically (not the
// SESSION_SECRET fallback) because rotating SESSION_SECRET without migrating tokens
// makes all stored page tokens permanently unreadable.
const _keyCheck = checkEncryptionKey();
if (!_keyCheck.ok) {
  logger.error(
    { reason: _keyCheck.reason },
    "STARTUP ERROR: TOKEN_ENCRYPTION_KEY is absent or invalid — stored Meta page tokens may not be decryptable. Set TOKEN_ENCRYPTION_KEY in your environment before users try to publish."
  );
}

// Startup Meta token health scan — runs once after the server starts listening.
// Tries to decrypt every stored page-access token with the current key and logs
// a prominent error listing affected project IDs if any fail.  This surfaces
// key-rotation fallout immediately instead of waiting for user publish failures.
async function runMetaTokenHealthCheck(): Promise<void> {
  try {
    const rows = await db
      .select({
        id: metaConnectionsTable.id,
        projectId: metaConnectionsTable.projectId,
        pageAccessToken: metaConnectionsTable.pageAccessToken,
      })
      .from(metaConnectionsTable);

    if (rows.length === 0) return;

    let healthy = 0;
    const failedProjectIds: number[] = [];

    for (const row of rows) {
      try {
        if (isEncryptedFormat(row.pageAccessToken)) {
          decryptToken(row.pageAccessToken);
        }
        healthy++;
      } catch {
        failedProjectIds.push(row.projectId);
      }
    }

    if (failedProjectIds.length > 0) {
      logger.error(
        { total: rows.length, healthy, failed: failedProjectIds.length, affectedProjectIds: failedProjectIds },
        `STARTUP ALERT: ${failedProjectIds.length} of ${rows.length} Meta page token(s) cannot be decrypted with the current key. ` +
        `Affected project IDs: [${failedProjectIds.join(", ")}]. ` +
        "These users will not be able to publish to Facebook/Instagram until they reconnect. " +
        "Run POST /admin/meta/re-encrypt-tokens to attempt migration, or ask affected users to reconnect via Social Hub."
      );
    } else {
      logger.info({ total: rows.length, healthy }, "Startup: all Meta page tokens decrypt successfully with current key.");
    }
  } catch (err) {
    logger.warn({ err }, "Startup: Meta token health check could not complete (DB may not be ready yet).");
  }
}

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

async function ensureSeoSitemapTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS seo_sitemaps (
        id         serial PRIMARY KEY,
        project_id integer NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        xml        text NOT NULL,
        page_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    logger.info("seo_sitemaps table ready");
  } catch (err) {
    logger.warn({ err }, "seo_sitemaps migration failed (non-fatal)");
  }
}

async function ensureOwnerMarketingTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS owner_contacts (
        id serial PRIMARY KEY, email text NOT NULL UNIQUE, first_name text, last_name text,
        company text, tags text[] NOT NULL DEFAULT '{}', source text NOT NULL DEFAULT 'import',
        unsubscribed boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS owner_segments (
        id serial PRIMARY KEY, name text NOT NULL, filter_json jsonb,
        segment_type text NOT NULL DEFAULT 'external', created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS owner_suppression_list (
        email text PRIMARY KEY, reason text NOT NULL DEFAULT 'unsubscribed',
        added_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS owner_campaigns (
        id serial PRIMARY KEY, name text NOT NULL, subject text NOT NULL, body text NOT NULL,
        target_type text NOT NULL DEFAULT 'external', segment_id integer, filter_json jsonb,
        status text NOT NULL DEFAULT 'draft', sent_at timestamptz, recipient_count integer,
        open_rate text, click_rate text, bounce_rate text,
        unsubscribe_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    logger.info("Owner marketing tables ready");
  } catch (err) {
    logger.warn({ err }, "Owner marketing table migration failed (non-fatal)");
  }
}

async function initStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — Stripe init skipped");
    return;
  }
  try {
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const stripeSync = await getStripeSync();

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (domain) {
      await stripeSync.findOrCreateManagedWebhook(`https://${domain}/api/stripe/webhook`);
      logger.info("Stripe managed webhook configured");
    }

    // Backfill runs in the background — don't block startup
    stripeSync.syncBackfill().then(() => {
      logger.info("Stripe data backfill complete");
    }).catch((err) => {
      logger.warn({ err }, "Stripe backfill failed (non-fatal)");
    });
  } catch (err) {
    // Log but don't crash — server still works for non-payment routes
    logger.warn({ err }, "Stripe init failed (non-fatal — connect Stripe integration to enable payments)");
  }
}

async function recoverStuckAssemblies(): Promise<void> {
  try {
    // Any row still "pending" or "processing" at startup is definitively orphaned —
    // FFmpeg cannot survive a process restart, and a "pending" row whose fire-and-forget
    // never ran also dies with the process. Reset ALL of them, no age threshold.
    const result = await db
      .update(commercialAssembliesTable)
      .set({
        status: "failed",
        errorMessage: "Assembly was interrupted by a server restart. Click 'Retry Assembly' to re-stitch your scenes.",
        updatedAt: new Date(),
      })
      .where(inArray(commercialAssembliesTable.status, ["pending", "processing"]))
      .returning({ id: commercialAssembliesTable.id });
    if (result.length > 0) {
      logger.warn({ count: result.length }, "Startup recovery: reset stuck assemblies to failed");
    } else {
      logger.info("Startup recovery: no stuck assemblies found");
    }
  } catch (err) {
    logger.warn({ err }, "Startup recovery: stuck assembly check failed (non-fatal)");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  startArchivalJob();
  startStuckPublishRecovery();
  startScheduledPublisher();
  startRenderMonitor();
  void runMetaTokenHealthCheck();
  void ensureOwnerMarketingTables();
  void ensureSeoSitemapTable();
  void initStripe();
  void recoverStuckAssemblies();
});

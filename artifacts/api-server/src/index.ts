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

async function ensureSeoComparisonPagesTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS seo_comparison_pages (
        id              serial PRIMARY KEY,
        project_id      integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        slug            text NOT NULL,
        competitor      text NOT NULL,
        title           text NOT NULL,
        content_html    text NOT NULL,
        meta_description text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT seo_comparison_pages_project_slug_uniq UNIQUE (project_id, slug)
      );
    `);
    logger.info("seo_comparison_pages table ready");
  } catch (err) {
    logger.warn({ err }, "seo_comparison_pages migration failed (non-fatal)");
  }
}

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

async function ensureSupportTicketsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id              serial PRIMARY KEY,
        name            text NOT NULL,
        email           text NOT NULL,
        subject         text NOT NULL,
        message         text NOT NULL,
        category        text NOT NULL DEFAULT 'other',
        status          text NOT NULL DEFAULT 'open',
        ai_response     text,
        admin_reply     text,
        admin_replied_at timestamptz,
        escalated_at    timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      );
    `);
    logger.info("support_tickets table ready");
  } catch (err) {
    logger.warn({ err }, "support_tickets migration failed (non-fatal)");
  }
}

const DEFAULT_KNOWLEDGE_BASE = `# GrowthForge Knowledge Base

## What is GrowthForge?
GrowthForge is an AI-powered marketing operating system for founders and lean teams. It replaces expensive marketing agencies by generating strategy, content, and ads from a single platform. You paste your website URL and GrowthForge analyzes your business, competitors, and market position — then generates ready-to-publish social posts, emails, blog posts, ads, and promotional videos.

## Plans & Pricing
All plans are billed monthly. Every plan includes a **7-day free trial** — no credit card required.

| Plan | Price | Projects | Videos/mo |
|---|---|---|---|
| Starter | $39/mo | 1 | 3 (up to 45s each) |
| Get Going | $99/mo | 3 | 8 (up to 120s each) |
| Growth | $249/mo | 6 | 20 (up to 300s each) |
| Agency | $599/mo | 20 | 48 (up to 720s each) |

Extra video credits can be purchased separately in the Video Studio if monthly limits are exceeded.

## Free Trial Limits
The 7-day trial includes (per project):
- 1 Business Analysis
- 1 Competitor Discovery
- 1 Persona Generation
- 1 Marketing Strategy
- 1 Competitor Deep-Dive Report
- 5 Social Posts (total, across all platforms)
- 10 Forge AI Agent messages
- 1 SEO Watchdog check-in

**Not available on trial (paid plans only):** Email campaign generation, Video generation, Ad creative generation, AI image generation, SEO Strategy Builder, SEO Blog Post generation, Campaign Performance Reports.

To start a trial: go to /plans and click "Start Free Trial". Signing up alone does not start it — you must click that button first.

## Features

### Business Analysis
- Paste your website URL → AI extracts your Ideal Customer Profile (ICP), market opportunities, and competitive overview.
- Available from the "Analysis" tab within any project.
- Trial: 1 analysis per project.

### Competitor Intelligence
- Discovers your top competitors automatically based on your business.
- Generates a detailed report with messaging gaps, positioning weaknesses, and differentiation opportunities.
- Trial: 1 competitor discovery + 1 deep-dive report.

### Content Strategy
- Builds a complete marketing playbook: positioning statement, brand voice guide, and full-funnel content map.
- Trial: 1 strategy generation.

### Social Calendar
Generates a 30-day content calendar with posts tailored for: LinkedIn, X (Twitter), TikTok, Instagram, and Facebook. Each post includes an AI-generated creative image.

**Direct publishing** to Facebook and Instagram via Meta OAuth integration.
- X (Twitter), TikTok, and LinkedIn: share buttons pre-fill the caption — no direct API publishing for those platforms.
- Trial: 5 social posts total across all platforms.

### Connecting Facebook/Instagram for Publishing
1. Go to your project's Social tab.
2. Click "Connect Facebook Page" in the handles/settings panel.
3. Authenticate with Meta and select which page to connect.
4. Once connected, post cards show a Publish button for Facebook and Instagram.

Sessions expire periodically — if you see a "session expired" notice, click the reconnect button on that notice. You do not need to leave the page to fix this.

### Email Campaigns
- Generates welcome sequences, sales emails, nurture drips, and reactivation campaigns.
- Upload your subscriber list as a CSV file.
- Campaigns are delivered via the platform's email infrastructure.
- **Paid plans only** — not available on trial.

### SEO Suite
- **Blog Posts**: AI-generated long-form SEO articles targeting your keywords. Paid only.
- **Meta Tags**: Title tags and meta descriptions for your pages.
- **Schema Markup**: Structured data (JSON-LD) for rich search results.
- **SEO Watchdog**: Weekly performance check-in and AI recommendations. 1 free on trial.
- **SEO Strategy Builder**: Full keyword and content strategy. Paid only.
- **Comparison Pages**: Auto-generated "vs Competitor" comparison pages. Paid only.

### Ad Creatives
- Generates high-converting ad copy for Google Ads and Meta Ads (Facebook/Instagram).
- Includes hooks, headlines, body copy, and CTAs optimized per platform.
- **Paid plans only.**

### Video Studio
- Generates 1080p HD AI promotional videos.
- Workflow: generate scene blueprints → review storyboard → render video.
- Includes AI voiceover and ambient audio baked in.
- Video generation takes approximately 2–5 minutes per scene.
- Monthly video seconds vary by plan (see Plans table above).
- **Paid plans only** — trial users cannot render videos.

### Forge AI Agent
- A context-aware AI chatbot that knows your business data, competitors, and strategy.
- Can draft posts, write copy, analyze competitors, or answer questions about your marketing.
- Trial: 10 messages per project.

### Analytics Dashboard
- Tracks campaign performance: email opens, clicks, delivery rates.
- Available from the Analytics tab within any project.

## Troubleshooting

### Facebook/Instagram posts won't publish
The Meta connection may have expired. Go to the Social tab and look for a "session expired" or "reconnect" notice. Click the reconnect button — you do not need to leave the page.

### Video is stuck processing
Video rendering takes 2–5 minutes. If it has been more than 10 minutes, refresh the page. If it still shows as processing after 15+ minutes, contact support — the team can manually clear stuck renders.

### "Upgrade required" / can't access a feature on trial
Email campaigns, video rendering, ads, and SEO blog posts require a paid plan. Go to /plans to upgrade. All your trial data and projects are preserved when you upgrade.

### Reached trial limit for social posts or analysis
The 7-day trial includes limited quotas. Upgrade to any paid plan on /plans to remove limits.

### Can't find where to cancel
To cancel, email support@usegrowthforge.com. The team processes cancellations within 24 hours.

## Account & Billing
- All plans are billed monthly and renew automatically.
- To change plans: go to /plans and select a new plan.
- To cancel: email support@usegrowthforge.com.
- Refund requests require human review — these are escalated to the team and cannot be processed automatically.
- Billing disputes or charge questions beyond plan explanations must be handled by the team.
`;

async function ensureSupportKnowledgeBaseTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS support_knowledge_base (
        id         serial PRIMARY KEY,
        content    text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    // Seed default knowledge base if empty
    const existing = await db.execute(sql`SELECT id FROM support_knowledge_base LIMIT 1`);
    if (existing.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO support_knowledge_base (content) VALUES (${DEFAULT_KNOWLEDGE_BASE})
      `);
      logger.info("support_knowledge_base table created and seeded");
    } else {
      logger.info("support_knowledge_base table ready");
    }
  } catch (err) {
    logger.warn({ err }, "support_knowledge_base migration failed (non-fatal)");
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
  void ensureSupportTicketsTable();
  void ensureSupportKnowledgeBaseTable();
  void ensureOwnerMarketingTables();
  void ensureSeoSitemapTable();
  void ensureSeoComparisonPagesTable();
  void initStripe();
  void recoverStuckAssemblies();
});

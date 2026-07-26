/**
 * Resend delivery webhook handler.
 *
 * Resend signs webhook payloads using the Svix scheme:
 *   HMAC-SHA256( "<svix-id>.<svix-timestamp>.<rawBody>", base64decode(secret_without_prefix) )
 *
 * Register BEFORE express.json() so we receive the raw Buffer.
 *
 * Stats are updated atomically in a single SQL statement — no read-modify-write —
 * so concurrent events for the same campaign cannot overwrite each other.
 */
import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@workspace/db";
import { ownerCampaignsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ── Signature verification ────────────────────────────────────────────────────

function verifyResendWebhook(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn("RESEND_WEBHOOK_SECRET is not set — rejecting webhook request");
    return false;
  }

  const header = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const msgId = header("svix-id");
  const msgTimestamp = header("svix-timestamp");
  const msgSig = header("svix-signature");

  if (!msgId || !msgTimestamp || !msgSig) return false;

  // Reject messages older than 5 minutes to prevent replay attacks
  const ts = parseInt(msgTimestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  // Decode the secret: strip optional "whsec_" prefix, then base64 decode
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(rawSecret, "base64");
  } catch {
    return false;
  }

  const toSign = `${msgId}.${msgTimestamp}.${rawBody.toString("utf8")}`;
  const computed = createHmac("sha256", keyBytes).update(toSign).digest("base64");

  // svix-signature may contain multiple space-separated sigs, each "v1,<base64>"
  const provided = msgSig.split(" ").map(s => s.split(",")[1]).filter(Boolean);
  return provided.some(sig => {
    try {
      const sigBuf = Buffer.from(sig, "base64");
      const computedBuf = Buffer.from(computed, "base64");
      return sigBuf.length === computedBuf.length && timingSafeEqual(sigBuf, computedBuf);
    } catch {
      return false;
    }
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function resendWebhookHandler(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Buffer;

  if (!verifyResendWebhook(rawBody, req.headers as Record<string, string | string[] | undefined>)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  let payload: { type?: string; data?: Record<string, unknown> };
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const { type, data } = payload;
  if (!type || !data) {
    res.status(200).json({ ok: true, skipped: "missing type or data" });
    return;
  }

  // Extract campaign_id from tags: [{ name: "campaign_id", value: "42" }, ...]
  const tags = (data.tags as Array<{ name: string; value: string }> | undefined) ?? [];
  const campaignTag = tags.find(t => t.name === "campaign_id");
  const campaignId = campaignTag ? parseInt(campaignTag.value, 10) : NaN;

  if (isNaN(campaignId) || campaignId <= 0) {
    // Not a campaign email (e.g. transactional) — ignore silently
    res.status(200).json({ ok: true, skipped: "no campaign_id tag" });
    return;
  }

  try {
    if (type === "email.opened") {
      // Atomically increment opens_count and recompute open_rate in one statement.
      // NULLIF guards against division-by-zero if recipient_count is null/0.
      await db.execute(sql`
        UPDATE owner_campaigns
        SET
          opens_count = opens_count + 1,
          open_rate   = ROUND(
            (opens_count + 1)::numeric * 100.0 / NULLIF(recipient_count, 0),
            1
          )::text
        WHERE id = ${campaignId}
      `);
      logger.info({ campaignId, type }, "Resend webhook: opens incremented");

    } else if (type === "email.clicked") {
      await db.execute(sql`
        UPDATE owner_campaigns
        SET
          clicks_count = clicks_count + 1,
          click_rate   = ROUND(
            (clicks_count + 1)::numeric * 100.0 / NULLIF(recipient_count, 0),
            1
          )::text
        WHERE id = ${campaignId}
      `);
      logger.info({ campaignId, type }, "Resend webhook: clicks incremented");

    } else if (type === "email.bounced" || type === "email.complained") {
      await db.execute(sql`
        UPDATE owner_campaigns
        SET
          bounces_count = bounces_count + 1,
          bounce_rate   = ROUND(
            (bounces_count + 1)::numeric * 100.0 / NULLIF(recipient_count, 0),
            1
          )::text
        WHERE id = ${campaignId}
      `);
      logger.info({ campaignId, type }, "Resend webhook: bounces incremented");

      // Suppress bounced / complained addresses from future campaigns
      const toEmail = typeof data.to === "string" ? data.to : null;
      if (toEmail) {
        const reason = type === "email.bounced" ? "bounced" : "complaint";
        await db.execute(sql`
          INSERT INTO owner_suppression_list (email, reason)
          VALUES (${toEmail}, ${reason})
          ON CONFLICT (email) DO NOTHING
        `);
      }
    }
    // All other event types (email.sent, email.delivered, etc.) are acknowledged silently.

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err, campaignId, type }, "Resend webhook: DB update failed");
    res.status(500).json({ error: "Internal error" });
  }
}

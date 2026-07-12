import cron from "node-cron";
import { and, isNotNull, isNull, lte, or, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { socialPostsTable, metaConnectionsTable, activityTable, emailCampaignsTable } from "@workspace/db";
import { logger } from "./logger.js";
import { decryptToken, encryptToken, isEncryptedFormat } from "./tokenCrypto.js";
import { publishPostToMeta } from "./metaPublisher.js";
import { notifyPostAutoPublished, notifyScheduledEmailReady, getOwnerEmailForProject } from "./emailNotifier.js";

async function publishScheduledPosts(): Promise<void> {
  const now = new Date();

  // Find draft Meta posts whose scheduled time has passed and have a Meta connection
  const duePosts = await db
    .select({
      id: socialPostsTable.id,
      projectId: socialPostsTable.projectId,
      platform: socialPostsTable.platform,
      caption: socialPostsTable.caption,
      hashtags: socialPostsTable.hashtags,
      cta: socialPostsTable.cta,
      pageId: metaConnectionsTable.pageId,
      instagramAccountId: metaConnectionsTable.instagramAccountId,
      pageAccessToken: metaConnectionsTable.pageAccessToken,
    })
    .from(socialPostsTable)
    .innerJoin(metaConnectionsTable, eq(metaConnectionsTable.projectId, socialPostsTable.projectId))
    .where(
      and(
        eq(socialPostsTable.status, "draft"),
        isNotNull(socialPostsTable.scheduledAt),
        lte(socialPostsTable.scheduledAt, now),
        or(
          eq(socialPostsTable.platform, "facebook"),
          eq(socialPostsTable.platform, "instagram"),
        ),
      ),
    );

  if (duePosts.length === 0) return;

  logger.info({ count: duePosts.length }, "Scheduled publisher: found due posts");

  for (const row of duePosts) {
    const { id: postId, projectId, platform, caption, hashtags, cta, pageId, instagramAccountId, pageAccessToken } = row;

    if (platform === "instagram" && !instagramAccountId) {
      logger.warn({ postId, projectId }, "Scheduled publisher: skipping Instagram post — no Instagram account linked");
      continue;
    }

    // Atomically lock: draft → publishing, clearing scheduledAt so a failure-rollback
    // to draft doesn't immediately re-trigger on the next cron tick.
    const [locked] = await db
      .update(socialPostsTable)
      .set({ status: "publishing", publishingAt: new Date(), scheduledAt: null })
      .where(
        and(
          eq(socialPostsTable.id, postId),
          eq(socialPostsTable.status, "draft"),
          isNull(socialPostsTable.externalPostId),
        ),
      )
      .returning({ id: socialPostsTable.id });

    if (!locked) {
      logger.info({ postId }, "Scheduled publisher: post already locked by another process, skipping");
      continue;
    }

    // Decrypt page access token, opportunistically re-encrypting legacy plaintext tokens
    let pageToken: string;
    try {
      if (!isEncryptedFormat(pageAccessToken)) {
        pageToken = pageAccessToken;
        try {
          const reEncrypted = encryptToken(pageToken);
          await db
            .update(metaConnectionsTable)
            .set({ pageAccessToken: reEncrypted })
            .where(eq(metaConnectionsTable.projectId, projectId));
        } catch {
          // Non-fatal — continue with plaintext token
        }
      } else {
        pageToken = decryptToken(pageAccessToken);
      }
    } catch (err) {
      logger.error({ err, postId, projectId }, "Scheduled publisher: failed to decrypt Meta token — resetting to draft");
      await db
        .update(socialPostsTable)
        .set({ status: "draft", publishingAt: null })
        .where(eq(socialPostsTable.id, postId));
      continue;
    }

    const content = [caption, hashtags, cta].filter(Boolean).join("\n\n");

    const result = await publishPostToMeta(
      {
        postId,
        platform: platform as "facebook" | "instagram",
        content,
        pageToken,
        pageId,
        instagramAccountId: instagramAccountId ?? null,
      },
      logger,
    );

    if (!result.ok) {
      if (result.rollback) {
        await db
          .update(socialPostsTable)
          .set({ status: "draft", publishingAt: null })
          .where(eq(socialPostsTable.id, postId));
        logger.warn({ postId, projectId, message: result.message }, "Scheduled publisher: Meta rejected post, reset to draft");
      } else {
        logger.error({ postId, projectId, message: result.message }, "Scheduled publisher: ambiguous publish failure — post left in publishing state");
      }
    } else {
      logger.info({ postId, projectId, platform }, "Scheduled publisher: post published successfully");
      try {
        await db.insert(activityTable).values({
          projectId,
          type: "social",
          description: `Auto-published "${caption.slice(0, 60)}…" to ${platform} (scheduled)`,
        });
      } catch (actErr) {
        logger.warn({ actErr }, "Scheduled publisher: failed to insert activity log (non-fatal)");
      }
      notifyPostAutoPublished({ projectId, platform, caption }).catch(err =>
        logger.warn({ err }, "Scheduled publisher: failed to send post-published notification (non-fatal)")
      );
    }
  }
}

/**
 * Checks for email campaigns whose scheduled send reminder time has arrived.
 * Sends the owner a notification email, then clears scheduledAt so it doesn't repeat.
 */
async function sendScheduledEmailReminders(): Promise<void> {
  const now = new Date();

  const dueEmails = await db
    .select({
      id: emailCampaignsTable.id,
      projectId: emailCampaignsTable.projectId,
      subject: emailCampaignsTable.subject,
    })
    .from(emailCampaignsTable)
    .where(
      and(
        eq(emailCampaignsTable.status, "draft"),
        isNotNull(emailCampaignsTable.scheduledAt),
        lte(emailCampaignsTable.scheduledAt, now),
      )
    );

  if (dueEmails.length === 0) return;

  logger.info({ count: dueEmails.length }, "Scheduled publisher: found due email reminders");

  for (const row of dueEmails) {
    // Clear scheduledAt first to prevent double-notification on next tick
    await db
      .update(emailCampaignsTable)
      .set({ scheduledAt: null })
      .where(and(eq(emailCampaignsTable.id, row.id), isNotNull(emailCampaignsTable.scheduledAt)));

    const toEmail = await getOwnerEmailForProject(row.projectId);
    if (!toEmail) {
      logger.warn({ emailId: row.id, projectId: row.projectId }, "Scheduled publisher: could not look up owner email for reminder (non-fatal)");
      continue;
    }

    notifyScheduledEmailReady({ toEmail, subject: row.subject, projectId: row.projectId }).catch(err =>
      logger.warn({ err, emailId: row.id }, "Scheduled publisher: failed to send email reminder (non-fatal)")
    );
  }
}

/**
 * Starts a cron job that auto-publishes scheduled social posts once per minute
 * and fires email-send reminder notifications for due email campaigns.
 * Only Meta (Facebook/Instagram) posts are auto-published; other platforms keep
 * scheduledAt as a visual reminder only.
 */
export function startScheduledPublisher(): void {
  cron.schedule("* * * * *", async () => {
    try {
      await publishScheduledPosts();
      await sendScheduledEmailReminders();
    } catch (err) {
      logger.error({ err }, "Scheduled publisher: unexpected top-level error");
    }
  });
  logger.info("Scheduled publisher started (runs every minute)");
}

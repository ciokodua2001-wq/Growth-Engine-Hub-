import cron from "node-cron";
import { and, eq, lt, isNotNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { socialPostsTable } from "@workspace/db";
import { logger } from "./logger.js";

/** Posts stuck in "publishing" for longer than this are considered crashed. */
const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Resets all social posts currently stuck in "publishing" back to "draft"
 * so users can retry. Returns the count of rows reset.
 *
 * Safe to call on startup (no publish can be in-flight when the process just
 * started) and periodically (15-minute threshold rules out any genuine
 * in-progress publish, which completes in < 60 seconds).
 */
export async function recoverStuckPublishingPosts(cutoffMs = STUCK_THRESHOLD_MS): Promise<number> {
  const cutoff = new Date(Date.now() - cutoffMs);
  const recovered = await db
    .update(socialPostsTable)
    .set({ status: "draft", publishingAt: null })
    .where(
      and(
        eq(socialPostsTable.status, "publishing"),
        isNotNull(socialPostsTable.publishingAt),
        lt(socialPostsTable.publishingAt, cutoff),
      ),
    )
    .returning({ id: socialPostsTable.id });

  return recovered.length;
}

/**
 * Runs an immediate startup recovery (all "publishing" posts with a
 * publishingAt older than the threshold → "draft"), then schedules a
 * periodic cron job to catch any posts that get stuck while the server
 * is running.
 */
export function startStuckPublishRecovery(): void {
  // Startup pass — runs once immediately, before the server takes requests.
  recoverStuckPublishingPosts()
    .then((count) => {
      if (count > 0) {
        logger.warn({ count }, "Startup recovery: reset stuck 'publishing' posts to 'draft'");
      } else {
        logger.info("Startup recovery: no stuck 'publishing' posts found");
      }
    })
    .catch((err) => {
      logger.error({ err }, "Startup recovery: failed to reset stuck posts — will retry on next cron tick");
    });

  // Periodic safety net — every 10 minutes, using the 15-minute threshold.
  // Any post that has been in "publishing" for > 15 minutes is certainly stuck.
  cron.schedule("*/10 * * * *", async () => {
    try {
      const count = await recoverStuckPublishingPosts();
      if (count > 0) {
        logger.warn({ count }, "Cron recovery: reset stuck 'publishing' posts to 'draft'");
      }
    } catch (err) {
      logger.error({ err }, "Cron recovery: failed to reset stuck posts");
    }
  });
}

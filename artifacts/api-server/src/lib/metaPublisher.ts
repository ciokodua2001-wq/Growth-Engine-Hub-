import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { socialPostsTable } from "@workspace/db";
import type { Logger } from "pino";
import { logger as moduleLogger } from "./logger.js";
import { GraphApiError, MetaApiShapeError, parseMetaApiResponse } from "./metaApiSchemas.js";

export type MetaPublishResult =
  | { ok: true; externalPostId: string; publishedAt: Date }
  | { ok: false; rollback: boolean; message: string; externalPostId?: string };

export interface MetaPublishParams {
  postId: number;
  platform: "facebook" | "instagram";
  content: string;
  pageToken: string;
  pageId: string;
  instagramAccountId: string | null;
}

/**
 * Calls the Meta Graph API to publish `postId` and updates the DB on success.
 *
 * Pre-condition: the caller has already atomically locked the post to "publishing"
 * status. This function does NOT acquire the lock — it only executes the API call
 * and persists the result. When result.ok === false && result.rollback === true the
 * caller must reset the post back to "draft" so the user can retry.
 */
export async function publishPostToMeta(
  params: MetaPublishParams,
  log: Logger | typeof moduleLogger = moduleLogger,
): Promise<MetaPublishResult> {
  const { postId, platform, content, pageToken, pageId, instagramAccountId } = params;

  let externalPostId: string;
  try {
    if (platform === "facebook") {
      const url = `https://graph.facebook.com/v20.0/${pageId}/feed`;
      const fbRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, access_token: pageToken }),
      });
      const fbBody: unknown = await fbRes.json();
      externalPostId = parseMetaApiResponse("Facebook feed POST", fbBody);
    } else {
      const igAccountId = instagramAccountId!;

      const containerUrl = `https://graph.facebook.com/v20.0/${igAccountId}/media`;
      const containerRes = await fetch(containerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: content, media_type: "TEXT", access_token: pageToken }),
      });
      const containerBody: unknown = await containerRes.json();
      const containerId = parseMetaApiResponse("Instagram container creation", containerBody);

      const publishUrl = `https://graph.facebook.com/v20.0/${igAccountId}/media_publish`;
      const publishRes = await fetch(publishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: containerId, access_token: pageToken }),
      });
      const publishBody: unknown = await publishRes.json();
      externalPostId = parseMetaApiResponse("Instagram media_publish", publishBody);
    }
  } catch (err) {
    if (err instanceof GraphApiError) {
      return { ok: false, rollback: true, message: err.message };
    } else if (err instanceof MetaApiShapeError) {
      log.error({ err, postId }, "Meta API response shape validation failed — publish outcome unknown");
      return {
        ok: false,
        rollback: false,
        message:
          "The post could not be confirmed because Meta returned an unexpected response (the API may have changed). " +
          "Check your Facebook/Instagram page — if the post appeared, refresh this page. If not, contact support.",
      };
    } else {
      log.error({ err, postId }, "Meta Graph API transport error — publish outcome unknown");
      return {
        ok: false,
        rollback: false,
        message:
          "Could not confirm whether the post was published due to a network error. " +
          "Check your Facebook/Instagram page — if the post appeared, refresh this page. If not, try publishing again.",
      };
    }
  }

  // Persist the externalPostId with up to 3 retries
  const publishedAt = new Date();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await db
        .update(socialPostsTable)
        .set({ status: "published", publishedAt, externalPostId, publishingAt: null })
        .where(eq(socialPostsTable.id, postId));
      return { ok: true, externalPostId, publishedAt };
    } catch (dbErr) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 200 * attempt));
      } else {
        log.error(
          { dbErr, postId, externalPostId },
          "CRITICAL: post published to Meta but DB update failed after 3 attempts — externalPostId not persisted",
        );
        return {
          ok: false,
          rollback: false,
          message:
            "Your post was published to Meta but we could not save the confirmation. " +
            "Refresh this page — if the post still shows as unpublished, contact support.",
          externalPostId,
        };
      }
    }
  }

  return { ok: false, rollback: false, message: "Unexpected error in publish retry loop" };
}

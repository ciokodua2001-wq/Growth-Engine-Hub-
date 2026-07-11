/**
 * Integration tests for recoverStuckPublishingPosts.
 *
 * Uses the real Postgres database so the WHERE predicate is tested against
 * actual SQL, not a mock. A dedicated test project is created in beforeAll
 * and deleted (cascading to all posts) in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@workspace/db";
import { projectsTable, socialPostsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { recoverStuckPublishingPosts } from "../stuckPublishRecovery.js";

// ---------------------------------------------------------------------------
// Test project — created once, all posts cascade-delete with it in afterAll
// ---------------------------------------------------------------------------
let testProjectId: number;

beforeAll(async () => {
  const [project] = await db
    .insert(projectsTable)
    .values({
      name: "__test_stuck_publish_recovery__",
      websiteUrl: "https://test.invalid",
      status: "active",
      plan: "trial",
    })
    .returning({ id: projectsTable.id });
  testProjectId = project.id;
});

afterAll(async () => {
  await db.delete(projectsTable).where(eq(projectsTable.id, testProjectId));
});

// Clean up all social posts for this project between tests
beforeEach(async () => {
  await db.delete(socialPostsTable).where(eq(socialPostsTable.projectId, testProjectId));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertPost(overrides: {
  status: string;
  publishingAt?: Date | null;
  externalPostId?: string | null;
}) {
  const [row] = await db
    .insert(socialPostsTable)
    .values({
      projectId: testProjectId,
      platform: "facebook",
      caption: "test post",
      status: overrides.status,
      publishingAt: overrides.publishingAt ?? null,
      externalPostId: overrides.externalPostId ?? null,
    })
    .returning({ id: socialPostsTable.id });
  return row.id;
}

async function getPostStatus(id: number) {
  const [row] = await db
    .select({ status: socialPostsTable.status, publishingAt: socialPostsTable.publishingAt })
    .from(socialPostsTable)
    .where(eq(socialPostsTable.id, id));
  return row ?? null;
}

const THRESHOLD_MS = 15 * 60 * 1000; // match default
const OLD = new Date(Date.now() - THRESHOLD_MS - 60_000); // 1 min past threshold
const RECENT = new Date(Date.now() - 60_000);              // 1 min ago (within threshold)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("recoverStuckPublishingPosts", () => {
  it("resets a publishing post with publishingAt older than threshold", async () => {
    const id = await insertPost({ status: "publishing", publishingAt: OLD });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(1);
    const post = await getPostStatus(id);
    expect(post?.status).toBe("draft");
    expect(post?.publishingAt).toBeNull();
  });

  it("does NOT reset a publishing post with recent publishingAt (within threshold)", async () => {
    const id = await insertPost({ status: "publishing", publishingAt: RECENT });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(0);
    const post = await getPostStatus(id);
    expect(post?.status).toBe("publishing");
    expect(post?.publishingAt).not.toBeNull();
  });

  it("resets a publishing post with publishingAt IS NULL (legacy stuck row)", async () => {
    const id = await insertPost({ status: "publishing", publishingAt: null });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(1);
    const post = await getPostStatus(id);
    expect(post?.status).toBe("draft");
    expect(post?.publishingAt).toBeNull();
  });

  it("does NOT reset a post with status='published'", async () => {
    const id = await insertPost({ status: "published", publishingAt: OLD });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(0);
    const post = await getPostStatus(id);
    expect(post?.status).toBe("published");
  });

  it("does NOT reset a post with status='draft'", async () => {
    const id = await insertPost({ status: "draft", publishingAt: null });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(0);
    const post = await getPostStatus(id);
    expect(post?.status).toBe("draft");
  });

  it("resets only stale publishing posts when multiple statuses are present", async () => {
    const staleId = await insertPost({ status: "publishing", publishingAt: OLD });
    const legacyId = await insertPost({ status: "publishing", publishingAt: null });
    const recentId = await insertPost({ status: "publishing", publishingAt: RECENT });
    const publishedId = await insertPost({ status: "published", publishingAt: OLD });
    const draftId = await insertPost({ status: "draft", publishingAt: null });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(2); // stale + legacy

    expect((await getPostStatus(staleId))?.status).toBe("draft");
    expect((await getPostStatus(legacyId))?.status).toBe("draft");
    expect((await getPostStatus(recentId))?.status).toBe("publishing");
    expect((await getPostStatus(publishedId))?.status).toBe("published");
    expect((await getPostStatus(draftId))?.status).toBe("draft");
  });

  it("returns 0 and changes nothing when no posts are stuck", async () => {
    await insertPost({ status: "draft", publishingAt: null });
    await insertPost({ status: "published", publishingAt: null });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(0);
  });

  it("clears publishingAt to NULL on recovery", async () => {
    const id = await insertPost({ status: "publishing", publishingAt: OLD });

    await recoverStuckPublishingPosts(THRESHOLD_MS);

    const post = await getPostStatus(id);
    expect(post?.publishingAt).toBeNull();
  });

  // externalPostId guard — posts that have an externalPostId already have been
  // successfully published to Meta. Resetting them to "draft" would erase the ID
  // and cause a duplicate post on retry.
  it("does NOT reset a publishing post that already has an externalPostId (old publishingAt)", async () => {
    const id = await insertPost({
      status: "publishing",
      publishingAt: OLD,
      externalPostId: "fb_post_12345",
    });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(0);
    const post = await getPostStatus(id);
    expect(post?.status).toBe("publishing"); // stays put — Guard 1 will handle it on retry
  });

  it("does NOT reset a publishing post with externalPostId and NULL publishingAt (legacy)", async () => {
    const id = await insertPost({
      status: "publishing",
      publishingAt: null,
      externalPostId: "fb_post_67890",
    });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(0);
    const post = await getPostStatus(id);
    expect(post?.status).toBe("publishing");
  });

  it("resets publishing posts without externalPostId but skips those with one", async () => {
    const stuckId = await insertPost({ status: "publishing", publishingAt: OLD, externalPostId: null });
    const publishedToMetaId = await insertPost({
      status: "publishing",
      publishingAt: OLD,
      externalPostId: "fb_post_abc",
    });

    const count = await recoverStuckPublishingPosts(THRESHOLD_MS);

    expect(count).toBe(1); // only the one without externalPostId
    expect((await getPostStatus(stuckId))?.status).toBe("draft");
    expect((await getPostStatus(publishedToMetaId))?.status).toBe("publishing");
  });
});

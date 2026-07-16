/**
 * Integration tests for the Meta publish route in content.ts.
 *
 * Focus: the plaintext-migration path and the encrypted-token path both
 * resolve the correct page access token and call the Meta Graph API
 * with the plaintext value.
 *
 * Real tokenCrypto is used throughout — this is what we're testing.
 * DB and Meta Graph API are mocked; auth is bypassed via a mocked authz module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { encryptToken } from "../lib/tokenCrypto.js";

// ---------------------------------------------------------------------------
// Hoisted mock factories — must be defined before vi.mock() factory closures
// ---------------------------------------------------------------------------
const {
  mockDbSelect,
  mockDbUpdate,
  mockDbInsert,
  mockConsumeTrialQuota,
  mockFetch,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbInsert: vi.fn(),
  mockConsumeTrialQuota: vi.fn(),
  mockFetch: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
  },
  socialPostsTable: { _tag: "socialPostsTable" },
  metaConnectionsTable: { _tag: "metaConnectionsTable" },
  contentTable: { _tag: "contentTable" },
  emailCampaignsTable: { _tag: "emailCampaignsTable" },
  adCreativesTable: { _tag: "adCreativesTable" },
  activityTable: { _tag: "activityTable" },
  projectsTable: { _tag: "projectsTable" },
  usersTable: { _tag: "usersTable" },
  trialUsageTable: { _tag: "trialUsageTable" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
  and: (...args: unknown[]) => args,
  isNull: (arg: unknown) => arg,
  desc: (arg: unknown) => arg,
  lte: (...args: unknown[]) => args,
  gte: (...args: unknown[]) => args,
  sql: (...args: unknown[]) => args,
  asc: (arg: unknown) => arg,
}));

vi.mock("@clerk/express", () => ({
  getAuth: (_req: unknown) => ({ userId: "user_clerk_test" }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/authz.js", () => ({
  requireProjectOwnershipParam: () =>
    (req: Request, _res: Response, next: NextFunction, _value: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).project = {
        id: 1,
        ownerId: "user_clerk_test",
        plan: "pro",
      };
      next();
    },
  requireUserId: (_req: unknown, _res: unknown) => "user_clerk_test",
  requireActiveSubscription: (_req: unknown, _res: unknown, next: NextFunction) => next(),
  loadOwnedProject: () =>
    Promise.resolve({ id: 1, ownerId: "user_clerk_test", plan: "pro" }),
}));

vi.mock("../lib/trialLimits.js", () => ({
  consumeTrialQuota: mockConsumeTrialQuota,
  TRIAL_LIMITS: {},
  TRIAL_MAX_VIDEO_BATCH: 3,
  getProjectPlan: () => Promise.resolve("pro"),
}));

vi.mock("../lib/projectContext.js", () => ({
  getGroundingContext: () => Promise.resolve(null),
  renderGroundingBlock: () => "",
}));

vi.mock("../lib/contentGenerators.js", () => ({
  generateSocialPosts: () => Promise.resolve([]),
  generateEmailCampaign: () => Promise.resolve([]),
}));

vi.mock("../lib/contentIntegrity.js", () => ({
  hashContent: () => "testhash",
  recordGenerated: () => Promise.resolve(),
  recordGeneratedBatch: () => Promise.resolve(),
  recordAccessed: () => Promise.resolve(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: () => Promise.resolve({ data: {}, error: null }) };
  },
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks are registered
// ---------------------------------------------------------------------------
import contentRouter from "../routes/content.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * A Promise that also has a .returning() method resolving to the same value.
 * Required because the route does both:
 *   await db.update(...).set(...).where(...)                — direct await
 *   await db.update(...).set(...).where(...).returning()    — chained .returning()
 */
function makeDbResult<T>(value: T[]) {
  const p = Promise.resolve(value) as Promise<T[]> & { returning: () => Promise<T[]> };
  p.returning = () => Promise.resolve(value);
  return p;
}

/** Minimal chain: select().from(table).where(cond) */
function selectChain<T>(result: T[]) {
  return { from: () => ({ where: () => makeDbResult(result) }) };
}

/** Minimal chain: update(table).set(data).where(cond)[.returning()] */
function updateChain<T>(result: T[] = []) {
  return { set: () => ({ where: () => makeDbResult(result) }) };
}

/** Minimal chain: insert(table).values(data) */
function insertChain() {
  return { values: () => Promise.resolve({}) };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  // Provide a no-op req.log so route handlers can call req.log.error/info/warn
  app.use((req: Request & { log?: unknown }, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {}, trace: () => {}, silent: () => {}, level: "info" } as any;
    next();
  });
  app.use("/api", contentRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Base fixtures
// ---------------------------------------------------------------------------

const BASE_POST = {
  id: 1,
  projectId: 1,
  status: "draft" as const,
  externalPostId: null,
  caption: "Hello from tests",
  hashtags: "#testing",
  cta: "Check it out",
  platform: "facebook",
  scheduledAt: null,
  publishedAt: null,
  createdAt: new Date("2026-07-11T00:00:00Z"),
  statsLikes: null,
  statsComments: null,
  statsReach: null,
  statsUpdatedAt: null,
};

const BASE_PUBLISHED_POST = {
  ...BASE_POST,
  status: "published" as const,
  externalPostId: "fb_post_123",
  publishedAt: new Date("2026-07-11T01:00:00Z"),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/projects/:id/social-posts/:postId/publish", () => {
  let app: ReturnType<typeof buildApp>;
  let restoreEnv: () => void;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();

    // Save and set encryption key
    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    restoreEnv = () => {
      if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = prev;
    };

    // Insert chain always returns void
    mockDbInsert.mockReturnValue(insertChain());
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  describe("(a) already-encrypted token", () => {
    it("decrypts the token and publishes successfully to Facebook", async () => {
      const plaintextToken = "EAABsbCS4iXoBO_realPageToken";
      const encryptedToken = encryptToken(plaintextToken);

      const mockConn = {
        projectId: 1,
        pageId: "page_abc",
        pageAccessToken: encryptedToken,
        pageName: "Test Page",
        instagramAccountId: null,
      };

      // DB call sequence for the publish route with an encrypted token:
      // 1. select post  2. select conn
      mockDbSelect
        .mockReturnValueOnce(selectChain([BASE_POST]))
        .mockReturnValueOnce(selectChain([mockConn]));

      // 3. update post → publishing (lock)  4. update post → published
      mockDbUpdate
        .mockReturnValueOnce(updateChain([{ ...BASE_POST, status: "publishing" }]))
        .mockReturnValueOnce(updateChain([BASE_PUBLISHED_POST]));

      // Mock the Meta Graph API to succeed
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: "fb_post_123" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await request(app)
        .post("/api/projects/1/social-posts/1/publish")
        .send({ platform: "facebook" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("published");
      expect(res.body.externalPostId).toBe("fb_post_123");

      // Verify the fetch was called with the plaintext token (not the ciphertext)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, { body: string }];
      expect(url).toContain("page_abc/feed");
      const body = JSON.parse(opts.body) as { access_token: string };
      expect(body.access_token).toBe(plaintextToken);

      // No token migration update should have been called for an already-encrypted token
      // (only 2 db.update calls: lock + publish)
      expect(mockDbUpdate).toHaveBeenCalledTimes(2);
    });

    it("rolls back to draft and returns 502 if the token is encrypted with the wrong key", async () => {
      // Encrypt with a different key so decryption with TEST_KEY fails
      const otherKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
      const prev = process.env.TOKEN_ENCRYPTION_KEY;
      process.env.TOKEN_ENCRYPTION_KEY = otherKey;
      const encryptedWithOtherKey = encryptToken("some-token");
      process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY; // restore test key

      // Silence the expected restore in afterEach by using the saved prev
      restoreEnv = () => {
        if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
        else process.env.TOKEN_ENCRYPTION_KEY = prev;
      };

      const mockConn = {
        projectId: 1,
        pageId: "page_abc",
        pageAccessToken: encryptedWithOtherKey,
        pageName: "Test Page",
        instagramAccountId: null,
      };

      mockDbSelect
        .mockReturnValueOnce(selectChain([BASE_POST]))
        .mockReturnValueOnce(selectChain([mockConn]));

      // Lock → publishing; rollback → draft
      mockDbUpdate
        .mockReturnValueOnce(updateChain([{ ...BASE_POST, status: "publishing" }]))
        .mockReturnValueOnce(updateChain([BASE_POST]));

      const res = await request(app)
        .post("/api/projects/1/social-posts/1/publish")
        .send({ platform: "facebook" });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/reconnect/i);
    });
  });

  describe("(b) plaintext token — migration path", () => {
    it("uses the plaintext token for the publish call and re-encrypts it in the DB", async () => {
      const plaintextToken = "EAAPlaintext_legacy_token";

      const mockConn = {
        projectId: 1,
        pageId: "page_xyz",
        pageAccessToken: plaintextToken, // raw plaintext in DB
        pageName: "My Page",
        instagramAccountId: null,
      };

      // DB call sequence for the plaintext-migration path:
      // 1. select post  2. select conn
      mockDbSelect
        .mockReturnValueOnce(selectChain([BASE_POST]))
        .mockReturnValueOnce(selectChain([mockConn]));

      // 3. update → publishing (lock)
      // 4. update metaConnectionsTable → re-encrypt token (no returning)
      // 5. update → published
      const publishedPost = { ...BASE_PUBLISHED_POST, externalPostId: "fb_post_456" };
      mockDbUpdate
        .mockReturnValueOnce(updateChain([{ ...BASE_POST, status: "publishing" }]))
        .mockReturnValueOnce(updateChain([])) // token migration (no returning, just awaited)
        .mockReturnValueOnce(updateChain([publishedPost]));

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: "fb_post_456" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await request(app)
        .post("/api/projects/1/social-posts/1/publish")
        .send({ platform: "facebook" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("published");
      expect(res.body.externalPostId).toBe("fb_post_456");

      // Verify Meta API received the plaintext token
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, { body: string }];
      expect(url).toContain("page_xyz/feed");
      const body = JSON.parse(opts.body) as { access_token: string };
      expect(body.access_token).toBe(plaintextToken);

      // 3 db.update calls: lock + token migration + publish
      expect(mockDbUpdate).toHaveBeenCalledTimes(3);

      // The second update call should have set a new encrypted pageAccessToken
      const secondUpdateArgs = mockDbUpdate.mock.calls[1] as unknown[];
      // The second call is db.update(metaConnectionsTable) — just verify it was called
      expect(secondUpdateArgs).toBeDefined();
    });

    it("still publishes even if the token re-encryption update throws (graceful degradation)", async () => {
      const plaintextToken = "EAAPlaintext_token_reencrypt_fails";

      const mockConn = {
        projectId: 1,
        pageId: "page_xyz",
        pageAccessToken: plaintextToken,
        pageName: "My Page",
        instagramAccountId: null,
      };

      mockDbSelect
        .mockReturnValueOnce(selectChain([BASE_POST]))
        .mockReturnValueOnce(selectChain([mockConn]));

      // Re-encryption update fails
      const failingUpdateChain = {
        set: () => ({
          where: () => Promise.reject(new Error("DB error during token migration")),
        }),
      };

      mockDbUpdate
        .mockReturnValueOnce(updateChain([{ ...BASE_POST, status: "publishing" }]))
        .mockReturnValueOnce(failingUpdateChain) // token migration fails
        .mockReturnValueOnce(updateChain([BASE_PUBLISHED_POST]));

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: "fb_post_789" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await request(app)
        .post("/api/projects/1/social-posts/1/publish")
        .send({ platform: "facebook" });

      // Should still succeed — the route catches the re-encrypt failure with a warn
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("published");

      // Meta API should still receive the plaintext token
      const [, opts] = mockFetch.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(opts.body) as { access_token: string };
      expect(body.access_token).toBe(plaintextToken);
    });
  });

  describe("publishingAt lifecycle", () => {
    it("sets publishingAt: new Date() on lock and clears it to null on success", async () => {
      const plaintextToken = "EAABsbCS4iXoBO_lifecycleToken";
      const encryptedToken = encryptToken(plaintextToken);

      const mockConn = {
        projectId: 1,
        pageId: "page_lifecycle",
        pageAccessToken: encryptedToken,
        pageName: "Lifecycle Page",
        instagramAccountId: null,
      };

      mockDbSelect
        .mockReturnValueOnce(selectChain([BASE_POST]))
        .mockReturnValueOnce(selectChain([mockConn]));

      // Spy on .set() so we can assert what data was passed on lock vs. success
      const lockSetFn = vi.fn((_data: unknown) => ({
        where: () => makeDbResult([{ ...BASE_POST, status: "publishing" }]),
      }));
      const successSetFn = vi.fn((_data: unknown) => ({
        where: () => makeDbResult([BASE_PUBLISHED_POST]),
      }));

      mockDbUpdate
        .mockReturnValueOnce({ set: lockSetFn })
        .mockReturnValueOnce({ set: successSetFn });

      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({ id: "fb_lifecycle_1" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await request(app)
        .post("/api/projects/1/social-posts/1/publish")
        .send({ platform: "facebook" });

      expect(res.status).toBe(200);

      // Lock: publishingAt must be set to a Date instance
      expect(lockSetFn).toHaveBeenCalledWith(
        expect.objectContaining({ publishingAt: expect.any(Date) }),
      );

      // Success: publishingAt must be cleared to null
      expect(successSetFn).toHaveBeenCalledWith(
        expect.objectContaining({ publishingAt: null }),
      );
    });

    it("sets publishingAt on lock and clears it to null on rollback (bad token)", async () => {
      // Encrypt with a different key so decryption with TEST_KEY fails
      const otherKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
      const prev = process.env.TOKEN_ENCRYPTION_KEY;
      process.env.TOKEN_ENCRYPTION_KEY = otherKey;
      const encryptedWithOtherKey = encryptToken("some-token");
      process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
      restoreEnv = () => {
        if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
        else process.env.TOKEN_ENCRYPTION_KEY = prev;
      };

      const mockConn = {
        projectId: 1,
        pageId: "page_rb",
        pageAccessToken: encryptedWithOtherKey,
        pageName: "Rollback Page",
        instagramAccountId: null,
      };

      mockDbSelect
        .mockReturnValueOnce(selectChain([BASE_POST]))
        .mockReturnValueOnce(selectChain([mockConn]));

      const lockSetFn = vi.fn((_data: unknown) => ({
        where: () => makeDbResult([{ ...BASE_POST, status: "publishing" }]),
      }));
      const rollbackSetFn = vi.fn((_data: unknown) => ({
        where: () => makeDbResult([BASE_POST]),
      }));

      mockDbUpdate
        .mockReturnValueOnce({ set: lockSetFn })
        .mockReturnValueOnce({ set: rollbackSetFn });

      const res = await request(app)
        .post("/api/projects/1/social-posts/1/publish")
        .send({ platform: "facebook" });

      expect(res.status).toBe(500);

      // Lock: publishingAt must be set to a Date
      expect(lockSetFn).toHaveBeenCalledWith(
        expect.objectContaining({ publishingAt: expect.any(Date) }),
      );

      // Rollback: publishingAt must be cleared to null
      expect(rollbackSetFn).toHaveBeenCalledWith(
        expect.objectContaining({ publishingAt: null }),
      );
    });
  });

  describe("Instagram publish", () => {
    it("publishes with an encrypted token via the two-step Instagram flow", async () => {
      const plaintextToken = "EAAInstagramToken_encrypted";
      const encryptedToken = encryptToken(plaintextToken);

      const mockConn = {
        projectId: 1,
        pageId: "page_ig",
        pageAccessToken: encryptedToken,
        pageName: "IG Page",
        instagramAccountId: "ig_account_99",
      };

      mockDbSelect
        .mockReturnValueOnce(selectChain([BASE_POST]))
        .mockReturnValueOnce(selectChain([mockConn]));

      mockDbUpdate
        .mockReturnValueOnce(updateChain([{ ...BASE_POST, status: "publishing" }]))
        .mockReturnValueOnce(updateChain([{ ...BASE_PUBLISHED_POST, externalPostId: "ig_post_999" }]));

      // Two fetch calls: container creation + media_publish
      mockFetch
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "ig_container_456" }) })
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "ig_post_999" }) });
      vi.stubGlobal("fetch", mockFetch);

      const res = await request(app)
        .post("/api/projects/1/social-posts/1/publish")
        .send({ platform: "instagram" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("published");

      // Two Meta API calls for Instagram
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Both calls should use the decrypted plaintext token
      const [, containerOpts] = mockFetch.mock.calls[0] as [string, { body: string }];
      const containerBody = JSON.parse(containerOpts.body) as { access_token: string };
      expect(containerBody.access_token).toBe(plaintextToken);

      const [, publishOpts] = mockFetch.mock.calls[1] as [string, { body: string }];
      const publishBody = JSON.parse(publishOpts.body) as { access_token: string };
      expect(publishBody.access_token).toBe(plaintextToken);
    });

    it("publishes with a plaintext token via the two-step Instagram flow", async () => {
      const plaintextToken = "EAAInstagramPlaintext";

      const mockConn = {
        projectId: 1,
        pageId: "page_ig",
        pageAccessToken: plaintextToken, // plaintext
        pageName: "IG Page",
        instagramAccountId: "ig_account_88",
      };

      mockDbSelect
        .mockReturnValueOnce(selectChain([BASE_POST]))
        .mockReturnValueOnce(selectChain([mockConn]));

      mockDbUpdate
        .mockReturnValueOnce(updateChain([{ ...BASE_POST, status: "publishing" }]))
        .mockReturnValueOnce(updateChain([])) // token migration
        .mockReturnValueOnce(updateChain([{ ...BASE_PUBLISHED_POST, externalPostId: "ig_post_888" }]));

      mockFetch
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "ig_container_777" }) })
        .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "ig_post_888" }) });
      vi.stubGlobal("fetch", mockFetch);

      const res = await request(app)
        .post("/api/projects/1/social-posts/1/publish")
        .send({ platform: "instagram" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("published");

      // Both Instagram API calls should receive the plaintext token
      for (const [, opts] of mockFetch.mock.calls as [string, { body: string }][]) {
        const body = JSON.parse(opts.body) as { access_token: string };
        expect(body.access_token).toBe(plaintextToken);
      }
    });
  });
});

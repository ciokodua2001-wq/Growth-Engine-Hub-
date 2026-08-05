/**
 * Integration tests for the GET /projects/:id/social-posts/:postId/stats route.
 *
 * Focus:
 *   - Instagram posts return likes + comments with reach === null (reach is
 *     unavailable via the flat Instagram Media API endpoint)
 *   - Facebook posts return likes + comments + reach from the insights edge
 *   - Facebook posts where the insights endpoint omits reach still return 200
 *     with reach === null (graceful degradation)
 *   - Graph API errors produce 502 responses
 *   - Cached stats are served when no Meta connection is present
 *
 * DB and Meta Graph API are mocked; real tokenCrypto is used for the
 * token-decryption path; auth is bypassed via a mocked authz module.
 *
 * Note on StatsPanel (UI): The React component in
 * artifacts/growthforge/src/pages/project/social.tsx already guards the reach
 * metric with `{post.statsReach != null && (...)}`, so when the API returns
 * reach: null for Instagram posts the "reach" metric is correctly hidden
 * without any additional UI changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { encryptToken } from "../lib/tokenCrypto.js";

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------
const {
  mockDbSelect,
  mockDbUpdate,
  mockDbInsert,
  mockFetch,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbInsert: vi.fn(),
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

vi.mock("../lib/supabaseAuth.js", () => ({
  getAuth: (_req: unknown) => ({ userId: "user_clerk_test", sessionClaims: null }),
  supabaseAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
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
  consumeTrialQuota: vi.fn(),
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

function makeDbResult<T>(value: T[]) {
  const p = Promise.resolve(value) as Promise<T[]> & { returning: () => Promise<T[]> };
  p.returning = () => Promise.resolve(value);
  return p;
}

function selectChain<T>(result: T[]) {
  return { from: () => ({ where: () => makeDbResult(result) }) };
}

function updateChain<T>(result: T[] = []) {
  return { set: () => ({ where: () => makeDbResult(result) }) };
}

function insertChain() {
  return { values: () => Promise.resolve({}) };
}

function buildApp() {
  const app = express();
  app.use(express.json());
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

const BASE_IG_POST = {
  id: 1,
  projectId: 1,
  status: "published" as const,
  externalPostId: "17854360229135492",
  platform: "instagram" as const,
  caption: "Test Instagram post",
  hashtags: "#test",
  cta: "Check it out",
  scheduledAt: null,
  publishedAt: new Date("2026-07-11T01:00:00Z"),
  publishingAt: null,
  createdAt: new Date("2026-07-11T00:00:00Z"),
  statsLikes: null,
  statsComments: null,
  statsReach: null,
  statsUpdatedAt: null,
};

const BASE_FB_POST = {
  ...BASE_IG_POST,
  externalPostId: "123456789012345_987654321098765",
  platform: "facebook" as const,
};

const BASE_CONN = {
  projectId: 1,
  pageId: "page_abc",
  pageAccessToken: "EAAPlaintextToken_for_testing",
  pageName: "Test Page",
  instagramAccountId: "ig_account_99",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/projects/:id/social-posts/:postId/stats — Instagram", () => {
  let app: ReturnType<typeof buildApp>;
  let restoreEnv: () => void;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue(insertChain());

    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    restoreEnv = () => {
      if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = prev;
    };
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("returns likes and comments for a published Instagram post, with reach null", async () => {
    const conn = { ...BASE_CONN, pageAccessToken: encryptToken(BASE_CONN.pageAccessToken) };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_IG_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockDbUpdate.mockReturnValue(updateChain([]));

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ like_count: 42, comments_count: 7 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(200);
    expect(res.body.likes).toBe(42);
    expect(res.body.comments).toBe(7);
    expect(res.body.reach).toBeNull();
    expect(res.body.postId).toBe(1);
    expect(res.body.externalPostId).toBe("17854360229135492");
    expect(res.body.statsUpdatedAt).toBeDefined();

    // Only one fetch call — no separate insights endpoint for Instagram
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("17854360229135492");
    expect(url).toContain("like_count");
    expect(url).toContain("comments_count");
    expect(url).not.toContain("/insights");
  });

  it("returns reach: null when the Instagram API omits both like_count and comments_count", async () => {
    const conn = { ...BASE_CONN, pageAccessToken: encryptToken(BASE_CONN.pageAccessToken) };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_IG_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockDbUpdate.mockReturnValue(updateChain([]));

    // API returns an empty object (e.g. very new post with no engagement yet)
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(200);
    expect(res.body.likes).toBeNull();
    expect(res.body.comments).toBeNull();
    expect(res.body.reach).toBeNull();
  });

  it("returns 502 when the Instagram Graph API returns an error object", async () => {
    const conn = { ...BASE_CONN, pageAccessToken: encryptToken(BASE_CONN.pageAccessToken) };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_IG_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          error: { message: "Invalid OAuth access token.", code: 190 },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/OAuth/i);
  });

  it("caches the fetched stats on the post row in the database", async () => {
    const conn = { ...BASE_CONN, pageAccessToken: encryptToken(BASE_CONN.pageAccessToken) };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_IG_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockDbUpdate.mockReturnValue(updateChain([]));

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ like_count: 10, comments_count: 3 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await request(app).get("/api/projects/1/social-posts/1/stats");

    // One db.update call — caching the stats
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
  });

  it("uses the decrypted plaintext token in the Graph API call", async () => {
    const plaintext = "EAAInstagramRealToken";
    const conn = { ...BASE_CONN, pageAccessToken: encryptToken(plaintext) };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_IG_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockDbUpdate.mockReturnValue(updateChain([]));

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ like_count: 5, comments_count: 1 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await request(app).get("/api/projects/1/social-posts/1/stats");

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(`access_token=${plaintext}`);
  });

  it("(b) plaintext token — passes through directly to the Instagram Graph API", async () => {
    const plaintextToken = "EAAInstagramPlaintext_legacy";
    // Store raw plaintext in DB (non-encrypted format — !isEncryptedFormat branch)
    const conn = { ...BASE_CONN, pageAccessToken: plaintextToken };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_IG_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockDbUpdate.mockReturnValue(updateChain([]));

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ like_count: 20, comments_count: 4 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(200);
    expect(res.body.likes).toBe(20);
    expect(res.body.comments).toBe(4);
    expect(res.body.reach).toBeNull();

    // The raw plaintext token must reach the Graph API unchanged
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain(`access_token=${plaintextToken}`);
  });
});

describe("GET /api/projects/:id/social-posts/:postId/stats — Facebook", () => {
  let app: ReturnType<typeof buildApp>;
  let restoreEnv: () => void;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue(insertChain());

    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    restoreEnv = () => {
      if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = prev;
    };
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("(a) encrypted token — decrypts and fetches Facebook stats successfully", async () => {
    const plaintextToken = "EAAFacebookReal_encryptedToken";
    const encryptedToken = encryptToken(plaintextToken);
    const conn = { ...BASE_CONN, pageAccessToken: encryptedToken };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_FB_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockDbUpdate.mockReturnValue(updateChain([]));

    // Call 1: engagement fields
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          likes: { summary: { total_count: 100 } },
          comments: { summary: { total_count: 15 } },
        }),
    });
    // Call 2: insights (reach)
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          data: [{ values: [{ value: 2500 }] }],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(200);
    expect(res.body.likes).toBe(100);
    expect(res.body.comments).toBe(15);
    expect(res.body.reach).toBe(2500);

    // Two fetch calls for Facebook: engagement + insights
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [engUrl] = mockFetch.mock.calls[0] as [string];
    const [insightsUrl] = mockFetch.mock.calls[1] as [string];
    expect(engUrl).toContain("likes.summary(true)");
    expect(insightsUrl).toContain("/insights");
    expect(insightsUrl).toContain("post_impressions_unique");

    // Both Graph API calls must use the decrypted plaintext token (not the ciphertext)
    expect(engUrl).toContain(`access_token=${plaintextToken}`);
    expect(insightsUrl).toContain(`access_token=${plaintextToken}`);
  });

  it("returns reach: null when the Facebook insights endpoint does not include data", async () => {
    const conn = { ...BASE_CONN, pageAccessToken: encryptToken(BASE_CONN.pageAccessToken) };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_FB_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockDbUpdate.mockReturnValue(updateChain([]));

    // Engagement succeeds
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          likes: { summary: { total_count: 50 } },
          comments: { summary: { total_count: 8 } },
        }),
    });
    // Insights returns an error — reach should silently be null
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          error: { message: "Unsupported get request for insights." },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(200);
    expect(res.body.likes).toBe(50);
    expect(res.body.comments).toBe(8);
    expect(res.body.reach).toBeNull();
  });

  it("returns 502 when the Facebook engagement endpoint returns a Graph API error", async () => {
    const conn = { ...BASE_CONN, pageAccessToken: encryptToken(BASE_CONN.pageAccessToken) };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_FB_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          error: { message: "Page not found.", code: 100 },
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Page not found/i);
  });

  it("(b) plaintext token — passes through directly to the Facebook Graph API", async () => {
    const plaintextToken = "EAAFacebookPlaintext_legacy";
    // Store raw plaintext in DB (non-encrypted format — !isEncryptedFormat branch)
    const conn = { ...BASE_CONN, pageAccessToken: plaintextToken };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_FB_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    mockDbUpdate.mockReturnValue(updateChain([]));

    // Engagement call
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          likes: { summary: { total_count: 77 } },
          comments: { summary: { total_count: 5 } },
        }),
    });
    // Insights call
    mockFetch.mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          data: [{ values: [{ value: 800 }] }],
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(200);
    expect(res.body.likes).toBe(77);
    expect(res.body.comments).toBe(5);
    expect(res.body.reach).toBe(800);

    // Both Graph API calls must carry the raw plaintext token unchanged
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [engUrl] = mockFetch.mock.calls[0] as [string];
    const [insightsUrl] = mockFetch.mock.calls[1] as [string];
    expect(engUrl).toContain(`access_token=${plaintextToken}`);
    expect(insightsUrl).toContain(`access_token=${plaintextToken}`);
  });
});

describe("GET /api/projects/:id/social-posts/:postId/stats — edge cases", () => {
  let app: ReturnType<typeof buildApp>;
  let restoreEnv: () => void;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue(insertChain());

    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    restoreEnv = () => {
      if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = prev;
    };
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("returns cached stats when no Meta connection is present", async () => {
    const cachedPost = {
      ...BASE_IG_POST,
      statsLikes: 30,
      statsComments: 4,
      statsReach: null, // Instagram — no reach
      statsUpdatedAt: new Date("2026-07-11T02:00:00Z"),
    };

    mockDbSelect
      .mockReturnValueOnce(selectChain([cachedPost]))
      .mockReturnValueOnce(selectChain([])); // no connection

    vi.stubGlobal("fetch", mockFetch);

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(200);
    expect(res.body.likes).toBe(30);
    expect(res.body.comments).toBe(4);
    expect(res.body.reach).toBeNull();
    expect(res.body.cached).toBe(true);

    // No Graph API call when serving cached stats
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 404 when no connection and no cached stats exist", async () => {
    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_IG_POST]))
      .mockReturnValueOnce(selectChain([])); // no connection

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/meta account/i);
  });

  it("returns 400 for a post that is not yet published", async () => {
    const draftPost = { ...BASE_IG_POST, status: "draft" as const, externalPostId: null };

    mockDbSelect.mockReturnValueOnce(selectChain([draftPost]));

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not published/i);
  });

  it("returns 500 when the token is encrypted with the wrong key", async () => {
    const otherKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = otherKey;
    const badToken = encryptToken("some-ig-token");
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    restoreEnv = () => {
      if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = prev;
    };

    const conn = { ...BASE_CONN, pageAccessToken: badToken };

    mockDbSelect
      .mockReturnValueOnce(selectChain([BASE_IG_POST]))
      .mockReturnValueOnce(selectChain([conn]));

    const res = await request(app).get("/api/projects/1/social-posts/1/stats");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/reconnect/i);
  });
});

// ---------------------------------------------------------------------------
// End-to-end flow: Instagram publish → stats retrieval in a single scenario
// ---------------------------------------------------------------------------

describe("Instagram publish → stats: full flow integration", () => {
  let app: ReturnType<typeof buildApp>;
  let restoreEnv: () => void;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();

    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    restoreEnv = () => {
      if (prev === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = prev;
    };
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("publishes an Instagram post then returns likes, comments, and null reach from the stats endpoint", async () => {
    const plaintextToken = "EAAInstagramEndToEndToken";
    const encryptedToken = encryptToken(plaintextToken);
    const igExternalId = "17851234567890123";

    const conn = {
      projectId: 1,
      pageId: "page_e2e",
      pageAccessToken: encryptedToken,
      pageName: "E2E Page",
      instagramAccountId: "ig_acct_e2e",
    };

    // Draft post — state before publish (must be draft with no externalPostId)
    const draftPost = {
      ...BASE_IG_POST,
      id: 2,
      status: "draft" as const,
      externalPostId: null,
      publishedAt: null,
      publishingAt: null,
    };

    // Published state — what the DB returns after the publish update
    const publishedPost = {
      ...draftPost,
      status: "published" as const,
      externalPostId: igExternalId,
      publishedAt: new Date("2026-07-11T03:00:00Z"),
      publishingAt: null,
    };

    // -----------------------------------------------------------------------
    // Publish route DB/fetch call sequence (encrypted token, Instagram):
    //   Select 1: get post  (draft)
    //   Update 1: lock → publishing  (returns locked row)
    //   Select 2: get connection
    //   Fetch 1:  POST /ig_acct_e2e/media  → { id: "ig_container_abc" }
    //   Fetch 2:  POST /ig_acct_e2e/media_publish → { id: igExternalId }
    //   Update 2: mark published  (returns publishedPost)
    //   Insert 1: activity log  (mocked globally in beforeEach)
    //
    // Stats route DB/fetch call sequence:
    //   Select 3: get post  (published, with externalPostId)
    //   Select 4: get connection
    //   Fetch 3:  GET /{igExternalId}?fields=like_count,comments_count
    //   Update 3: cache stats
    // -----------------------------------------------------------------------

    mockDbSelect
      .mockReturnValueOnce(selectChain([draftPost]))      // publish: get post
      .mockReturnValueOnce(selectChain([conn]))            // publish: get conn
      .mockReturnValueOnce(selectChain([publishedPost]))  // stats:   get post
      .mockReturnValueOnce(selectChain([conn]));           // stats:   get conn

    mockDbUpdate
      .mockReturnValueOnce(updateChain([{ ...draftPost, status: "publishing" }])) // lock
      .mockReturnValueOnce(updateChain([publishedPost]))                           // mark published
      .mockReturnValueOnce(updateChain([]));                                        // cache stats

    mockDbInsert.mockReturnValue(insertChain());

    // Fetch mocks — publish: 2 calls, stats: 1 call
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve({ id: "ig_container_abc" }) }) // container
      .mockResolvedValueOnce({ json: () => Promise.resolve({ id: igExternalId }) })        // media_publish
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ like_count: 42, comments_count: 7 }),                // stats
      });
    vi.stubGlobal("fetch", mockFetch);

    // Step 1 — Publish the Instagram post
    const publishRes = await request(app)
      .post("/api/projects/1/social-posts/2/publish")
      .send({ platform: "instagram" });

    expect(publishRes.status).toBe(200);
    expect(publishRes.body.status).toBe("published");
    expect(publishRes.body.externalPostId).toBe(igExternalId);

    // Both Instagram Graph API calls for the publish step should have used the
    // decrypted plaintext token
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, containerOpts] = mockFetch.mock.calls[0] as [string, { body: string }];
    const [, publishOpts] = mockFetch.mock.calls[1] as [string, { body: string }];
    expect((JSON.parse(containerOpts.body) as { access_token: string }).access_token).toBe(plaintextToken);
    expect((JSON.parse(publishOpts.body) as { access_token: string }).access_token).toBe(plaintextToken);

    // Step 2 — Retrieve stats for the just-published post
    const statsRes = await request(app).get("/api/projects/1/social-posts/2/stats");

    expect(statsRes.status).toBe(200);
    expect(statsRes.body.likes).toBe(42);
    expect(statsRes.body.comments).toBe(7);
    // Instagram reach is not available via the flat Media API — must be null
    expect(statsRes.body.reach).toBeNull();
    expect(statsRes.body.externalPostId).toBe(igExternalId);
    expect(statsRes.body.statsUpdatedAt).toBeDefined();

    // Stats fetch should have called the Instagram Media API (not the insights edge)
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [statsUrl] = mockFetch.mock.calls[2] as [string];
    expect(statsUrl).toContain(igExternalId);
    expect(statsUrl).toContain("like_count");
    expect(statsUrl).toContain("comments_count");
    expect(statsUrl).not.toContain("/insights");
    // Token should be the decrypted plaintext value
    expect(statsUrl).toContain(`access_token=${plaintextToken}`);
  });
});

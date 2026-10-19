/**
 * Authenticated HTTP-level cross-user authorization tests (IDOR acceptance).
 *
 * Unlike ownershipScoping.test.ts (which mocks the DB and asserts the generated
 * WHERE clause), this suite exercises the FULL authorization chain against the
 * real Postgres DB and the real `requireProjectOwnershipParam` / `loadAccessibleProject`
 * from authz.ts. Only `supabaseAuth.getAuth` is stubbed to a fixed user id (User A),
 * and the credential-heavy AI/image/email deps are mocked so the routers load
 * without real API keys.
 *
 * It proves, over HTTP, that User A cannot read/update/delete User B's content
 * (even with a valid content id), cannot edit User B's social post, and cannot
 * even reach User B's project - while User A's own resources still work.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { db, projectsTable, usersTable, contentTable, socialPostsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const { USER_A, USER_B } = vi.hoisted(() => ({
  USER_A: "__test_idor_user_a__",
  USER_B: "__test_idor_user_b__",
}));

// ── Stub ONLY auth identity; keep authz.js + @workspace/db + drizzle real ────
vi.mock("../lib/supabaseAuth.js", () => ({
  getAuth: () => ({ userId: USER_A, sessionClaims: null }),
  supabaseAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── Mock credential-heavy deps so the routers load without real API keys ────
vi.mock("../lib/trialLimits.js", () => ({
  consumeTrialQuota: vi.fn(),
  TRIAL_LIMITS: {},
  TRIAL_MAX_VIDEO_BATCH: 3,
  getProjectPlan: () => Promise.resolve("pro"),
}));
vi.mock("../lib/planLimits.js", () => ({
  consumeQuota: () => Promise.resolve({ allowed: true, message: "" }),
  meetsMinPlan: () => true,
  getQuotaRemaining: () => Promise.resolve(999),
}));
vi.mock("../lib/projectContext.js", () => ({
  getGroundingContext: () => Promise.resolve(null),
  renderGroundingBlock: () => "",
  projectIdentityLabel: () => "Test Business",
}));
vi.mock("../lib/contentGenerators.js", () => ({
  generateSocialPosts: () => Promise.resolve([]),
  generateEmailCampaign: () => Promise.resolve([]),
  generateContentPieces: () => Promise.resolve([]),
}));
vi.mock("../lib/contentIntegrity.js", () => ({
  hashContent: () => "testhash",
  recordGenerated: () => Promise.resolve(),
  recordGeneratedBatch: () => Promise.resolve(),
  recordAccessed: () => Promise.resolve(),
}));
vi.mock("../lib/tokenCrypto.js", () => ({
  encryptToken: () => "enc",
  decryptToken: () => "dec",
  isEncryptedFormat: () => false,
}));
vi.mock("../lib/metaPublisher.js", () => ({
  publishPostToMeta: () => Promise.resolve({}),
}));
vi.mock("@workspace/integrations-google-genai/image", () => ({
  generateImageBuffer: () => Promise.resolve(Buffer.from("")),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: () => Promise.resolve({ data: {}, error: null }),
      batch: { send: () => Promise.resolve({ data: {}, error: null }) },
    };
  },
}));

import contentRouter from "../routes/content.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────
let projectAId: number;
let projectBId: number;
let contentBId: number;
let socialPostBId: number;

beforeAll(async () => {
  // Idempotent cleanup from any prior interrupted run.
  await db.delete(projectsTable).where(eq(projectsTable.name, "__test_idor_project_b__"));
  await db.delete(projectsTable).where(eq(projectsTable.name, "__test_idor_project_a__"));
  await db.delete(usersTable).where(eq(usersTable.id, USER_A));
  await db.delete(usersTable).where(eq(usersTable.id, USER_B));

  await db.insert(usersTable).values({ id: USER_A, email: "__test_idor_a@invalid.test" });
  await db.insert(usersTable).values({ id: USER_B, email: "__test_idor_b@invalid.test" });

  const [pa] = await db
    .insert(projectsTable)
    .values({ name: "__test_idor_project_a__", ownerId: USER_A, status: "active", plan: "trial" })
    .returning({ id: projectsTable.id });
  projectAId = pa.id;

  const [pb] = await db
    .insert(projectsTable)
    .values({ name: "__test_idor_project_b__", ownerId: USER_B, status: "active", plan: "trial" })
    .returning({ id: projectsTable.id });
  projectBId = pb.id;

  const [cb] = await db
    .insert(contentTable)
    .values({ projectId: projectBId, type: "blog", title: "__test_idor_secret__", body: "user B secret" })
    .returning({ id: contentTable.id });
  contentBId = cb.id;

  const [sb] = await db
    .insert(socialPostsTable)
    .values({ projectId: projectBId, platform: "facebook", caption: "__test_idor_secret_post__" })
    .returning({ id: socialPostsTable.id });
  socialPostBId = sb.id;
});

afterAll(async () => {
  await db.delete(projectsTable).where(eq(projectsTable.name, "__test_idor_project_a__"));
  await db.delete(projectsTable).where(eq(projectsTable.name, "__test_idor_project_b__"));
  await db.delete(usersTable).where(eq(usersTable.id, USER_A));
  await db.delete(usersTable).where(eq(usersTable.id, USER_B));
});

function buildApp() {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((req: Request & { log?: unknown }, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info: () => {}, warn: () => {}, error: () => {} };
    next();
  });
  app.use(contentRouter);
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("authenticated cross-user authorization (HTTP + real DB)", () => {
  it("User A cannot READ User B's content even with a valid content id", async () => {
    const res = await request(buildApp()).get(`/projects/${projectAId}/content/${contentBId}`);
    expect(res.status).toBe(404);
  });

  it("User A cannot UPDATE User B's content", async () => {
    const res = await request(buildApp())
      .patch(`/projects/${projectAId}/content/${contentBId}`)
      .send({ title: "stolen" });
    expect(res.status).toBe(404);
  });

  it("User A cannot DELETE User B's content", async () => {
    const res = await request(buildApp()).delete(`/projects/${projectAId}/content/${contentBId}`);
    expect(res.status).toBe(404);
  });

  it("User A cannot EDIT User B's social post", async () => {
    const res = await request(buildApp())
      .patch(`/projects/${projectAId}/social-posts/${socialPostBId}`)
      .send({ caption: "stolen" });
    expect(res.status).toBe(404);
  });

  it("User A cannot even reach User B's project (ownership middleware 404s)", async () => {
    const res = await request(buildApp()).get(`/projects/${projectBId}/content/${contentBId}`);
    expect(res.status).toBe(404);
  });

  it("User A CAN read their own content (positive control)", async () => {
    const [own] = await db
      .insert(contentTable)
      .values({ projectId: projectAId, type: "blog", title: "__test_idor_own__", body: "own" })
      .returning({ id: contentTable.id });

    const res = await request(buildApp()).get(`/projects/${projectAId}/content/${own.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(own.id);

    await db.delete(contentTable).where(eq(contentTable.id, own.id));
  });

  it("User A CAN edit their own social post (positive control)", async () => {
    const [own] = await db
      .insert(socialPostsTable)
      .values({ projectId: projectAId, platform: "facebook", caption: "before" })
      .returning({ id: socialPostsTable.id });

    const res = await request(buildApp())
      .patch(`/projects/${projectAId}/social-posts/${own.id}`)
      .send({ caption: "after" });
    expect(res.status).toBe(200);
    expect(res.body.caption).toBe("after");

    await db.delete(socialPostsTable).where(eq(socialPostsTable.id, own.id));
  });
});

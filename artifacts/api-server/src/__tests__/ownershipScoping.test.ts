/**
 * Regression tests for cross-project resource-ownership enforcement (IDOR - P0).
 *
 * Proves that resource-by-id lookups are scoped to the authenticated project, so
 * User A (project 1) cannot read/modify/delete User B's resource even when a valid
 * resource id (999) is known.
 *
 * Auth is stubbed to project id=1; each request targets resource id 999. We assert
 * (1) the generated DB query's WHERE clause contains BOTH the resource id AND the
 * projectId scope, and (2) the route returns 404 (resource not found in the
 * caller's project), which prevents existence disclosure across tenants.
 *
 * DB is mocked; drizzle `eq`/`and` return their args so the WHERE shape is
 * inspectable. `@workspace/api-zod` is left real so param coercion runs for real.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------
const { capturedWheres, mockDb } = vi.hoisted(() => {
  const capturedWheres: unknown[][] = [];
  const select = vi.fn(() => ({
    from: () => ({
      where: (args: unknown) => {
        capturedWheres.push(args as unknown[]);
        return Promise.resolve([]);
      },
      orderBy: () => Promise.resolve([]),
    }),
  }));
  const update = vi.fn(() => ({
    set: () => ({
      where: (args: unknown) => {
        capturedWheres.push(args as unknown[]);
        return { returning: () => Promise.resolve([]) };
      },
    }),
  }));
  const del = vi.fn(() => ({
    where: (args: unknown) => {
      capturedWheres.push(args as unknown[]);
      return { returning: () => Promise.resolve([]) };
    },
  }));
  const insert = vi.fn(() => ({ values: () => Promise.resolve({}) }));
  return { capturedWheres, mockDb: { select, update, delete: del, insert } };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  db: mockDb,
  contentTable: { id: "content.id", projectId: "content.projectId" },
  socialPostsTable: { id: "social.id", projectId: "social.projectId" },
  emailCampaignsTable: { id: "email.id", projectId: "email.projectId" },
  adCreativesTable: { id: "ad.id", projectId: "ad.projectId" },
  activityTable: { _t: "activity" },
  metaConnectionsTable: { _t: "meta" },
  projectsTable: { id: "projects.id", plan: "projects.plan", brandingCompanyName: "projects.branding" },
  usersTable: { _t: "users" },
  trialUsageTable: { _t: "trialUsage" },
  campaignsTable: { id: "campaigns.id", projectId: "campaigns.projectId" },
  assetsTable: { id: "assets.id", projectId: "assets.projectId" },
  reportsTable: { id: "reports.id", projectId: "reports.projectId" },
  agentMessagesTable: { _t: "agentMessages" },
  competitorsTable: { id: "competitors.id", projectId: "competitors.projectId" },
  videosTable: { id: "videos.id", projectId: "videos.projectId" },
  connectedAdAccountsTable: { _t: "connectedAd" },
  seoBlogPostsTable: { id: "seoBlogPosts.id", projectId: "seoBlogPosts.projectId" },
  seoMetaTagsTable: { _t: "seoMeta" },
  seoSchemaMarkupTable: { _t: "seoSchema" },
  seoSitemapTable: { _t: "seoSitemap" },
  seoWatchdogTable: { _t: "seoWatchdog" },
  businessAnalysisTable: { _t: "bizAnalysis" },
  competitorReportTable: { _t: "competitorReport" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
  and: (...args: unknown[]) => args,
  isNull: (arg: unknown) => arg,
  desc: (arg: unknown) => arg,
  asc: (arg: unknown) => arg,
  lte: (...args: unknown[]) => args,
  gte: (...args: unknown[]) => args,
  sql: (...args: unknown[]) => args,
}));

vi.mock("../lib/supabaseAuth.js", () => ({
  getAuth: () => ({ userId: "userA", sessionClaims: null }),
  supabaseAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/authz.js", () => ({
  requireProjectOwnershipParam: () =>
    (req: Request, _res: Response, next: NextFunction, _value: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).project = { id: 1, ownerId: "userA", plan: "pro" };
      next();
    },
  requireUserId: () => "userA",
  requireActiveSubscription: (_req: unknown, _res: unknown, next: NextFunction) => next(),
  loadOwnedProject: () => Promise.resolve({ id: 1, ownerId: "userA", plan: "pro" }),
}));

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
  generateVideoBlueprints: () => Promise.resolve([]),
  generateAdCreatives: () => Promise.resolve([]),
}));

vi.mock("../lib/contentIntegrity.js", () => ({
  hashContent: () => "testhash",
  recordGenerated: () => Promise.resolve(),
  recordGeneratedBatch: () => Promise.resolve(),
  recordAccessed: () => Promise.resolve(),
}));

vi.mock("../lib/aiJson.js", () => ({
  generateJson: () => Promise.resolve({}),
  generateJsonFast: () => Promise.resolve({}),
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

vi.mock("pdfkit", () => ({
  default: class {
    pipe() { return this; }
    text() { return this; }
    end() {}
  },
}));

// ---------------------------------------------------------------------------
// Routers under test (import AFTER mocks registered)
// ---------------------------------------------------------------------------
import contentRouter from "../routes/content.js";
import campaignsRouter from "../routes/campaigns.js";
import videosRouter from "../routes/videos.js";
import competitorsRouter from "../routes/competitors.js";
import seoToolsRouter from "../routes/seo-tools.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildApp(router: any) {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use((req: Request & { log?: unknown }, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).log = { info: () => {}, warn: () => {}, error: () => {} };
    next();
  });
  app.use(router);
  return app;
}

function expectScoped(
  where: unknown,
  resourceMarker: string,
  projectMarker: string,
  resourceId: number,
  projectId: number,
) {
  const conds = where as unknown[][];
  expect(conds).toContainEqual([resourceMarker, resourceId]);
  expect(conds).toContainEqual([projectMarker, projectId]);
}

beforeEach(() => {
  capturedWheres.length = 0;
  mockDb.select.mockClear();
  mockDb.update.mockClear();
  mockDb.delete.mockClear();
  mockDb.insert.mockClear();
});

// ---------------------------------------------------------------------------
// Content (original P0)
// ---------------------------------------------------------------------------
describe("content ownership enforcement", () => {
  it("GET /projects/1/content/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(contentRouter)).get("/projects/1/content/999");
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "content.id", "content.projectId", 999, 1);
  });

  it("DELETE /projects/1/content/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(contentRouter)).delete("/projects/1/content/999");
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "content.id", "content.projectId", 999, 1);
  });
});

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
describe("campaign ownership enforcement", () => {
  it("GET /projects/1/campaigns/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(campaignsRouter)).get("/projects/1/campaigns/999");
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "campaigns.id", "campaigns.projectId", 999, 1);
  });

  it("PATCH /projects/1/campaigns/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(campaignsRouter))
      .patch("/projects/1/campaigns/999")
      .send({ name: "stolen" });
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "campaigns.id", "campaigns.projectId", 999, 1);
  });

  it("GET /projects/1/campaigns/999/performance scopes by projectId", async () => {
    await request(buildApp(campaignsRouter)).get("/projects/1/campaigns/999/performance");
    expectScoped(capturedWheres[0], "campaigns.id", "campaigns.projectId", 999, 1);
  });
});

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------
describe("video ownership enforcement", () => {
  it("GET /projects/1/videos/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(videosRouter)).get("/projects/1/videos/999");
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "videos.id", "videos.projectId", 999, 1);
  });

  it("PATCH /projects/1/videos/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(videosRouter))
      .patch("/projects/1/videos/999")
      .send({ title: "stolen" });
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "videos.id", "videos.projectId", 999, 1);
  });

  it("DELETE /projects/1/videos/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(videosRouter)).delete("/projects/1/videos/999");
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "videos.id", "videos.projectId", 999, 1);
  });
});

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------
describe("competitor ownership enforcement", () => {
  it("GET /projects/1/competitors/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(competitorsRouter)).get("/projects/1/competitors/999");
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "competitors.id", "competitors.projectId", 999, 1);
  });
});

// ---------------------------------------------------------------------------
// SEO blog posts
// ---------------------------------------------------------------------------
describe("seo blog-post ownership enforcement", () => {
  it("DELETE /projects/1/seo/blog-posts/999 scopes by projectId and 404s", async () => {
    const res = await request(buildApp(seoToolsRouter)).delete("/projects/1/seo/blog-posts/999");
    expect(res.status).toBe(404);
    expectScoped(capturedWheres[0], "seoBlogPosts.id", "seoBlogPosts.projectId", 999, 1);
  });
});

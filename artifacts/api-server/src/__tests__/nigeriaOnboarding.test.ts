/**
 * Nigeria onboarding journey - HTTP-level tests against the real Postgres
 * test DB (growthforge_nigeria_test), exercising the actual route chain for:
 *
 *   - trial assignment + prevention of trial resets
 *   - onboarding save / resume / completion
 *   - reusing the existing business project (no duplicate rows)
 *   - persistence of business information (name, industry, description)
 *   - cross-user data isolation (ownership enforcement)
 *   - updating business info via the account-settings PATCH route
 *
 * Only `getAuth` is stubbed (to a mutable user id) - the DB, drizzle, and the
 * real route handlers all run as in production.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { sql, eq, and, isNull } from "drizzle-orm";

// ── Isolated test DB, set BEFORE any dynamic import of @workspace/db ─────────
const DATABASE_URL = "postgresql://ubuntu@/growthforge_nigeria_test?host=/var/run/postgresql";
process.env.DATABASE_URL = DATABASE_URL;

const { USER_A, USER_B, currentUser } = vi.hoisted(() => ({
  USER_A: "__test_ng_onboard_a__",
  USER_B: "__test_ng_onboard_b__",
  currentUser: { id: "__test_ng_onboard_a__" as string },
}));

// ── Stub ONLY auth identity - everything else stays real ─────────────────────
vi.mock("../lib/supabaseAuth.js", () => ({
  getAuth: () => ({ userId: currentUser.id, sessionClaims: { email: `${currentUser.id}@test.com` } }),
  supabaseAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let db: any;
let usersTable: any;
let projectsTable: any;
let app: express.Express;

beforeAll(async () => {
  ({ db, usersTable, projectsTable } = await import("@workspace/db"));

  const authRouter = (await import("../routes/auth.js")).default;
  const onboardingRouter = (await import("../routes/onboarding.js")).default;
  const projectsRouter = (await import("../routes/projects.js")).default;

  app = express();
  app.use(express.json());
  app.use(authRouter);
  app.use(onboardingRouter);
  app.use(projectsRouter);
});

async function seedUser(id: string, overrides: Record<string, unknown> = {}) {
  await db.insert(usersTable).values({ id, email: `${id}@test.com`, ...overrides });
}

async function getUser(id: string) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return u;
}

async function projectCountFor(userId: string) {
  const rows = await db
    .select()
    .from(projectsTable)
    .where(and(eq(projectsTable.ownerId, userId), isNull(projectsTable.deletedAt)));
  return rows.length;
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE business_sources, creator_profiles, projects, users RESTART IDENTITY CASCADE`,
  );
  currentUser.id = USER_A;
});

afterAll(async () => {
  await db.execute(
    sql`TRUNCATE TABLE business_sources, creator_profiles, projects, users RESTART IDENTITY CASCADE`,
  );
});

describe("POST /auth/start-trial", () => {
  it("assigns a fresh 7-day trial to an eligible user", async () => {
    await seedUser(USER_A);

    const res = await request(app).post("/auth/start-trial").send({});
    expect(res.status).toBe(200);

    const { trialEndsAt, reusedExistingTrial, subscriptionStatus, plan } = res.body;
    expect(reusedExistingTrial).toBe(false);
    expect(subscriptionStatus).toBe("trial");
    expect(plan).toBe("trial");

    const end = new Date(trialEndsAt).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(end).toBeGreaterThan(Date.now() + sevenDays - 60_000);
    expect(end).toBeLessThanOrEqual(Date.now() + sevenDays + 60_000);

    const user = await getUser(USER_A);
    expect(new Date(user!.trialEndsAt!).getTime()).toBe(end);
  });

  it("reuses an existing trial instead of resetting it", async () => {
    const original = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await seedUser(USER_A, { plan: "trial", subscriptionStatus: "trial", trialEndsAt: original });

    const res = await request(app).post("/auth/start-trial").send({});
    expect(res.status).toBe(200);
    expect(res.body.reusedExistingTrial).toBe(true);
    expect(new Date(res.body.trialEndsAt).getTime()).toBe(original.getTime());

    const user = await getUser(USER_A);
    expect(new Date(user!.trialEndsAt!).getTime()).toBe(original.getTime());
  });
});

describe("POST /onboarding", () => {
  const payload = {
    businessName: "Ada Fashion House",
    industry: "Fashion and clothing",
    businessDescription: "Ready-to-wear outfits for busy working women.",
    targetCustomers: "Working women in Lagos aged 25-45",
    primaryGoal: "Get more customers",
    location: "Lekki, Lagos",
    sourceType: "manual",
    declaredDescription: "Most orders come via referrals and walk-ins.",
    operatingModel: "business",
  };

  it("completes onboarding and persists business information", async () => {
    await seedUser(USER_A);

    const res = await request(app).post("/onboarding").send(payload);
    expect(res.status).toBe(200);

    const { project, user, sources } = res.body;
    expect(project.name).toBe("Ada Fashion House");
    expect(project.industry).toBe("Fashion and clothing");
    expect(project.description).toContain("About: Ready-to-wear outfits");
    expect(project.description).toContain("Customers: Working women");
    expect(project.description).toContain("Goal: Get more customers");
    expect(project.description).toContain("Location: Lekki, Lagos");
    expect(project.sourceType).toBe("manual");

    expect(user.onboardingComplete).toBe(true);
    expect(user.plan).toBe("trial");
    expect(user.trialEndsAt).toBeTruthy();

    expect(Array.isArray(sources)).toBe(true);
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources[0].sourceType).toBe("manual");

    const dbUser = await getUser(USER_A);
    expect(dbUser!.onboardingComplete).toBe(true);
    expect(dbUser!.trialEndsAt).toBeTruthy();
  });

  it("reuses the existing project instead of creating a duplicate", async () => {
    await seedUser(USER_A);

    const first = await request(app).post("/onboarding").send(payload);
    expect(first.status).toBe(200);
    const firstProjectId = first.body.project.id;

    const second = await request(app).post("/onboarding").send({
      ...payload,
      businessName: "Ada Fashion House Updated",
      industry: "Retail and general trading",
    });
    expect(second.status).toBe(200);

    expect(second.body.project.id).toBe(firstProjectId);
    expect(await projectCountFor(USER_A)).toBe(1);
    expect(second.body.project.name).toBe("Ada Fashion House Updated");
    expect(second.body.project.industry).toBe("Retail and general trading");
  });

  it("requires a business name", async () => {
    await seedUser(USER_A);
    const res = await request(app).post("/onboarding").send({ ...payload, businessName: "   " });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("businessName");
  });
});

describe("GET /onboarding (resume)", () => {
  it("returns previously saved onboarding state", async () => {
    await seedUser(USER_A);
    const created = await request(app).post("/onboarding").send({
      businessName: "Abuja Realty",
      industry: "Real estate",
      businessDescription: "Affordable apartments in Abuja.",
      targetCustomers: "Young professionals",
      primaryGoal: "Increase online sales",
      location: "Wuse, Abuja",
      sourceType: "manual",
      declaredDescription: "Leads come from referrals.",
    });
    expect(created.status).toBe(200);
    const projectId = created.body.project.id;

    const res = await request(app).get("/onboarding");
    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe(projectId);
    expect(res.body.project.name).toBe("Abuja Realty");
    expect(res.body.project.industry).toBe("Real estate");
    expect(res.body.user.onboardingComplete).toBe(true);
    expect(res.body.sources.length).toBeGreaterThanOrEqual(1);
  });
});

describe("account settings - PATCH /projects/:id", () => {
  it("persists business-name, industry, and description updates", async () => {
    await seedUser(USER_A);
    const created = await request(app).post("/onboarding").send({
      businessName: "PH Restaurant",
      industry: "Food and restaurants",
      businessDescription: "Local dishes in Port Harcourt.",
      targetCustomers: "Families and workers",
      primaryGoal: "Get more customers",
      sourceType: "manual",
    });
    const projectId = created.body.project.id;

    const patch = await request(app).patch(`/projects/${projectId}`).send({
      name: "PH Restaurant & Lounge",
      industry: "Hospitality",
      description: "About: Local dishes | Customers: Families | Goal: Grow online presence",
    });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe("PH Restaurant & Lounge");
    expect(patch.body.industry).toBe("Hospitality");
    expect(patch.body.description).toContain("About: Local dishes");
  });
});

describe("cross-user data isolation", () => {
  it("prevents user B from reading or updating user A's project", async () => {
    await seedUser(USER_A);
    const created = await request(app).post("/onboarding").send({
      businessName: "Owner A Business",
      industry: "Digital services",
      businessDescription: "Web design for SMEs.",
      targetCustomers: "Nigerian SMEs",
      primaryGoal: "Get more customers",
      sourceType: "manual",
    });
    const projectId = created.body.project.id;

    // Switch the stubbed auth identity to user B.
    await seedUser(USER_B);
    currentUser.id = USER_B;

    const read = await request(app).get(`/projects/${projectId}`);
    expect(read.status).toBe(404);

    const update = await request(app).patch(`/projects/${projectId}`).send({ name: "Hijacked" });
    expect(update.status).toBe(404);

    // User B still cannot list user A's project.
    const list = await request(app).get("/projects");
    expect(list.status).toBe(200);
    expect(list.body.every((p: { id: number }) => p.id !== projectId)).toBe(true);
  });
});

import { Router, type IRouter } from "express";
import { getAuth } from "../lib/supabaseAuth.js";
import { db } from "@workspace/db";
import {
  usersTable,
  projectsTable,
  subscriptionUsageEventsTable,
  adminAlertsTable,
  contentIntegrityLogTable,
  videoWalletsTable,
  videoSecondLogsTable,
  teamMembersTable,
  metaPageSessionsTable,
  platformCreditTransactionsTable,
  adminAuditLogsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

/**
 * Google (or a later auth provider) can mint a new `auth.users` UUID for an
 * email that already has a `public.users` row (Clerk → Supabase, email vs
 * OAuth, etc.). Provisioning a blank row for that new id leaves the owner
 * with no admin role and no projects. Adopt the existing row instead.
 */
async function adoptExistingUserByEmail(newId: string, email: string): Promise<boolean> {
  const matches = await db.select().from(usersTable).where(eq(usersTable.email, email));
  const old = matches.find((row) => row.id !== newId);
  if (!old) return false;

  await db.transaction(async (tx) => {
    const { id: _ignored, ...rest } = old;
    await tx.insert(usersTable).values({
      ...rest,
      id: newId,
      email,
      canAccessDev: true,
      updatedAt: new Date(),
    });
    await tx.update(projectsTable).set({ ownerId: newId }).where(eq(projectsTable.ownerId, old.id));
    await tx.update(subscriptionUsageEventsTable).set({ userId: newId }).where(eq(subscriptionUsageEventsTable.userId, old.id));
    await tx.update(adminAlertsTable).set({ userId: newId }).where(eq(adminAlertsTable.userId, old.id));
    await tx.update(contentIntegrityLogTable).set({ userId: newId }).where(eq(contentIntegrityLogTable.userId, old.id));
    await tx.update(videoWalletsTable).set({ userId: newId }).where(eq(videoWalletsTable.userId, old.id));
    await tx.update(videoSecondLogsTable).set({ userId: newId }).where(eq(videoSecondLogsTable.userId, old.id));
    await tx.update(teamMembersTable).set({ userId: newId }).where(eq(teamMembersTable.userId, old.id));
    await tx.update(teamMembersTable).set({ invitedByUserId: newId }).where(eq(teamMembersTable.invitedByUserId, old.id));
    await tx.update(metaPageSessionsTable).set({ userId: newId }).where(eq(metaPageSessionsTable.userId, old.id));
    await tx.update(platformCreditTransactionsTable).set({ userId: newId }).where(eq(platformCreditTransactionsTable.userId, old.id));
    await tx.update(adminAuditLogsTable).set({ adminId: newId }).where(eq(adminAuditLogsTable.adminId, old.id));
    await tx.delete(usersTable).where(eq(usersTable.id, old.id));
  });
  return true;
}

router.post("/auth/provision", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Supabase always includes the verified email as a standard claim, so no
    // extra admin API call is needed here (unlike the old Clerk flow).
    const email = (auth?.sessionClaims?.email as string | undefined) ?? null;

    const existing = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (existing.length === 0) {
      let adopted = false;
      if (email) {
        try {
          adopted = await adoptExistingUserByEmail(userId, email);
        } catch (err) {
          req.log.warn({ err, email }, "Could not adopt existing user row by email");
        }
      }
      if (!adopted) {
        await db.insert(usersTable).values({ id: userId, email, canAccessDev: true });
      }
    } else {
      const patch: { email?: string | null; canAccessDev?: boolean } = {};
      if (email && existing[0].email !== email) patch.email = email;
      if (!existing[0].canAccessDev) patch.canAccessDev = true;
      if (Object.keys(patch).length > 0) {
        await db.update(usersTable).set(patch).where(eq(usersTable.id, userId));
      }
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Error provisioning user");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/start-trial", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(usersTable)
      .set({ plan: "trial", subscriptionStatus: "trial", trialEndsAt })
      .where(eq(usersTable.id, userId));

    res.json({ trialEndsAt });
  } catch (err) {
    req.log.error({ err }, "Error starting trial");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/me", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Error fetching user");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

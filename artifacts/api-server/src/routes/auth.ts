import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.post("/auth/provision", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Fetch the real email from Clerk — sessionClaims.email is not a standard
    // JWT claim and arrives as undefined for most sign-in methods.
    let email: string | null = null;
    try {
      const clerkUser = await clerkClient.users.getUser(userId);
      const primary = clerkUser.emailAddresses.find(
        (e) => e.id === clerkUser.primaryEmailAddressId
      );
      email = primary?.emailAddress ?? null;
    } catch {
      // Non-fatal — fall back to null; email will be picked up on next provision
    }

    const existing = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (existing.length === 0) {
      await db.insert(usersTable).values({ id: userId, email });
    } else {
      // Always sync email in case user updated it in Clerk
      if (email && existing[0].email !== email) {
        await db.update(usersTable).set({ email }).where(eq(usersTable.id, userId));
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

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

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

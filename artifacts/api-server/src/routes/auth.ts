import { Router, type IRouter } from "express";
import { getAuth } from "../lib/supabaseAuth.js";
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

    // Supabase always includes the verified email as a standard claim, so no
    // extra admin API call is needed here (unlike the old Clerk flow).
    const email = (auth?.sessionClaims?.email as string | undefined) ?? null;

    const existing = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (existing.length === 0) {
      await db.insert(usersTable).values({ id: userId, email });
    } else {
      // Always sync email in case the user updated it in Supabase Auth
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

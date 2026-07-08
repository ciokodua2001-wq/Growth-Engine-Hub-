import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.post("/onboarding", async (req, res): Promise<void> => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { businessName, websiteUrl, primaryGoal, targetMarket } = req.body as {
      businessName: string;
      websiteUrl: string;
      primaryGoal?: string;
      targetMarket?: string;
    };

    if (!businessName || !websiteUrl) {
      res.status(400).json({ error: "businessName and websiteUrl are required" });
      return;
    }

    const description = [primaryGoal, targetMarket].filter(Boolean).join(" | ") || null;

    const [project] = await db
      .insert(projectsTable)
      .values({
        ownerId: userId,
        name: businessName,
        websiteUrl,
        industry: null,
        description,
        plan: "trial",
        status: "pending",
      })
      .returning();

    await db
      .update(usersTable)
      .set({ onboardingComplete: true })
      .where(eq(usersTable.id, userId));

    res.json({ project });
  } catch (err) {
    req.log.error({ err }, "Error completing onboarding");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, platformCreditBanksTable, platformCreditTransactionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { seedDefaultBanks } from "../lib/platformCredits.js";

const router: IRouter = Router();

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

router.get("/admin/credits", requireAdmin, async (req, res): Promise<void> => {
  try {
    await seedDefaultBanks();
    const banks = await db
      .select()
      .from(platformCreditBanksTable)
      .orderBy(platformCreditBanksTable.provider);
    res.json(banks);
  } catch (err) {
    req.log.error({ err }, "Error fetching credit banks");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/credits/:provider/topup", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    const { amount, notes } = req.body as { amount: number; notes?: string };

    if (!amount || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }

    const [bank] = await db
      .select()
      .from(platformCreditBanksTable)
      .where(eq(platformCreditBanksTable.provider, provider));

    if (!bank) { res.status(404).json({ error: "Bank not found" }); return; }

    const newBalance = bank.balance + amount;
    const newPeak = Math.max(bank.peakBalance, newBalance);
    const newTotal = bank.totalAdded + amount;

    const [updated] = await db
      .update(platformCreditBanksTable)
      .set({ balance: newBalance, peakBalance: newPeak, totalAdded: newTotal, updatedAt: new Date() })
      .where(eq(platformCreditBanksTable.provider, provider))
      .returning();

    await db.insert(platformCreditTransactionsTable).values({
      provider,
      type: "topup",
      amount,
      balanceAfter: newBalance,
      description: notes?.trim() || "Manual top-up",
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error topping up credits");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/credits/:provider/settings", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    const body = req.body as {
      alertThresholdPct?: number;
      alertEmail?: string;
      alertEnabled?: boolean;
      unit?: string;
      notes?: string;
    };

    const update: Partial<typeof platformCreditBanksTable.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.alertThresholdPct === "number") update.alertThresholdPct = Math.max(1, Math.min(99, body.alertThresholdPct));
    if (typeof body.alertEmail === "string") update.alertEmail = body.alertEmail.trim() || null;
    if (typeof body.alertEnabled === "boolean") update.alertEnabled = body.alertEnabled;
    if (typeof body.unit === "string" && body.unit.trim()) update.unit = body.unit.trim();
    if (typeof body.notes === "string") update.notes = body.notes.trim() || null;

    const [updated] = await db
      .update(platformCreditBanksTable)
      .set(update)
      .where(eq(platformCreditBanksTable.provider, provider))
      .returning();

    if (!updated) { res.status(404).json({ error: "Bank not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating credit bank settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/credits/:provider/adjust", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    const { amount, description } = req.body as { amount: number; description?: string };

    if (typeof amount !== "number") {
      res.status(400).json({ error: "amount is required" });
      return;
    }

    const [bank] = await db
      .select()
      .from(platformCreditBanksTable)
      .where(eq(platformCreditBanksTable.provider, provider));

    if (!bank) { res.status(404).json({ error: "Bank not found" }); return; }

    const newBalance = Math.max(0, bank.balance + amount);
    const newPeak = amount > 0 ? Math.max(bank.peakBalance, newBalance) : bank.peakBalance;
    const newTotal = amount > 0 ? bank.totalAdded + amount : bank.totalAdded;

    const [updated] = await db
      .update(platformCreditBanksTable)
      .set({ balance: newBalance, peakBalance: newPeak, totalAdded: newTotal, updatedAt: new Date() })
      .where(eq(platformCreditBanksTable.provider, provider))
      .returning();

    await db.insert(platformCreditTransactionsTable).values({
      provider,
      type: amount >= 0 ? "topup" : "deduction",
      amount: Math.abs(amount),
      balanceAfter: newBalance,
      description: description?.trim() || (amount >= 0 ? "Manual adjustment (credit)" : "Manual adjustment (debit)"),
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error adjusting credits");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/credits/:provider/transactions", requireAdmin, async (req, res): Promise<void> => {
  try {
    const { provider } = req.params as { provider: string };
    const limit = Math.min(parseInt((req.query["limit"] as string) ?? "50", 10), 200);

    const rows = await db
      .select()
      .from(platformCreditTransactionsTable)
      .where(eq(platformCreditTransactionsTable.provider, provider))
      .orderBy(desc(platformCreditTransactionsTable.createdAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Error fetching credit transactions");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

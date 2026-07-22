import { db } from "@workspace/db";
import { videoWalletsTable, videoSecondLogsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getMonthlySecondsByPlan } from "./videoConfig.js";
import pino from "pino";

const logger = pino({ name: "videoWallet" });

export type VideoWalletBalance = {
  monthlySecondsTotal: number;
  monthlySecondsUsed: number;
  monthlySecondsRemaining: number;
  purchasedSecondsRemaining: number;
  totalRemaining: number;
  plan: string;
  lastResetAt: Date;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function needsMonthlyReset(lastResetAt: Date): boolean {
  const now = new Date();
  const last = new Date(lastResetAt);
  return (
    now.getFullYear() > last.getFullYear() ||
    (now.getFullYear() === last.getFullYear() && now.getMonth() > last.getMonth())
  );
}

function toBalance(row: typeof videoWalletsTable.$inferSelect): VideoWalletBalance {
  const monthlyRemaining = Math.max(0, row.monthlyVideoSeconds - row.monthlySecondsUsed);
  return {
    monthlySecondsTotal:      row.monthlyVideoSeconds,
    monthlySecondsUsed:       row.monthlySecondsUsed,
    monthlySecondsRemaining:  monthlyRemaining,
    purchasedSecondsRemaining: row.purchasedVideoSeconds,
    totalRemaining:           monthlyRemaining + row.purchasedVideoSeconds,
    plan:                     row.plan,
    lastResetAt:              row.lastResetAt,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function getOrCreateWallet(userId: string, plan?: string): Promise<VideoWalletBalance> {
  const [existing] = await db
    .select()
    .from(videoWalletsTable)
    .where(eq(videoWalletsTable.userId, userId));

  const resolvedPlan = plan ?? existing?.plan ?? "trial";
  const monthlyAlloc = await getMonthlySecondsByPlan(resolvedPlan);

  if (!existing) {
    const [created] = await db
      .insert(videoWalletsTable)
      .values({
        userId,
        plan: resolvedPlan,
        monthlyVideoSeconds:   monthlyAlloc,
        monthlySecondsUsed:    0,
        purchasedVideoSeconds: 0,
        totalPurchasedSeconds: 0,
        totalRenderedSeconds:  0,
        lastResetAt:           new Date(),
      })
      .returning();

    if (monthlyAlloc > 0) {
      await db.insert(videoSecondLogsTable).values({
        userId,
        type:               "monthly_reset",
        secondsChanged:     monthlyAlloc,
        fromMonthly:        0,
        fromPurchased:      0,
        newMonthlyBalance:  monthlyAlloc,
        newPurchasedBalance: 0,
        description:        `Initial monthly allocation (${resolvedPlan} plan)`,
      });
    }
    return toBalance(created!);
  }

  // Check if monthly should auto-reset (elapsed calendar month)
  if (needsMonthlyReset(existing.lastResetAt)) {
    const firstOfMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );
    const [updated] = await db
      .update(videoWalletsTable)
      .set({
        plan:                resolvedPlan,
        monthlyVideoSeconds: monthlyAlloc,
        monthlySecondsUsed:  0,
        lastResetAt:         firstOfMonth,
        updatedAt:           new Date(),
      })
      .where(eq(videoWalletsTable.userId, userId))
      .returning();

    await db.insert(videoSecondLogsTable).values({
      userId,
      type:               "monthly_reset",
      secondsChanged:     monthlyAlloc,
      fromMonthly:        0,
      fromPurchased:      0,
      newMonthlyBalance:  monthlyAlloc,
      newPurchasedBalance: existing.purchasedVideoSeconds,
      description:        `Monthly reset (${resolvedPlan} plan)`,
    });
    return toBalance(updated!);
  }

  // Sync plan change without full reset
  if (plan && plan !== existing.plan) {
    const [updated] = await db
      .update(videoWalletsTable)
      .set({ plan: resolvedPlan, monthlyVideoSeconds: monthlyAlloc, updatedAt: new Date() })
      .where(eq(videoWalletsTable.userId, userId))
      .returning();
    return toBalance(updated!);
  }

  return toBalance(existing);
}

export async function checkVideoSeconds(
  userId: string,
  plan: string,
  requiredSeconds: number,
): Promise<{ allowed: boolean; balance: VideoWalletBalance; message?: string }> {
  const balance = await getOrCreateWallet(userId, plan);

  if (balance.totalRemaining < requiredSeconds) {
    const have = balance.totalRemaining;
    const msg =
      have === 0
        ? `Your monthly video allowance is used up. Purchase additional video seconds or wait for your next billing cycle.`
        : `This video needs ${requiredSeconds}s but you only have ${have}s remaining. Purchase additional video seconds to continue.`;
    return { allowed: false, balance, message: msg };
  }

  return { allowed: true, balance };
}

export async function deductVideoSeconds(
  userId: string,
  seconds: number,
  videoId: number,
  projectId: number,
  description: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(videoWalletsTable)
      .where(eq(videoWalletsTable.userId, userId));

    if (!row) {
      logger.warn({ userId, videoId }, "No wallet found for deduction — skipping");
      return;
    }

    const monthlyAvail  = Math.max(0, row.monthlyVideoSeconds - row.monthlySecondsUsed);
    const fromMonthly   = Math.min(seconds, monthlyAvail);
    const fromPurchased = Math.max(0, seconds - fromMonthly);

    const newMonthlyUsed  = row.monthlySecondsUsed + fromMonthly;
    const newPurchased    = Math.max(0, row.purchasedVideoSeconds - fromPurchased);
    const newMonthlyBalance = Math.max(0, row.monthlyVideoSeconds - newMonthlyUsed);

    await tx
      .update(videoWalletsTable)
      .set({
        monthlySecondsUsed:    newMonthlyUsed,
        purchasedVideoSeconds: newPurchased,
        totalRenderedSeconds:  row.totalRenderedSeconds + seconds,
        updatedAt:             new Date(),
      })
      .where(eq(videoWalletsTable.userId, userId));

    await tx.insert(videoSecondLogsTable).values({
      userId,
      videoId,
      projectId,
      type:               "deduction",
      secondsChanged:     -seconds,
      fromMonthly,
      fromPurchased,
      newMonthlyBalance,
      newPurchasedBalance: newPurchased,
      description,
    });
  });

  logger.info({ userId, videoId, seconds }, "Video seconds deducted from wallet");
}

export async function creditPurchasedSeconds(
  userId: string,
  seconds: number,
  stripeSessionId: string,
  amountPaidUsd: number,
  plan?: string,
): Promise<VideoWalletBalance> {
  await getOrCreateWallet(userId, plan);

  const [updated] = await db
    .update(videoWalletsTable)
    .set({
      purchasedVideoSeconds: sql`purchased_video_seconds + ${seconds}`,
      totalPurchasedSeconds: sql`total_purchased_seconds + ${seconds}`,
      updatedAt: new Date(),
    })
    .where(eq(videoWalletsTable.userId, userId))
    .returning();

  if (!updated) throw new Error(`Wallet not found for user ${userId}`);

  const newMonthlyBalance = Math.max(0, updated.monthlyVideoSeconds - updated.monthlySecondsUsed);

  await db.insert(videoSecondLogsTable).values({
    userId,
    type:               "purchased_credit",
    secondsChanged:     seconds,
    fromMonthly:        0,
    fromPurchased:      0,
    newMonthlyBalance,
    newPurchasedBalance: updated.purchasedVideoSeconds,
    description:        `Purchased ${seconds}s video credit`,
    stripeSessionId,
    amountPaidUsd,
  });

  logger.info({ userId, seconds, stripeSessionId }, "Purchased video seconds credited");
  return toBalance(updated);
}

export async function resetMonthlySecondsForUser(userId: string, plan: string): Promise<void> {
  const monthlyAlloc  = await getMonthlySecondsByPlan(plan);
  const [existing]    = await db.select().from(videoWalletsTable).where(eq(videoWalletsTable.userId, userId));
  const firstOfMonth  = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  if (!existing) {
    await db.insert(videoWalletsTable).values({
      userId,
      plan,
      monthlyVideoSeconds:   monthlyAlloc,
      monthlySecondsUsed:    0,
      purchasedVideoSeconds: 0,
      totalPurchasedSeconds: 0,
      totalRenderedSeconds:  0,
      lastResetAt:           firstOfMonth,
    });
  } else {
    await db
      .update(videoWalletsTable)
      .set({ plan, monthlyVideoSeconds: monthlyAlloc, monthlySecondsUsed: 0, lastResetAt: firstOfMonth, updatedAt: new Date() })
      .where(eq(videoWalletsTable.userId, userId));
  }

  await db.insert(videoSecondLogsTable).values({
    userId,
    type:               "monthly_reset",
    secondsChanged:     monthlyAlloc,
    fromMonthly:        0,
    fromPurchased:      0,
    newMonthlyBalance:  monthlyAlloc,
    newPurchasedBalance: existing?.purchasedVideoSeconds ?? 0,
    description:        `Monthly reset on subscription renewal (${plan} plan)`,
  });

  logger.info({ userId, plan, monthlyAlloc }, "Monthly video seconds reset for user");
}

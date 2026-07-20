import { db } from "@workspace/db";
import { platformCreditBanksTable, platformCreditTransactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { logger } from "./logger.js";

export type Provider = "anthropic" | "openai" | "minimax" | "kling" | "elevenlabs" | "heygen";

const MANUAL_BANKS: Array<{ provider: Provider; displayName: string; unit: string }> = [
  { provider: "kling",  displayName: "Kling AI (Video)",  unit: "clips"   },
  { provider: "heygen", displayName: "HeyGen (Avatar)",   unit: "videos"  },
];

export async function seedManualBanks(): Promise<void> {
  for (const bank of MANUAL_BANKS) {
    await db
      .insert(platformCreditBanksTable)
      .values({ ...bank, balance: 0, peakBalance: 0, totalAdded: 0 })
      .onConflictDoUpdate({
        target: platformCreditBanksTable.provider,
        set: { unit: bank.unit, displayName: bank.displayName },
      });
  }
}

export interface CreditDeductMeta {
  minutesGenerated?: number;
  videosCount?: number;
  projectId?: number;
  userId?: string;
  videoId?: string;
}

/**
 * Deduct credits from a provider's bank (if one exists) and always log the transaction.
 * For Anthropic/ElevenLabs/OpenAI: logs spend for reporting without touching any bank row.
 * For FAL/Shotstack: also updates the bank balance, production totals, and fires alerts.
 * Pass CreditDeductMeta to record per-event production metrics (minutes, videos, project).
 */
export async function deductPlatformCredits(
  provider: Provider,
  amount: number,
  description: string,
  referenceIdOrMeta?: string | CreditDeductMeta,
): Promise<void> {
  if (amount <= 0) return;

  const referenceId = typeof referenceIdOrMeta === "string" ? referenceIdOrMeta : undefined;
  const meta: CreditDeductMeta = (typeof referenceIdOrMeta === "object" && referenceIdOrMeta !== null)
    ? referenceIdOrMeta
    : {};

  try {
    await db.transaction(async (tx) => {
      const [bank] = await tx
        .select()
        .from(platformCreditBanksTable)
        .where(eq(platformCreditBanksTable.provider, provider))
        .for("update");

      let balanceAfter = 0;

      if (bank) {
        balanceAfter = Math.max(0, bank.balance - amount);

        const bankUpdate: Partial<typeof platformCreditBanksTable.$inferInsert> = {
          balance: balanceAfter,
          updatedAt: new Date(),
        };

        // Track production totals for manually-managed banks (Kling, HeyGen)
        if (provider === "kling" || provider === "minimax" || provider === "heygen") {
          bankUpdate.totalCreditsConsumed = (bank.totalCreditsConsumed ?? 0) + amount;
          if (meta.videosCount) {
            bankUpdate.totalVideosGenerated = (bank.totalVideosGenerated ?? 0) + meta.videosCount;
          }
          if (meta.minutesGenerated) {
            bankUpdate.totalMinutesGenerated = (bank.totalMinutesGenerated ?? 0) + meta.minutesGenerated;
          }
        }

        await tx
          .update(platformCreditBanksTable)
          .set(bankUpdate)
          .where(eq(platformCreditBanksTable.provider, provider));

        const pct = bank.peakBalance > 0 ? (balanceAfter / bank.peakBalance) * 100 : 100;
        if (
          bank.alertEnabled &&
          bank.alertEmail &&
          pct <= bank.alertThresholdPct &&
          (!bank.lastAlertAt || Date.now() - bank.lastAlertAt.getTime() > 23 * 60 * 60 * 1000)
        ) {
          await tx
            .update(platformCreditBanksTable)
            .set({ lastAlertAt: new Date() })
            .where(eq(platformCreditBanksTable.provider, provider));
          sendLowBalanceAlert(
            bank.alertEmail, bank.displayName, balanceAfter, bank.unit,
            Math.round(pct), bank.alertThresholdPct,
          ).catch((err) => logger.warn({ err }, "Low-balance alert email failed"));
        }
      }

      await tx.insert(platformCreditTransactionsTable).values({
        provider,
        type: "deduction",
        amount,
        balanceAfter,
        description,
        referenceId: referenceId ?? null,
        minutesGenerated: meta.minutesGenerated ?? null,
        videosCount: meta.videosCount ?? null,
        projectId: meta.projectId ?? null,
        userId: meta.userId ?? null,
        videoId: meta.videoId ?? null,
      });
    });
  } catch (err) {
    logger.warn({ err, provider, amount }, "Platform credit deduction failed (non-fatal)");
  }
}

async function sendLowBalanceAlert(
  to: string,
  providerName: string,
  balance: number,
  unit: string,
  pct: number,
  threshold: number,
): Promise<void> {
  const smtpHost = process.env["SMTP_HOST"];
  if (!smtpHost) return;
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env["SMTP_PORT"] ?? "587", 10),
    auth: { user: process.env["SMTP_USER"], pass: process.env["SMTP_PASS"] },
  });
  await transporter.sendMail({
    from: process.env["SMTP_FROM"] ?? "noreply@usegrowthforge.com",
    to,
    subject: `⚠️ GrowthForge: ${providerName} balance low (${pct}%)`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#ff6b35">⚠️ Low Credit Balance Alert</h2>
        <p>Your <strong>${providerName}</strong> bank has dropped to <strong>${pct}%</strong> — below your ${threshold}% threshold.</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;color:#666">Provider</td><td style="padding:8px;font-weight:bold">${providerName}</td></tr>
          <tr><td style="padding:8px;color:#666">Remaining</td><td style="padding:8px;font-weight:bold">${balance.toLocaleString()} ${unit}</td></tr>
          <tr><td style="padding:8px;color:#666">Balance</td><td style="padding:8px;font-weight:bold;color:#ff6b35">${pct}%</td></tr>
        </table>
        <p style="margin-top:24px">
          <a href="https://usegrowthforge.com/admin/credits" style="background:#00E676;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Top Up Now →</a>
        </p>
        <p style="color:#999;font-size:12px;margin-top:24px">GrowthForge Admin · Strapli Technologies Inc.</p>
      </div>
    `,
  });
}

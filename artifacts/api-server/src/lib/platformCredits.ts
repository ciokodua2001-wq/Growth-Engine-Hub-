import { db } from "@workspace/db";
import { platformCreditBanksTable, platformCreditTransactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { logger } from "./logger.js";

export const PROVIDERS = ["anthropic", "openai", "minimax", "elevenlabs", "shotstack"] as const;
export type Provider = (typeof PROVIDERS)[number];

const DEFAULT_BANKS: Array<{ provider: Provider; displayName: string; unit: string }> = [
  { provider: "anthropic",   displayName: "Anthropic (Claude)",   unit: "USD" },
  { provider: "openai",      displayName: "OpenAI (GPT Image)",   unit: "USD" },
  { provider: "minimax",     displayName: "MiniMax (Video)",      unit: "tokens" },
  { provider: "elevenlabs",  displayName: "ElevenLabs (Voice)",   unit: "characters" },
  { provider: "shotstack",   displayName: "Shotstack (Render)",   unit: "credits" },
];

export async function seedDefaultBanks(): Promise<void> {
  for (const bank of DEFAULT_BANKS) {
    await db
      .insert(platformCreditBanksTable)
      .values({ ...bank, balance: 0, peakBalance: 0, totalAdded: 0 })
      .onConflictDoNothing();
  }
}

export async function deductPlatformCredits(
  provider: Provider,
  amount: number,
  description: string,
  referenceId?: string,
): Promise<void> {
  if (amount <= 0) return;
  try {
    await db.transaction(async (tx) => {
      const [bank] = await tx
        .select()
        .from(platformCreditBanksTable)
        .where(eq(platformCreditBanksTable.provider, provider))
        .for("update");

      if (!bank) return;

      const newBalance = Math.max(0, bank.balance - amount);
      await tx
        .update(platformCreditBanksTable)
        .set({ balance: newBalance, updatedAt: new Date() })
        .where(eq(platformCreditBanksTable.provider, provider));

      await tx.insert(platformCreditTransactionsTable).values({
        provider,
        type: "deduction",
        amount,
        balanceAfter: newBalance,
        description,
        referenceId: referenceId ?? null,
      });

      const pct = bank.peakBalance > 0 ? (newBalance / bank.peakBalance) * 100 : 100;
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

        sendLowBalanceAlert(bank.alertEmail, bank.displayName, newBalance, bank.unit, Math.round(pct), bank.alertThresholdPct).catch(
          (err) => logger.warn({ err }, "Low-balance alert email failed"),
        );
      }
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
    auth: {
      user: process.env["SMTP_USER"],
      pass: process.env["SMTP_PASS"],
    },
  });

  await transporter.sendMail({
    from: process.env["SMTP_FROM"] ?? "noreply@usegrowthforge.com",
    to,
    subject: `⚠️ GrowthForge: ${providerName} credit balance low (${pct}%)`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#ff6b35">⚠️ Low Credit Balance Alert</h2>
        <p>Your <strong>${providerName}</strong> credit bank has dropped to <strong>${pct}%</strong> — below your ${threshold}% alert threshold.</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:8px;color:#666">Provider</td><td style="padding:8px;font-weight:bold">${providerName}</td></tr>
          <tr><td style="padding:8px;color:#666">Current balance</td><td style="padding:8px;font-weight:bold">${balance.toLocaleString()} ${unit}</td></tr>
          <tr><td style="padding:8px;color:#666">Balance %</td><td style="padding:8px;font-weight:bold;color:#ff6b35">${pct}%</td></tr>
        </table>
        <p style="margin-top:24px">
          <a href="https://usegrowthforge.com/admin/credits" style="background:#00E676;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Top Up Now →</a>
        </p>
        <p style="color:#999;font-size:12px;margin-top:24px">GrowthForge Admin · Strapli Technologies Inc.</p>
      </div>
    `,
  });
}

import { Resend } from "resend";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = "GrowthForge AI <notifications@usegrowthforge.com>";

export async function getOwnerEmailForProject(projectId: number): Promise<string | null> {
  return getOwnerEmail(projectId);
}

async function getOwnerEmail(projectId: number): Promise<string | null> {
  try {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) return null;

    const [project] = await db
      .select({ ownerId: projectsTable.ownerId })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));

    if (!project?.ownerId) return null;

    const r = await fetch(`https://api.clerk.com/v1/users/${project.ownerId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!r.ok) return null;

    const user = await r.json() as { email_addresses?: Array<{ email_address: string }> };
    return user.email_addresses?.[0]?.email_address ?? null;
  } catch {
    return null;
  }
}

export async function notifyPostAutoPublished(args: {
  projectId: number;
  platform: string;
  caption: string;
}): Promise<void> {
  if (!resend) return;
  const to = await getOwnerEmail(args.projectId);
  if (!to) return;
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: `✅ Your ${args.platform} post was auto-published`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#fff;background:#040B14;padding:32px;border-radius:12px;">
          <h2 style="color:#00E676;margin:0 0 16px">Post published automatically ✅</h2>
          <p style="color:#aaa;margin:0 0 12px">Your scheduled <strong style="color:#fff">${args.platform}</strong> post went live on time.</p>
          <blockquote style="border-left:3px solid #00E676;margin:0 0 24px;padding:8px 16px;background:#0d1f14;color:#ccc;border-radius:4px;">
            ${args.caption.slice(0, 240)}${args.caption.length > 240 ? "…" : ""}
          </blockquote>
          <a href="https://usegrowthforge.com" style="display:inline-block;background:#00E676;color:#040B14;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">View Dashboard →</a>
        </div>`,
    });
  } catch (err) {
    logger.warn({ err, projectId: args.projectId }, "emailNotifier: failed to send post-published notification (non-fatal)");
  }
}

export async function notifyAnalysisComplete(args: {
  projectId: number;
  websiteUrl: string;
}): Promise<void> {
  if (!resend) return;
  const to = await getOwnerEmail(args.projectId);
  if (!to) return;
  try {
    await resend.emails.send({
      from: FROM,
      to,
      subject: "🎉 Your business analysis is ready — GrowthForge",
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#fff;background:#040B14;padding:32px;border-radius:12px;">
          <h2 style="color:#00E676;margin:0 0 16px">Your AI analysis is complete 🎉</h2>
          <p style="color:#aaa;margin:0 0 12px">GrowthForge has finished analyzing <strong style="color:#fff">${args.websiteUrl}</strong>.</p>
          <p style="color:#aaa;margin:0 0 24px">Your business intelligence, competitor analysis, customer personas, and marketing strategy are ready to explore.</p>
          <a href="https://usegrowthforge.com" style="display:inline-block;background:#00E676;color:#040B14;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">View Your Analysis →</a>
        </div>`,
    });
  } catch (err) {
    logger.warn({ err, projectId: args.projectId }, "emailNotifier: failed to send analysis-complete notification (non-fatal)");
  }
}

export async function notifyScheduledEmailReady(args: {
  toEmail: string;
  subject: string;
  projectId: number;
}): Promise<void> {
  if (!resend) return;
  try {
    await resend.emails.send({
      from: FROM,
      to: args.toEmail,
      subject: `⏰ Time to send your campaign: "${args.subject}"`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#fff;background:#040B14;padding:32px;border-radius:12px;">
          <h2 style="color:#00D4FF;margin:0 0 16px">Your scheduled send time has arrived ⏰</h2>
          <p style="color:#aaa;margin:0 0 12px">Your email campaign is ready to go out:</p>
          <blockquote style="border-left:3px solid #00D4FF;margin:0 0 24px;padding:8px 16px;background:#081824;color:#fff;border-radius:4px;font-weight:600;">
            ${args.subject}
          </blockquote>
          <p style="color:#aaa;margin:0 0 24px">Head to GrowthForge Email Marketing to send it to your audience now.</p>
          <a href="https://usegrowthforge.com" style="display:inline-block;background:#00D4FF;color:#040B14;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">Go to Email Marketing →</a>
        </div>`,
    });
  } catch (err) {
    logger.warn({ err, projectId: args.projectId }, "emailNotifier: failed to send scheduled-email-ready notification (non-fatal)");
  }
}

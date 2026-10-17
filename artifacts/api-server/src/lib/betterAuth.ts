import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Resend } from "resend";
import { db, user, session, account, verification, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Better Auth instance - replaces Supabase Auth for the GrowthForge API and
 * frontend. Owns authentication + session state in the `user`/`session`/
 * `account`/`verification` tables (see lib/db/src/schema/auth.ts). The
 * application `users` table remains the profile source of truth, keyed by the
 * same `user.id` (a UUID string), auto-provisioned via databaseHooks below.
 *
 * Required env vars:
 *   BETTER_AUTH_SECRET   stable secret for session cookie signing (required in prod)
 *   GOOGLE_CLIENT_ID     (optional - enables Google OAuth when set with GOOGLE_CLIENT_SECRET)
 *   GOOGLE_CLIENT_SECRET (optional)
 *   RESEND_API_KEY / RESEND_KEY (optional - sends verification/reset emails; logs a warning if unset)
 */

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  logger.warn(
    "BETTER_AUTH_SECRET is not set - using an ephemeral dev secret. Sessions will NOT survive a restart. Set BETTER_AUTH_SECRET in production.",
  );
}

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const resendKey = process.env.RESEND_API_KEY || process.env.RESEND_KEY;
const resend = resendKey ? new Resend(resendKey) : null;
const AUTH_FROM = process.env.AUTH_FROM ?? "onboarding@resend.dev";

/**
 * Send a transactional auth email via Resend. Falls back to a warning log when
 * RESEND_API_KEY is not configured. The token-bearing `url` is deliberately
 * NOT logged (credentials/tokens must never appear in logs).
 */
async function sendAuthEmail(opts: { to: string; subject: string; html: string; label: string }): Promise<void> {
  if (!resend) {
    logger.warn({ to: opts.to, label: opts.label }, "[Auth] Email not sent - RESEND_API_KEY not configured");
    return;
  }
  try {
    await resend.emails.send({ from: AUTH_FROM, to: opts.to, subject: opts.subject, html: opts.html });
  } catch (err) {
    logger.error({ err, to: opts.to, label: opts.label }, "[Auth] Failed to send auth email");
  }
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:4001",
  secret: secret ?? "growthforge-ephemeral-dev-secret",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  // Durable identity mapping: every Better Auth `user` row must resolve to a
  // GrowthForge application `users` row with the SAME id (users.id === user.id).
  // Creating that row here (on user create) removes any dependence on the
  // frontend calling /auth/provision, so project ownership, team membership and
  // subscriptions keyed off users.id keep working the moment a session exists.
  databaseHooks: {
    user: {
      create: {
        after: async (authUser) => {
          try {
            const existing = await db.select().from(usersTable).where(eq(usersTable.id, authUser.id));
            if (existing.length === 0) {
              await db.insert(usersTable).values({ id: authUser.id, email: authUser.email ?? null, canAccessDev: true });
            }
          } catch (err) {
            logger.error({ err, userId: authUser.id }, "[Auth] Failed to auto-provision application user row");
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user: authUser, url }) => {
      await sendAuthEmail({
        to: authUser.email,
        subject: "Reset your GrowthForge password",
        label: "password-reset",
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#fff;background:#040B14;padding:32px;border-radius:12px;">
          <h2 style="color:#00E676;margin:0 0 16px">Reset your password</h2>
          <p style="color:#aaa;margin:0 0 24px">Click the button below to set a new password. This link expires shortly.</p>
          <a href="${url}" style="display:inline-block;background:#00E676;color:#040B14;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">Reset password</a>
        </div>`,
      });
    },
  },
  // Rate-limit auth endpoints (per-IP, in-memory). Better Auth also applies
  // tighter special rules to sign-in/sign-up/reset-password beyond this base.
  rateLimit: {
    enabled: true,
    window: 60, // seconds
    max: 60, // requests per window per IP
  },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  emailVerification: {
    // Non-blocking for now: a user can sign in before verifying. Flip
    // requireEmailVerification to true once verification is required.
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user: authUser, url }) => {
      await sendAuthEmail({
        to: authUser.email,
        subject: "Verify your GrowthForge email",
        label: "email-verification",
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#fff;background:#040B14;padding:32px;border-radius:12px;">
          <h2 style="color:#00E676;margin:0 0 16px">Verify your email</h2>
          <p style="color:#aaa;margin:0 0 24px">Click the button below to verify your email address.</p>
          <a href="${url}" style="display:inline-block;background:#00E676;color:#040B14;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">Verify email</a>
        </div>`,
      });
    },
  },
});

export type BetterAuthInstance = typeof auth;

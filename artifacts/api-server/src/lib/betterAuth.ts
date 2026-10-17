import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, user, session, account, verification, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Better Auth instance - replaces Supabase Auth for the GrowthForge API and
 * frontend. Owns authentication + session state in the `user`/`session`/
 * `account`/`verification` tables (see lib/db/src/schema/auth.ts). The
 * application `users` table remains the profile source of truth, keyed by the
 * same `user.id` (a UUID string) via `/auth/provision`.
 *
 * Required env vars:
 *   BETTER_AUTH_SECRET   stable secret for session cookie signing (required in prod)
 *   GOOGLE_CLIENT_ID     (optional - enables Google OAuth when set with GOOGLE_CLIENT_SECRET)
 *   GOOGLE_CLIENT_SECRET (optional)
 *
 * Email sending (verification + password reset) is logged but not yet wired to
 * a provider - see the TODOs. Email/password sign-up/sign-in/sign-out and
 * session persistence work without a mail provider.
 */

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) {
  logger.warn(
    "BETTER_AUTH_SECRET is not set - using an ephemeral dev secret. Sessions will NOT survive a restart. Set BETTER_AUTH_SECRET in production.",
  );
}

const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

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
      // TODO(phase-3b): send via Resend (nodemailer/resend client) once mail
      // sender config is finalized. Never log the token.
      logger.info({ userId: authUser.id, url }, "[Auth] Password reset email queued (sender not yet wired)");
    },
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
    // requireEmailVerification to true once the mail sender is wired.
    sendOnSignUp: false,
    sendVerificationEmail: async ({ user: authUser, url }) => {
      // TODO(phase-3b): send via Resend. Never log the token.
      logger.info({ userId: authUser.id, url }, "[Auth] Verification email queued (sender not yet wired)");
    },
  },
});

export type BetterAuthInstance = typeof auth;

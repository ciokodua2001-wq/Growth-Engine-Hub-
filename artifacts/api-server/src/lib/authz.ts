import type { NextFunction, Request, Response } from "express";
import { getAuth } from "./supabaseAuth.js";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { projectsTable, usersTable, teamMembersTable, type Project } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      project?: Project;
      isProjectOwner?: boolean;
      /** True when the authenticated user is the platform owner (usersTable.isOwner). */
      isPlatformOwner?: boolean;
    }
  }
}

/**
 * Returns the authenticated Clerk user id, or writes a 401 and returns null.
 * Callers must `return` immediately when this returns null.
 */
export function requireUserId(req: Request, res: Response): string | null {
  const userId = getAuth(req)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

/** Loads a project only if it exists and is owned by the given user; otherwise null. */
export async function loadOwnedProject(userId: string, projectId: number): Promise<Project | null> {
  if (Number.isNaN(projectId)) return null;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project || project.ownerId !== userId) return null;
  return project;
}

/**
 * Loads a project if the user is the owner OR an active team member.
 * Returns { project, isOwner } or null if no access.
 */
export async function loadAccessibleProject(
  userId: string,
  projectId: number
): Promise<{ project: Project; isOwner: boolean } | null> {
  if (Number.isNaN(projectId)) return null;
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project || project.deletedAt) return null;

  if (project.ownerId === userId) return { project, isOwner: true };

  const [member] = await db
    .select()
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.projectId, projectId),
        eq(teamMembersTable.userId, userId),
        eq(teamMembersTable.status, "active")
      )
    );
  if (member) return { project, isOwner: false };

  return null;
}

/**
 * Route middleware that blocks AI content generation for cancelled subscribers.
 * Cancelled users retain read-only access (GET routes) for 90 days post-cancellation;
 * any attempt to generate new content returns 403 with a clear message.
 * Wire onto individual POST routes that cost AI quota.
 */
const GRACE_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours

export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = getAuth(req)?.userId;
  if (!userId) { next(); return; }

  const [user] = await db.select({
    subscriptionStatus: usersTable.subscriptionStatus,
    isOwner: usersTable.isOwner,
    trialEndsAt: usersTable.trialEndsAt,
    subscriptionPastDueSince: usersTable.subscriptionPastDueSince,
  })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  // Platform owner has unlimited access - bypass all subscription checks
  if (user?.isOwner) { next(); return; }

  const status = user?.subscriptionStatus;

  // A 7-day trial ends at trialEndsAt; enforce that boundary lazily so an expired
  // trial can no longer generate AI content (trial quota is a lifetime cap and does
  // not itself time-box the trial).
  const trialExpired =
    status === "trial" &&
    user?.trialEndsAt != null &&
    user.trialEndsAt.getTime() <= Date.now();

  // Terminal / non-paying states block immediately (no grace).
  const immediateBlock = status === "cancelled" || status === "unpaid" || status === "incomplete_expired";

  // past_due: allow a 72-hour grace from the FIRST failure, then block.
  const pastDueGraceExpired =
    status === "past_due" &&
    user?.subscriptionPastDueSince != null &&
    Date.now() - user.subscriptionPastDueSince.getTime() > GRACE_WINDOW_MS;

  if (trialExpired) {
    res.status(403).json({
      error: "trial_expired",
      message: "Your free trial has ended. Upgrade to a plan to continue generating content.",
    });
    return;
  }

  if (immediateBlock) {
    const cancelled = status === "cancelled";
    res.status(403).json({
      error: cancelled ? "subscription_cancelled" : "payment_required",
      message: cancelled
        ? "Your subscription has been cancelled. Your existing content remains available in read-only mode for 90 days. To generate new content, please reactivate your subscription."
        : "Your subscription payment could not be completed. Please update your payment method to restore access.",
    });
    return;
  }

  if (pastDueGraceExpired) {
    res.status(403).json({
      error: "payment_past_due",
      message: "Your payment is past due. Please update your payment method to restore access.",
    });
    return;
  }

  next();
}

/**
 * Route middleware that requires the caller to be the project owner (not just a team member).
 * Must be used after requireProjectOwnershipParam sets req.isProjectOwner.
 */
export function requireOwnerOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.isProjectOwner) {
    res.status(403).json({ error: "Only the project owner can perform this action." });
    return;
  }
  next();
}

/**
 * Express `router.param()` handler factory: verifies the caller is authenticated and
 * owns or is an active team member of the project referenced by the given route param
 * (default "id"), 401/404 otherwise. On success, attaches the loaded project to
 * `req.project` and sets `req.isProjectOwner` so downstream handlers can distinguish
 * owners from members.
 *
 * Usage: `router.param("id", requireProjectOwnershipParam());` once per router file.
 */
export function requireProjectOwnershipParam() {
  return async (req: Request, res: Response, next: NextFunction, value: string): Promise<void> => {
    const projectId = parseInt(value, 10);
    if (Number.isNaN(projectId)) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const userId = requireUserId(req, res);
    if (!userId) return;

    const result = await loadAccessibleProject(userId, projectId);
    if (!result) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    req.project = result.project;
    req.isProjectOwner = result.isOwner;

    // Resolve platform-owner status so route handlers can bypass plan/quota gates.
    const [userRow] = await db
      .select({ isOwner: usersTable.isOwner })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    req.isPlatformOwner = userRow?.isOwner ?? false;

    next();
  };
}

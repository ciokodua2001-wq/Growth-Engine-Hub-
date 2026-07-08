import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { projectsTable, type Project } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      project?: Project;
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
 * Express `router.param()` handler factory: verifies the caller is authenticated and owns the
 * project referenced by the given route param (default "id"), 401/404 otherwise. On success,
 * attaches the loaded project to `req.project` so downstream handlers can reuse it.
 *
 * Usage: `router.param("id", requireProjectOwnershipParam());` once per router file — this
 * covers every route on that router whose path contains a `:id` segment.
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

    const project = await loadOwnedProject(userId, projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    req.project = project;
    next();
  };
}

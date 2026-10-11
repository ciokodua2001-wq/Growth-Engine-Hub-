import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { businessSourcesTable } from "@workspace/db";
import { requireProjectOwnershipParam } from "../lib/authz.js";
import { SOURCE_TYPES, type SourceType } from "../lib/businessSourceIngestor.js";

const router: IRouter = Router();

// Enforces auth + project ownership on every /projects/:id/sources route and
// attaches req.project.
router.param("id", requireProjectOwnershipParam());

function serialize(source: typeof businessSourcesTable.$inferSelect) {
  return {
    ...source,
    retrievedAt: source.retrievedAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

// GET /projects/:id/sources - list the project's source ledger.
router.get("/projects/:id/sources", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const sources = await db
    .select()
    .from(businessSourcesTable)
    .where(eq(businessSourcesTable.projectId, projectId))
    .orderBy(desc(businessSourcesTable.createdAt));
  res.json(sources.map(serialize));
});

// POST /projects/:id/sources - add a source to an existing project.
// Manual-first: never auto-imports social data; preserves provenance.
router.post("/projects/:id/sources", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const body = req.body as { sourceType?: string; sourceUrl?: string; declaredContent?: string };

  const sourceType = body.sourceType as SourceType | undefined;
  if (!sourceType || !SOURCE_TYPES.includes(sourceType)) {
    res.status(400).json({ error: `sourceType must be one of: ${SOURCE_TYPES.join(", ")}` });
    return;
  }

  const sourceUrl = body.sourceUrl?.trim() || null;
  const declaredContent = body.declaredContent?.trim() || null;

  if (sourceType === "website" && !sourceUrl) {
    res.status(400).json({ error: "sourceUrl is required for website sources" });
    return;
  }
  if (sourceType !== "website" && !sourceUrl && !declaredContent) {
    res.status(400).json({ error: "Provide a sourceUrl or a declaredContent description" });
    return;
  }

  const sourceValue = sourceUrl ?? sourceType;

  // Prevent accidental duplicate sources (same type + same value).
  const [existing] = await db
    .select()
    .from(businessSourcesTable)
    .where(
      and(
        eq(businessSourcesTable.projectId, projectId),
        eq(businessSourcesTable.sourceType, sourceType),
        eq(businessSourcesTable.sourceValue, sourceValue),
      ),
    )
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "This source is already connected to this project." });
    return;
  }

  const [source] = await db
    .insert(businessSourcesTable)
    .values({
      projectId,
      sourceType,
      sourceUrl,
      sourceValue,
      displayLabel: sourceUrl ?? sourceType,
      authorizationStatus: "none",
      retrievalMethod: "none",
      declaredContent,
      status: "active",
    })
    .returning();

  // Adding a source does NOT touch analysis_sources snapshots (append-only);
  // existing analyses remain linked to the source versions that grounded them.
  res.status(201).json(serialize(source));
});

export default router;

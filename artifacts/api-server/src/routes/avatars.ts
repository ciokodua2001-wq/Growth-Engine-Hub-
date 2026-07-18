import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { projectAvatarsTable, platformAvatarsTable } from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { requireProjectOwnershipParam, requireUserId } from "../lib/authz.js";
import { objectStorageClient } from "../lib/objectStorage.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── List active platform avatars (public — any authenticated user) ────────────
router.get("/platform-avatars", async (_req, res): Promise<void> => {
  const avatars = await db
    .select()
    .from(platformAvatarsTable)
    .where(eq(platformAvatarsTable.isActive, true))
    .orderBy(asc(platformAvatarsTable.sortOrder), desc(platformAvatarsTable.createdAt));
  res.json({ avatars });
});

// ── Avatar photo proxy (no makePublic — bucket has PAP enforced) ──────────────
// Streams the image from GCS via the authenticated sidecar client.
// Public route — these photos are intended to be viewable by all users.
router.get("/platform-avatars/photo", async (req, res): Promise<void> => {
  const key = req.query.key as string;
  const bucketId = (req.query.bucket as string | undefined) || process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!key || !bucketId) {
    res.status(400).send("Missing key or bucket");
    return;
  }
  try {
    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(key);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", (metadata.contentType as string) || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400"); // 24 h browser cache
    file.createReadStream().pipe(res);
  } catch {
    res.status(404).send("Not found");
  }
});

router.param("id", requireProjectOwnershipParam());

// ── List avatars ──────────────────────────────────────────────────────────────
router.get("/projects/:id/avatars", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const avatars = await db
    .select()
    .from(projectAvatarsTable)
    .where(eq(projectAvatarsTable.projectId, projectId))
    .orderBy(projectAvatarsTable.createdAt);
  res.json({ avatars });
});

// ── Upload new avatar ─────────────────────────────────────────────────────────
router.post(
  "/projects/:id/avatars",
  upload.single("photo"),
  async (req, res): Promise<void> => {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const projectId = req.project!.id;

    if (!req.file) {
      res.status(400).json({ error: "No photo uploaded" });
      return;
    }

    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      res.status(400).json({ error: "Photo must be JPEG, PNG, or WebP" });
      return;
    }

    const { name, instructions } = req.body as { name?: string; instructions?: string };

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      res.status(503).json({ error: "Object storage not configured" });
      return;
    }

    const ext = req.file.mimetype.split("/")[1] ?? "jpg";
    const objectPath = `avatars/project-${projectId}/${Date.now()}.${ext}`;

    const bucket = objectStorageClient.bucket(bucketId);
    const file = bucket.file(objectPath);

    await file.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
    // No makePublic() — bucket has public access prevention enforced.
    const photoUrl = `/api/platform-avatars/photo?key=${encodeURIComponent(objectPath)}&bucket=${encodeURIComponent(bucketId)}`;

    const [avatar] = await db
      .insert(projectAvatarsTable)
      .values({
        projectId,
        name: name?.trim() || "My Avatar",
        photoUrl,
        instructions: instructions?.trim() || null,
      })
      .returning();

    res.status(201).json({ avatar });
  },
);

// ── Update avatar name / instructions ─────────────────────────────────────────
router.patch("/projects/:id/avatars/:avatarId", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const avatarId = parseInt(String(req.params.avatarId ?? ""), 10);
  if (isNaN(avatarId)) { res.status(400).json({ error: "Invalid avatar id" }); return; }

  const { name, instructions } = req.body as { name?: string; instructions?: string };

  const updates: Partial<typeof projectAvatarsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name.trim() || "My Avatar";
  if (instructions !== undefined) updates.instructions = instructions.trim() || null;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [avatar] = await db
    .update(projectAvatarsTable)
    .set(updates)
    .where(and(eq(projectAvatarsTable.id, avatarId), eq(projectAvatarsTable.projectId, projectId)))
    .returning();

  if (!avatar) { res.status(404).json({ error: "Avatar not found" }); return; }
  res.json({ avatar });
});

// ── Delete avatar ─────────────────────────────────────────────────────────────
router.delete("/projects/:id/avatars/:avatarId", async (req, res): Promise<void> => {
  const projectId = req.project!.id;
  const avatarId = parseInt(String(req.params.avatarId ?? ""), 10);
  if (isNaN(avatarId)) { res.status(400).json({ error: "Invalid avatar id" }); return; }

  const [deleted] = await db
    .delete(projectAvatarsTable)
    .where(and(eq(projectAvatarsTable.id, avatarId), eq(projectAvatarsTable.projectId, projectId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Avatar not found" }); return; }
  res.json({ ok: true });
});

export default router;

import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { platformAvatarsTable, usersTable } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { Storage } from "@google-cloud/storage";
import type { Request, Response, NextFunction } from "express";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !["super_admin", "admin"].includes(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

// ── List all platform avatars (admin) ─────────────────────────────────────────
router.get("/admin/platform-avatars", requireAdmin, async (_req, res): Promise<void> => {
  const avatars = await db
    .select()
    .from(platformAvatarsTable)
    .orderBy(asc(platformAvatarsTable.sortOrder), desc(platformAvatarsTable.createdAt));
  res.json({ avatars });
});

// ── Upload new platform avatar ────────────────────────────────────────────────
router.post(
  "/admin/platform-avatars",
  requireAdmin,
  upload.single("photo"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No photo uploaded" });
      return;
    }

    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedMimeTypes.includes(req.file.mimetype)) {
      res.status(400).json({ error: "Photo must be JPEG, PNG, or WebP" });
      return;
    }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      res.status(503).json({ error: "Object storage not configured" });
      return;
    }

    const { name, gender = "neutral", archetype = "presenter", sortOrder } = req.body as {
      name?: string;
      gender?: string;
      archetype?: string;
      sortOrder?: string;
    };

    if (!name?.trim()) {
      res.status(400).json({ error: "Avatar name is required" });
      return;
    }

    const ext = req.file.mimetype.split("/")[1] ?? "jpg";
    const objectId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const objectPath = `avatars/platform/${objectId}.${ext}`;

    const storage = new Storage();
    const bucket = storage.bucket(bucketId);
    const file = bucket.file(objectPath);

    await file.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
    await file.makePublic();
    const [metadata] = await file.getMetadata();
    const previewUrl = metadata.mediaLink as string;

    const [avatar] = await db
      .insert(platformAvatarsTable)
      .values({
        name: name.trim(),
        gender: gender.trim() || "neutral",
        archetype: archetype.trim() || "presenter",
        previewUrl,
        sortOrder: sortOrder ? parseInt(sortOrder, 10) : 0,
      })
      .returning();

    res.status(201).json({ avatar });
  },
);

// ── Update platform avatar metadata ──────────────────────────────────────────
router.patch("/admin/platform-avatars/:avatarId", requireAdmin, async (req, res): Promise<void> => {
  const avatarId = parseInt(String(req.params.avatarId ?? ""), 10);
  if (isNaN(avatarId)) { res.status(400).json({ error: "Invalid avatar id" }); return; }

  const { name, gender, archetype, isActive, sortOrder } = req.body as {
    name?: string;
    gender?: string;
    archetype?: string;
    isActive?: boolean;
    sortOrder?: number;
  };

  const updates: Partial<typeof platformAvatarsTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name.trim() || "Avatar";
  if (gender !== undefined) updates.gender = gender;
  if (archetype !== undefined) updates.archetype = archetype;
  if (isActive !== undefined) updates.isActive = isActive;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const [avatar] = await db
    .update(platformAvatarsTable)
    .set(updates)
    .where(eq(platformAvatarsTable.id, avatarId))
    .returning();

  if (!avatar) { res.status(404).json({ error: "Avatar not found" }); return; }
  res.json({ avatar });
});

// ── Delete platform avatar ────────────────────────────────────────────────────
router.delete("/admin/platform-avatars/:avatarId", requireAdmin, async (req, res): Promise<void> => {
  const avatarId = parseInt(String(req.params.avatarId ?? ""), 10);
  if (isNaN(avatarId)) { res.status(400).json({ error: "Invalid avatar id" }); return; }

  const [deleted] = await db
    .delete(platformAvatarsTable)
    .where(eq(platformAvatarsTable.id, avatarId))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Avatar not found" }); return; }
  res.json({ ok: true });
});

export default router;

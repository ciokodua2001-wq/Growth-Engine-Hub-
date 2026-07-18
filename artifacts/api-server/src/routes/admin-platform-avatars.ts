import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { platformAvatarsTable, usersTable } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { deductPlatformCredits } from "../lib/platformCredits.js";
import { objectStorageClient } from "../lib/objectStorage.js";
import { uploadHeyGenTalkingPhotoBuffer } from "../lib/videoRenderPipeline.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

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

// ── AI vision classification ──────────────────────────────────────────────────
async function classifyAvatarPhoto(
  buffer: Buffer,
  mimeType: AllowedMime,
  fallbackName: string,
): Promise<{ gender: string; archetype: string; name: string }> {
  const base64 = buffer.toString("base64");

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    system: "You are an avatar classifier for a video marketing platform. Analyze portrait photos and return compact JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType, data: base64 },
          },
          {
            type: "text",
            text: `Analyze this portrait photo for a video presenter avatar library. Return ONLY valid JSON (no markdown fences):
{
  "gender": "male" | "female" | "neutral",
  "archetype": "presenter" | "founder" | "exec" | "creative" | "casual" | "educator" | "influencer" | "professional",
  "name": "<a realistic first name matching this person's apparent look, e.g. Sarah, Marcus, Alex>"
}

Pick archetype from visual cues: suit/formal = exec or professional, business casual = presenter or founder, casual wear = casual, artistic/bold = creative, camera-ready = influencer, classroom vibe = educator.`,
          },
        ],
      },
    ],
  });

  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
  const clean = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();

  const validGenders = ["male", "female", "neutral"];
  const validArchetypes = [
    "presenter", "founder", "exec", "creative",
    "casual", "educator", "influencer", "professional",
  ];

  let gender = "neutral";
  let archetype = "presenter";
  let name = fallbackName;

  try {
    const parsed = JSON.parse(clean) as { gender?: string; archetype?: string; name?: string };
    if (parsed.gender && validGenders.includes(parsed.gender)) gender = parsed.gender;
    if (parsed.archetype && validArchetypes.includes(parsed.archetype)) archetype = parsed.archetype;
    if (parsed.name?.trim()) name = parsed.name.trim();
  } catch {
    // Fall back to defaults — upload still proceeds
  }

  // Haiku vision: ~800 in + 50 out tokens ≈ $0.0003 per photo (cheap)
  deductPlatformCredits(
    "anthropic",
    0.0003,
    `Avatar vision classify (haiku)`,
  ).catch(() => {});

  return { gender, archetype, name };
}

// ── Upload single photo to object storage ─────────────────────────────────────
// Returns a stable relative proxy URL — no makePublic() needed (PAP enforced).
async function uploadToStorage(
  buffer: Buffer,
  mimeType: string,
  bucketId: string,
): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "jpg";
  const objectId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const objectPath = `avatars/platform/${objectId}.${ext}`;
  const bucket = objectStorageClient.bucket(bucketId);
  const file = bucket.file(objectPath);
  await file.save(buffer, { metadata: { contentType: mimeType } });
  // Bucket has public access prevention enforced — don't call makePublic().
  // Store a relative proxy URL; the /api/platform-avatars/photo route streams it.
  return `/api/platform-avatars/photo?key=${encodeURIComponent(objectPath)}&bucket=${encodeURIComponent(bucketId)}`;
}

// ── List all platform avatars (admin) ─────────────────────────────────────────
router.get("/admin/platform-avatars", requireAdmin, async (_req, res): Promise<void> => {
  const avatars = await db
    .select()
    .from(platformAvatarsTable)
    .orderBy(asc(platformAvatarsTable.sortOrder), desc(platformAvatarsTable.createdAt));
  res.json({ avatars });
});

// ── Bulk upload + AI auto-classify (up to 50 photos) ─────────────────────────
router.post(
  "/admin/platform-avatars/bulk",
  requireAdmin,
  upload.array("photos", 50),
  async (req, res): Promise<void> => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "No photos uploaded" });
      return;
    }

    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (!bucketId) {
      res.status(503).json({ error: "Object storage not configured" });
      return;
    }

    type BulkResult = {
      filename: string;
      success: boolean;
      avatar?: typeof platformAvatarsTable.$inferSelect;
      error?: string;
    };

    // Process in parallel batches of 5 to respect rate limits
    const BATCH_SIZE = 5;
    const allResults: BulkResult[] = [];

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      const settled = await Promise.allSettled(
        batch.map(async (file): Promise<BulkResult> => {
          if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
            return { filename: file.originalname, success: false, error: "Invalid type — must be JPEG, PNG, or WebP" };
          }

          const fallbackName = file.originalname
            .replace(/\.[^.]+$/, "")
            .replace(/[-_]/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());

          // Step 1: AI vision classify
          const { gender, archetype, name } = await classifyAvatarPhoto(
            file.buffer,
            file.mimetype as AllowedMime,
            fallbackName,
          );

          // Step 2: upload to object storage
          const previewUrl = await uploadToStorage(file.buffer, file.mimetype, bucketId);

          // Step 3: pre-upload to HeyGen and get a stable talking_photo_id now,
          // so renders never hit the slot limit or need to upload at render time.
          let heygenTalkingPhotoId: string | null = null;
          const heygenKey = process.env.HEYGEN_API_KEY;
          if (heygenKey) {
            try {
              heygenTalkingPhotoId = await uploadHeyGenTalkingPhotoBuffer(file.buffer, heygenKey);
            } catch (heyErr) {
              // Non-fatal — renders will fall back to uploading at render time
            }
          }

          // Step 4: insert into DB with cached HeyGen ID
          const [avatar] = await db
            .insert(platformAvatarsTable)
            .values({ name, gender, archetype, previewUrl, heygenTalkingPhotoId, sortOrder: 0 })
            .returning();

          return { filename: file.originalname, success: true, avatar };
        }),
      );

      for (const result of settled) {
        if (result.status === "fulfilled") {
          allResults.push(result.value);
        } else {
          const idx = settled.indexOf(result);
          allResults.push({
            filename: batch[idx]?.originalname ?? "unknown",
            success: false,
            error: result.reason instanceof Error ? result.reason.message : "Upload failed",
          });
        }
      }
    }

    const successCount = allResults.filter((r) => r.success).length;
    res.status(201).json({
      results: allResults,
      successCount,
      totalCount: files.length,
    });
  },
);

// ── Upload single platform avatar (kept for backward compat) ──────────────────
router.post(
  "/admin/platform-avatars",
  requireAdmin,
  upload.single("photo"),
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No photo uploaded" });
      return;
    }

    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(req.file.mimetype)) {
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

    const previewUrl = await uploadToStorage(req.file.buffer, req.file.mimetype, bucketId);

    // Pre-upload to HeyGen and cache the talking_photo_id immediately.
    let heygenTalkingPhotoId: string | null = null;
    const heygenKey = process.env.HEYGEN_API_KEY;
    if (heygenKey) {
      try {
        heygenTalkingPhotoId = await uploadHeyGenTalkingPhotoBuffer(req.file.buffer, heygenKey);
      } catch {
        // Non-fatal — renders will fall back to uploading at render time
      }
    }

    const [avatar] = await db
      .insert(platformAvatarsTable)
      .values({
        name: name.trim(),
        gender: gender.trim() || "neutral",
        archetype: archetype.trim() || "presenter",
        previewUrl,
        heygenTalkingPhotoId,
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

import { Router } from "express";
import { db } from "@workspace/db";
import { requireUserId, loadOwnedProject } from "../lib/authz.js";
import { requireProjectOwnershipParam } from "../lib/authz.js";
import { consumeQuota } from "../lib/planLimits.js";
import { getGroundingContext } from "../lib/projectContext.js";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { Storage } from "@google-cloud/storage";

const router = Router();

router.param("id", requireProjectOwnershipParam());

// ── Generate AI image ─────────────────────────────────────────────────────────
router.post("/projects/:id/images/generate", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  if (isNaN(projectId)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const {
    prompt,
    style = "photorealistic",
    orientation = "landscape",
    count = 1,
  } = req.body as {
    prompt?: string;
    style?: string;
    orientation?: "landscape" | "portrait" | "square";
    count?: number;
  };

  const safeCount = Math.min(Math.max(1, count ?? 1), 4);

  // Enforce trial quota
  const quotaResult = await consumeQuota(projectId, "image_generation", safeCount);
  if (!quotaResult.allowed) {
    res.status(403).json({ error: quotaResult.message });
    return;
  }

  // Load business context to ground the prompt
  const ctx = await getGroundingContext(projectId);

  const sizeMap: Record<string, "1024x1024" | "1536x1024" | "1024x1536"> = {
    square: "1024x1024",
    landscape: "1536x1024",
    portrait: "1024x1536",
  };
  const size = sizeMap[orientation] ?? "1536x1024";

  // Build an enriched prompt grounded in real business context
  const groundedPrompt = buildGroundedPrompt(prompt, style, ctx);

  // Generate images in parallel
  const imagePromises = Array.from({ length: safeCount }, () =>
    generateImageBuffer(groundedPrompt, size)
  );

  const buffers = await Promise.all(imagePromises);

  // Upload each to object storage and collect public URLs
  const urls = await Promise.all(
    buffers.map((buf) => uploadImageToStorage(buf))
  );

  res.json({
    urls,
    prompt: groundedPrompt,
    style,
    orientation,
    count: safeCount,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildGroundedPrompt(
  userPrompt: string | undefined,
  style: string,
  ctx: Awaited<ReturnType<typeof getGroundingContext>>,
): string {
  const stylePrefix: Record<string, string> = {
    photorealistic: "Photorealistic professional marketing photo",
    illustration: "Clean modern digital illustration",
    "3d": "3D render, professional product visualization",
    minimal: "Minimalist flat design marketing image",
    cinematic: "Cinematic marketing shot, dramatic lighting",
  };

  const prefix = stylePrefix[style] ?? "Professional marketing image";

  if (userPrompt) {
    const businessSuffix = ctx
      ? `. Brand context: ${ctx.businessName}, ${ctx.tagline ?? ""}`
      : "";
    return `${prefix}: ${userPrompt}${businessSuffix}`;
  }

  // Auto-generate from business context
  if (ctx) {
    return `${prefix} for ${ctx.businessName}. ${ctx.tagline ?? ctx.industry ?? ""}. Professional, high quality, suitable for marketing.`;
  }

  return `${prefix}. Professional, high quality, suitable for marketing.`;
}

async function uploadImageToStorage(buffer: Buffer): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    throw new Error("Object storage not configured (DEFAULT_OBJECT_STORAGE_BUCKET_ID not set)");
  }

  const storage = new Storage();
  const bucket = storage.bucket(bucketId);
  const filename = `images/generated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const file = bucket.file(filename);

  await file.save(buffer, { metadata: { contentType: "image/png" } });
  await file.makePublic();

  const [metadata] = await file.getMetadata();
  return metadata.mediaLink as string;
}

export default router;

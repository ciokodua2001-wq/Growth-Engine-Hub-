import { Router } from "express";
import { db } from "@workspace/db";
import { requireUserId, loadOwnedProject } from "../lib/authz.js";
import { requireProjectOwnershipParam } from "../lib/authz.js";
import { consumeQuota } from "../lib/planLimits.js";
import { getGroundingContext } from "../lib/projectContext.js";
import { generateImageBuffer } from "@workspace/integrations-openai-ai-server/image";
import { objectStorageClient, signObjectURL } from "../lib/objectStorage.js";

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
  let buffers: Buffer[];
  try {
    const imagePromises = Array.from({ length: safeCount }, () =>
      generateImageBuffer(groundedPrompt, size)
    );
    buffers = await Promise.all(imagePromises);
  } catch (err: unknown) {
    req.log.error({ err }, "Image generation failed");
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Image generation failed: ${message}` });
    return;
  }

  // Upload each to object storage and collect public URLs
  let urls: string[];
  try {
    urls = await Promise.all(buffers.map((buf) => uploadImageToStorage(buf)));
  } catch (err: unknown) {
    req.log.error({ err }, "Image upload failed");
    res.status(502).json({ error: "Failed to upload generated image" });
    return;
  }

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
      ? `. Brand context: ${ctx.project.name}, ${ctx.analysis.uniqueValueProposition ?? ""}`
      : "";
    return `${prefix}: ${userPrompt}${businessSuffix}`;
  }

  // Auto-generate from business context
  if (ctx) {
    return `${prefix} for ${ctx.project.name}. ${ctx.analysis.uniqueValueProposition ?? ctx.analysis.industry ?? ""}. Professional, high quality, suitable for marketing.`;
  }

  return `${prefix}. Professional, high quality, suitable for marketing.`;
}

async function uploadImageToStorage(buffer: Buffer): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    throw new Error("Object storage not configured (DEFAULT_OBJECT_STORAGE_BUCKET_ID not set)");
  }

  const objectName = `images/generated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const bucket = objectStorageClient.bucket(bucketId);
  await bucket.file(objectName).save(buffer, { metadata: { contentType: "image/png" } });

  // 30-day signed URL — long-lived enough for marketing use
  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 60 * 60 * 24 * 30 });
}

export default router;

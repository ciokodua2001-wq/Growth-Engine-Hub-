/**
 * Narration routes — generate, retrieve, and clear ElevenLabs narration
 * for a commercial video.
 *
 * POST /projects/:id/videos/:videoId/narration/generate
 *   Body: { voiceStyle, script? }
 *   Synchronous — returns the narration URL immediately (~2-8 s).
 *
 * GET  /projects/:id/videos/:videoId/narration
 *   Returns current narration metadata (URL, style, whether enabled).
 *
 * DELETE /projects/:id/videos/:videoId/narration
 *   Clears narration so the assembler falls back to music-only.
 *
 * GET /projects/:id/videos/:videoId/narration/voices
 *   Returns the voice style catalogue (no generation, free to call).
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import {
  generateNarration,
  prepareScript,
  checkNarratorRequirements,
  getVoiceStyleCatalogue,
  VOICE_STYLES,
  type VoiceStyle,
} from "../lib/elevenLabsNarrator.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "narration.route" });

router.param("id", requireProjectOwnershipParam());

// ── GET /projects/:id/videos/:videoId/narration/voices ────────────────────────
// Voice catalogue — safe to call without triggering any generation.
router.get("/projects/:id/videos/:videoId/narration/voices", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const req_ = checkNarratorRequirements();
  res.json({
    voices: getVoiceStyleCatalogue(),
    provider: req_.provider,
    elevenLabsConfigured: req_.elevenLabsConfigured,
  });
});

// ── POST /projects/:id/videos/:videoId/narration/generate ─────────────────────
router.post("/projects/:id/videos/:videoId/narration/generate", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  // ── Fetch and verify video ─────────────────────────────────────────────────
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  // ── Parse and validate options ─────────────────────────────────────────────
  const body = req.body as Record<string, unknown>;

  const rawStyle = String(body.voiceStyle ?? "male");
  if (!VOICE_STYLES.includes(rawStyle as VoiceStyle)) {
    res.status(400).json({
      error: "Invalid voiceStyle",
      valid: VOICE_STYLES,
      received: rawStyle,
    });
    return;
  }
  const voiceStyle = rawStyle as VoiceStyle;

  // Use caller-supplied script, video.voiceover, then video.script
  const rawScript =
    (typeof body.script === "string" && body.script.trim()) ||
    video.voiceover ||
    video.script ||
    video.title;

  if (!rawScript) {
    res.status(422).json({
      error: "No script available",
      message:
        "Provide a 'script' in the request body, or ensure the video has a voiceover or script field.",
    });
    return;
  }

  const prepared = prepareScript(rawScript);
  if (!prepared) {
    res.status(422).json({ error: "Script is empty after cleaning" });
    return;
  }

  logger.info(
    { projectId, videoId, voiceStyle, scriptChars: prepared.length },
    "[narration] Generating commercial narration",
  );

  // ── Generate narration (synchronous — typically 2-8 s) ────────────────────
  let result;
  try {
    result = await generateNarration({ script: rawScript, voiceStyle, videoId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Narration generation failed";
    logger.error({ err, videoId, voiceStyle }, "[narration] Generation failed");
    res.status(500).json({ error: "Narration generation failed", detail: msg });
    return;
  }

  // ── Persist to DB ──────────────────────────────────────────────────────────
  await db
    .update(videosTable)
    .set({
      voiceoverUrl: result.narrationUrl,
      narrationVoiceStyle: voiceStyle,
    })
    .where(eq(videosTable.id, videoId));

  logger.info(
    { videoId, voiceStyle, provider: result.voiceProvider },
    "[narration] Narration stored on video record",
  );

  res.status(201).json({
    videoId,
    voiceStyle,
    provider: result.voiceProvider,
    openAiVoice: result.openAiVoice,
    narrationUrl: result.narrationUrl,
    scriptText: result.scriptText,
    scriptChars: result.scriptChars,
    message: `Narration generated using ${result.voiceProvider === "elevenlabs" ? "ElevenLabs" : "OpenAI TTS"} (${voiceStyle} voice)`,
    // Convenience: include this URL directly in assemble options
    assembleHint: "Pass narrationUrl to POST /assemble to mix narration into the final commercial.",
  });
});

// ── GET /projects/:id/videos/:videoId/narration ───────────────────────────────
router.get("/projects/:id/videos/:videoId/narration", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  const { provider, elevenLabsConfigured } = checkNarratorRequirements();

  res.json({
    videoId,
    narrationEnabled: !!video.voiceoverUrl,
    narrationUrl: video.voiceoverUrl ?? null,
    voiceStyle: (video.narrationVoiceStyle as VoiceStyle | null) ?? null,
    provider,
    elevenLabsConfigured,
    // Show what script would be used if generating now
    availableScript: !!(video.voiceover || video.script),
  });
});

// ── DELETE /projects/:id/videos/:videoId/narration ────────────────────────────
// Clears narration — assembler will use music-only mode.
router.delete("/projects/:id/videos/:videoId/narration", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) {
    res.status(400).json({ error: "Invalid project or video ID" });
    return;
  }

  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));

  if (!video) {
    res.status(404).json({ error: "Video not found" });
    return;
  }

  await db
    .update(videosTable)
    .set({ voiceoverUrl: null, narrationVoiceStyle: null })
    .where(eq(videosTable.id, videoId));

  logger.info({ videoId }, "[narration] Narration cleared — assembler will use music-only");

  res.json({
    videoId,
    message: "Narration cleared. The assembler will use background music only.",
  });
});

export default router;

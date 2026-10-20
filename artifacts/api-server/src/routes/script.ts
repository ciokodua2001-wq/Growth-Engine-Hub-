import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Router } from "express";
import { db } from "@workspace/db";
import { videosTable, commercialAssembliesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireUserId, requireProjectOwnershipParam } from "../lib/authz.js";
import {
  compareScriptToTranscript,
  transcribeAudioWithGemini,
  assignEstimatedTiming,
  type TranscriptSegment,
} from "../lib/dialogue.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "script.route" });
const execFileAsync = promisify(execFile);

router.param("id", requireProjectOwnershipParam());

async function loadOwnedVideo(projectId: number, videoId: number) {
  const [video] = await db
    .select()
    .from(videosTable)
    .where(and(eq(videosTable.id, videoId), eq(videosTable.projectId, projectId)));
  return video ?? null;
}

// ── GET script approval/versioning state ─────────────────────────────────────
router.get("/projects/:id/videos/:videoId/script", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  res.json({
    script: video.script,
    approvedScript: video.approvedScript,
    scriptStatus: video.scriptStatus,
    approvedScriptVersion: video.approvedScriptVersion,
    approvedAt: video.approvedAt,
    creativeMode: video.creativeMode,
    isApproved: video.scriptStatus === "approved" && !!video.approvedScript,
  });
});

// ── POST approve script (lock exact wording + version) ───────────────────────
router.post("/projects/:id/videos/:videoId/script/approve", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  const script = typeof req.body?.script === "string" ? req.body.script : video.script;
  if (!script || !script.trim()) {
    res.status(422).json({ error: "Cannot approve an empty script" });
    return;
  }

  const nextVersion = (video.approvedScriptVersion ?? 0) + 1;
  const [updated] = await db
    .update(videosTable)
    .set({
      script: script.trim(),
      approvedScript: script.trim(),
      scriptStatus: "approved",
      approvedScriptVersion: nextVersion,
      approvedAt: new Date(),
    })
    .where(eq(videosTable.id, videoId))
    .returning();

  logger.info({ videoId, version: nextVersion }, "[script] Approved script (version locked)");
  res.json({
    approvedScript: updated.approvedScript,
    scriptStatus: updated.scriptStatus,
    approvedScriptVersion: updated.approvedScriptVersion,
    approvedAt: updated.approvedAt,
  });
});

// ── POST transcribe actual assembled audio + fidelity check ──────────────────
router.post("/projects/:id/videos/:videoId/transcript", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  // Authoritative source = the final assembled video (not the script, not scenes).
  const [assembly] = await db
    .select()
    .from(commercialAssembliesTable)
    .where(and(eq(commercialAssembliesTable.videoId, videoId), eq(commercialAssembliesTable.status, "complete")))
    .orderBy(desc(commercialAssembliesTable.id));
  const sourceUrl = assembly?.videoUrl ?? video.videoUrl;
  if (!sourceUrl) {
    res.status(409).json({ error: "No assembled video available to transcribe", message: "Assemble the video first." });
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gf-transcribe-"));
  try {
    // 1. Download the assembled MP4.
    const mp4Path = path.join(tmpDir, "in.mp4");
    const dl = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) });
    if (!dl.ok) throw new Error(`Assembly fetch HTTP ${dl.status}`);
    fs.writeFileSync(mp4Path, Buffer.from(await dl.arrayBuffer()));

    // 2. Extract the audio track (mono 16k mp3 for the transcription model).
    const mp3Path = path.join(tmpDir, "audio.mp3");
    await execFileAsync("ffmpeg", ["-y", "-i", mp4Path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", mp3Path]);
    const audioB64 = fs.readFileSync(mp3Path).toString("base64");

    // 3. Transcribe the actual audio (existing Gemini key - phrase-level, no word timestamps).
    const languageHint = typeof req.body?.languageHint === "string" ? req.body.languageHint : undefined;
    const transcriptText = await transcribeAudioWithGemini(audioB64, "audio/mp3", languageHint);

    const rawSegments: TranscriptSegment[] = transcriptText
      .split(/\n+/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(text => ({ text }));

    // Real assembled duration for estimated timing - never pretend word-accurate.
    // Segments start as `estimated`; they must be reviewed before caption export.
    const totalDuration = Number(assembly?.durationSec) || Number(video.duration) || 15;
    const segments = assignEstimatedTiming(rawSegments, totalDuration);

    // 4. Compare against the approved (or draft) script.
    const reference = video.approvedScript ?? video.script ?? "";
    const report = compareScriptToTranscript(reference, transcriptText);

    await db
      .update(videosTable)
      .set({
        dialogueTranscript: segments,
        transcriptStatus: "needs_review", // always review before caption export
        fidelityStatus: report.status,
        fidelityReport: report,
      })
      .where(eq(videosTable.id, videoId));

    res.json({ transcript: segments, transcriptText, fidelity: report });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── PUT transcript (customer correction + manual timing review) ──────────────
// The customer reviews the transcript, fixes any mis-heard words, and sets the
// timing windows. This is the ONLY thing eligible for caption export - never the
// approved script, never the per-scene narrationLine.
router.put("/projects/:id/videos/:videoId/transcript", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  const body = req.body?.segments;
  if (!Array.isArray(body) || body.length === 0) {
    res.status(422).json({ error: "segments must be a non-empty array" });
    return;
  }

  const segments: TranscriptSegment[] = body
    .map(s => ({
      text: String((s as any)?.text ?? "").trim(),
      startSec: typeof (s as any)?.startSec === "number" ? (s as any).startSec : undefined,
      endSec: typeof (s as any)?.endSec === "number" ? (s as any).endSec : undefined,
      timingSource: "manual" as const,
      reviewed: true,
    }))
    .filter(s => s.text);

  if (segments.length === 0) { res.status(422).json({ error: "No non-empty transcript segments" }); return; }

  const transcriptText = segments.map(s => s.text).join("\n");
  const report = compareScriptToTranscript(video.approvedScript ?? video.script ?? "", transcriptText);

  await db
    .update(videosTable)
    .set({
      dialogueTranscript: segments,
      transcriptStatus: "ready",
      fidelityStatus: report.status,
      fidelityReport: report,
    })
    .where(eq(videosTable.id, videoId));

  res.json({ transcript: segments, fidelity: report, transcriptStatus: "ready" });
});

// ── POST accept performance ──────────────────────────────────────────────────
// Customer accepts the spoken performance even if it deviates from the approved
// script. Does NOT change the historical approved-script record.
router.post("/projects/:id/videos/:videoId/transcript/accept", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  await db.update(videosTable).set({ transcriptStatus: "accepted" }).where(eq(videosTable.id, videoId));
  res.json({ transcriptStatus: "accepted", note: "Performance accepted - approved-script record unchanged." });
});

// ── GET fidelity report + transcript ─────────────────────────────────────────
router.get("/projects/:id/videos/:videoId/fidelity", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  res.json({
    fidelityStatus: video.fidelityStatus,
    transcriptStatus: video.transcriptStatus,
    approvedScript: video.approvedScript ?? video.script,
    transcript: video.dialogueTranscript,
    report: video.fidelityReport,
  });
});

export default router;

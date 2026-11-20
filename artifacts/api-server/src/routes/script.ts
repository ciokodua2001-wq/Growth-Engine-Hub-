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
import { signObjectURL } from "../lib/objectStorage.js";
import {
  compareScriptToTranscript,
  transcribeAudioWithFailover,
  parseTimestampedTranscript,
  assignEstimatedTiming,
  hashScript,
  suggestScriptImprovement,
  type TranscriptSegment,
} from "../lib/dialogue.js";
import pino from "pino";

const router = Router();
const logger = pino({ name: "script.route" });
const execFileAsync = promisify(execFile);

router.param("id", requireProjectOwnershipParam());

/**
 * Re-sign a stored presigned object URL with a fresh short TTL.
 *
 * Assembly/video URLs are persisted with a 24-hour SigV4 TTL. The read paths
 * (assemble.ts) re-sign before every fetch/player load, but any route that
 * fetches the *stored* URL directly will fail with an opaque S3 403 once that
 * TTL lapses - which is exactly what made "Transcribe & Check Fidelity" report
 * "The assembled video could not be retrieved" on renders older than a day
 * while the player kept working fine.
 */
async function refreshMediaUrl(storedUrl: string): Promise<string> {
  if (!storedUrl) return storedUrl;
  // Grok renders persist a stable grok-object://{bucket}/{key} reference, not a
  // presigned URL. Resolve it the same way the /media route does.
  if (storedUrl.startsWith("grok-object://")) {
    const ref = storedUrl.slice("grok-object://".length);
    const slash = ref.indexOf("/");
    if (slash > 0) {
      const bucket = decodeURIComponent(ref.slice(0, slash));
      const key = ref.slice(slash + 1).split("/").map(decodeURIComponent).join("/");
      return signObjectURL({ bucketName: bucket, objectName: key, method: "GET", ttlSec: 86_400 });
    }
    return storedUrl;
  }
  if (!storedUrl.startsWith("http")) return storedUrl;
  try {
    const u = new URL(storedUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return storedUrl;
    const bucketName = parts[0]!;
    // Decode percent-escapes (spaces etc.) so the object key is exact - an
    // encoded "%20" re-encoded as "%2520" points at the wrong object (404).
    const objectName = parts.slice(1).map(decodeURIComponent).join("/");
    return await signObjectURL({ bucketName, objectName, method: "GET", ttlSec: 86_400 });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), urlPrefix: storedUrl.slice(0, 90) },
      "[script] Could not re-sign stored media URL; using it as-is",
    );
    return storedUrl;
  }
}

/** Trimmed host + key of a media URL for diagnostics (never logs the signature). */
function describeMediaUrl(url: string): string {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return "<unparseable>"; }
}

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
  let failureStage = "prepare";
  try {
    // 1. Download the assembled MP4.
    failureStage = "download assembled video";
    const mp4Path = path.join(tmpDir, "in.mp4");
    const fetchUrl = await refreshMediaUrl(sourceUrl);
    const dl = await fetch(fetchUrl, { signal: AbortSignal.timeout(120_000) });
    if (!dl.ok) {
      const body = (await dl.text().catch(() => "")).slice(0, 300);
      logger.error(
        { videoId, projectId, httpStatus: dl.status, media: describeMediaUrl(fetchUrl), usedAssembly: !!assembly?.videoUrl, body },
        "[script] Assembled video download failed",
      );
      throw new Error(`Assembly fetch HTTP ${dl.status} for ${describeMediaUrl(fetchUrl)}: ${body}`);
    }
    const buf = Buffer.from(await dl.arrayBuffer());
    if (buf.length < 1024) throw new Error(`Assembly fetch returned ${buf.length} bytes (expected a full MP4)`);
    fs.writeFileSync(mp4Path, buf);

    // 2. Extract the audio track (mono 16k mp3 for the transcription model).
    failureStage = "extract audio";
    const mp3Path = path.join(tmpDir, "audio.mp3");
    await execFileAsync("ffmpeg", ["-y", "-i", mp4Path, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", mp3Path]);
    const audioB64 = fs.readFileSync(mp3Path).toString("base64");

    // 3. Transcribe the actual audio (Gemini primary, Qwen omni automatic
    //    fallback on provider outage - phrase-level, no word timestamps).
    failureStage = "transcribe audio";
    const languageHint = typeof req.body?.languageHint === "string" ? req.body.languageHint : undefined;
    const transcription = await transcribeAudioWithFailover(audioB64, "audio/mp3", languageHint);
    const transcriptText = transcription.text;
    if (!transcriptText) throw new Error("Transcription provider returned no spoken words");

    const rawSegments: TranscriptSegment[] = transcriptText
      .split(/\n+/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(text => ({ text }));

    // Real assembled duration - never pretend word-accurate.
    const totalDuration = Number(assembly?.durationSec) || Number(video.duration) || 15;

    // Prefer timings the model measured FROM THE AUDIO. That is what keeps
    // captions in sync through the middle of the clip; character-count spacing
    // accumulates error and visibly drifts. Falls back to estimated spacing
    // only when the model ignored the timestamp format.
    const measured = parseTimestampedTranscript(transcriptText, totalDuration);
    const segments = measured ?? assignEstimatedTiming(rawSegments, totalDuration);
    logger.info(
      { videoId, timing: measured ? "measured" : "estimated", segments: segments.length, totalDuration },
      "[script] Caption timings assigned",
    );

    // 4. Compare against the approved (or draft) script.
    const reference = video.approvedScript ?? video.script ?? "";
    const report = compareScriptToTranscript(reference, transcriptText);
    logger.info({ videoId, projectId, provider: transcription.provider }, "[script] Transcription completed");

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
  } catch (error) {
    logger.error({ videoId, projectId, stage: failureStage, error: error instanceof Error ? error.message : String(error) }, "[script] Transcript and fidelity check failed");
    res.status(502).json({
      error: "Transcribe & Check Fidelity failed",
      message: failureStage === "download assembled video"
        ? "The assembled video could not be retrieved. Please retry in a moment."
        : failureStage === "extract audio"
          ? "Audio could not be extracted from this video. Please contact support if this continues."
          : "The audio transcription service did not complete. Please retry in a moment.",
    });
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

// ── Optional single AI script-improvement suggestion (cached per script version) ─
interface ScriptSuggestion {
  scriptHash: string;
  suggestion: string;
  status: "pending" | "accepted" | "rejected";
  generatedAt: string;
}

function parseSuggestion(raw: unknown): ScriptSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.scriptHash !== "string" || typeof o.suggestion !== "string") return null;
  return {
    scriptHash: o.scriptHash,
    suggestion: o.suggestion,
    status: (o.status as ScriptSuggestion["status"]) ?? "pending",
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : new Date().toISOString(),
  };
}

router.post("/projects/:id/videos/:videoId/script/suggestion", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  const base = (video.approvedScript ?? video.script ?? "").trim();
  if (!base) { res.status(422).json({ error: "No script to improve yet" }); return; }

  const h = hashScript(base);
  const existing = parseSuggestion(video.scriptSuggestion);
  // Cache hit: same script version already suggested - return it, no new AI charge.
  if (existing && existing.scriptHash === h && existing.suggestion) {
    res.json({ ...existing, cached: true });
    return;
  }

  try {
    const suggestion = await suggestScriptImprovement(base);
    const record: ScriptSuggestion = { scriptHash: h, suggestion, status: "pending", generatedAt: new Date().toISOString() };
    await db.update(videosTable).set({ scriptSuggestion: record }).where(eq(videosTable.id, videoId));
    res.json({ ...record, cached: false });
  } catch (err) {
    req.log?.error?.({ err, videoId }, "Script suggestion generation failed");
    res.status(502).json({ error: "Could not generate a suggestion. Please try again." });
  }
});

router.post("/projects/:id/videos/:videoId/script/suggestion/accept", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  const s = parseSuggestion(video.scriptSuggestion);
  if (!s || !s.suggestion) { res.status(409).json({ error: "No pending suggestion to accept" }); return; }

  // Explicit accept: replace script and reset approval (re-approval required). No silent rewrite.
  await db.update(videosTable).set({
    script: s.suggestion,
    scriptStatus: "proposed",
    approvedScript: null,
    approvedScriptVersion: 0,
    approvedAt: null,
    scriptSuggestion: { ...s, status: "accepted" },
  }).where(eq(videosTable.id, videoId));

  res.json({ accepted: true, script: s.suggestion, note: "Script updated - re-approval required before filming." });
});

router.post("/projects/:id/videos/:videoId/script/suggestion/reject", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const projectId = parseInt(req.params.id, 10);
  const videoId = parseInt(req.params.videoId, 10);
  if (isNaN(projectId) || isNaN(videoId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const video = await loadOwnedVideo(projectId, videoId);
  if (!video) { res.status(404).json({ error: "Video not found" }); return; }

  const s = parseSuggestion(video.scriptSuggestion);
  if (s) {
    await db.update(videosTable).set({ scriptSuggestion: { ...s, status: "rejected" } }).where(eq(videosTable.id, videoId));
  }
  res.json({ rejected: true });
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

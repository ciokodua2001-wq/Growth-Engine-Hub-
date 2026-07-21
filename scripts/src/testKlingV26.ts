/**
 * Test script: Kling v2.6 Native Audio
 *
 * Submits one text-to-video request with sound enabled, polls until done,
 * then downloads the MP4 to /tmp/kling-v26-test.mp4 so you can listen to it.
 *
 * Usage:
 *   KLING_V26_API_KEY=<your-new-key> pnpm --filter @workspace/scripts run test-kling-v26
 *
 * The production KLING_API_KEY and pipeline are untouched.
 */

import fs from "fs";
import https from "https";
import http from "http";

const BASE_URL = "https://api-singapore.klingai.com";
const MODEL    = "kling-v2-6";
const OUT_FILE = "/tmp/kling-v26-test.mp4";

// ── Test prompt — mirrors a real GrowthForge scene ───────────────────────────
// Includes explicit audio direction so we can evaluate what Kling generates.
const TEST_PROMPT =
  "Busy city street, crowds of people walking, traffic noise, urban energy. " +
  "A confident man walks directly toward the camera, looks into the lens and says: " +
  "'GrowthForge builds your marketing department in minutes.' " +
  "Cinematic handheld camera, natural daylight, vibrant street atmosphere. " +
  "No text, no signs, no writing.";

const NEGATIVE_PROMPT =
  "blurry, low quality, watermark, text, letters, words, signs, " +
  "subtitles, captions, on-screen text";

// ── Auth ──────────────────────────────────────────────────────────────────────
function getApiKey(): string {
  const key = process.env.KLING_V26_API_KEY;
  if (!key) {
    console.error(
      "\n❌  KLING_V26_API_KEY is not set.\n" +
      "    Generate a new key at https://klingai.com/global/dev\n" +
      "    then run:  KLING_V26_API_KEY=<key> pnpm --filter @workspace/scripts run test-kling-v26\n",
    );
    process.exit(1);
  }
  return key;
}

// ── Kling API types ───────────────────────────────────────────────────────────
interface KlingResponse {
  code:    number;
  message: string;
  data:    { task_id: string; task_status: string; task_status_msg?: string; task_result?: { videos?: { url: string }[] } };
}

// ── Step 1: Submit ────────────────────────────────────────────────────────────
async function submit(apiKey: string): Promise<string> {
  console.log("📤  Submitting to Kling v2.6 with Native Audio (sound: on) …");
  const res = await fetch(`${BASE_URL}/v1/videos/text2video`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name:      MODEL,
      prompt:          TEST_PROMPT,
      negative_prompt: NEGATIVE_PROMPT,
      duration:        "5",
      mode:            "pro",
      aspect_ratio:    "16:9",
      cfg_scale:       0.5,
      sound:           "on",   // ← Native Audio flag
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Submit HTTP ${res.status}: ${text.slice(0, 400)}`);

  const json = JSON.parse(text) as KlingResponse;
  if (json.code !== 0) throw new Error(`Submit error (code=${json.code}): ${json.message}`);

  const taskId = json.data.task_id;
  console.log(`✅  Task created: ${taskId}`);
  return taskId;
}

// ── Step 2: Poll ──────────────────────────────────────────────────────────────
async function poll(apiKey: string, taskId: string): Promise<string> {
  console.log("⏳  Polling … (Kling v2.6 typically takes 2–4 minutes)");
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));

    const res = await fetch(`${BASE_URL}/v1/videos/text2video/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as KlingResponse;

    const status = json.data.task_status;
    process.stdout.write(`    [${i + 1}/60] status=${status}\r`);

    if (status === "succeed") {
      const url = json.data.task_result?.videos?.[0]?.url;
      if (!url) throw new Error("Succeeded but no video URL returned");
      console.log(`\n✅  Done — video URL: ${url}`);
      return url;
    }
    if (status === "failed") {
      throw new Error(`Kling generation failed: ${json.data.task_status_msg ?? "unknown"}`);
    }
  }
  throw new Error("Timed out after 10 minutes");
}

// ── Step 3: Download ──────────────────────────────────────────────────────────
async function download(url: string, dest: string): Promise<void> {
  console.log(`📥  Downloading MP4 to ${dest} …`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib  = url.startsWith("https") ? https : http;
    lib.get(url, res => {
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
const apiKey = getApiKey();
const taskId = await submit(apiKey);
const videoUrl = await poll(apiKey, taskId);
await download(videoUrl, OUT_FILE);

console.log("\n🎬  Test complete!");
console.log(`    File saved: ${OUT_FILE}`);
console.log("    Open it and listen — specifically check:");
console.log("    • Does it have audio at all?");
console.log("    • Is the audio consistent in style and tone?");
console.log("    • Does it say anything about the product / business?");
console.log("    • Is the quality good enough to replace TTS narration?");

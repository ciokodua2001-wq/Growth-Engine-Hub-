/**
 * FFmpeg helpers specific to the Wan 2.2 render pipeline:
 *   - transcodeWebmToMp4(): ComfyUI's SaveWEBM node has no native MP4 muxer,
 *     so the raw worker output is re-packaged into MP4/H.264 to match the
 *     existing Kling scene convention that ffmpegAssembler.ts and the video
 *     download/preview UI already assume.
 *   - extractLastFramePng(): pulls the final frame of a completed clip for
 *     Wan I2V scene-continuity (the next scene's `sourceFrameUrl`).
 */

import { spawn } from "child_process";
import * as fs from "fs";
import pino from "pino";

const logger = pino({ name: "wanFfmpeg" });
const FFMPEG_BIN = "ffmpeg";

function runFFmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`FFmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-1500)}`));
      } else {
        resolve();
      }
    });
    proc.on("error", err => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

/**
 * Re-packages a WEBM (VP9) clip into a web-standard MP4 (H.264 + AAC-ready,
 * though Wan clips are silent — no audio stream is produced or expected).
 * Fast: these are single 5s clips, not full commercial assemblies.
 */
export async function transcodeWebmToMp4(inputPath: string, outputPath: string): Promise<void> {
  logger.info({ inputPath, outputPath }, "[wanFfmpeg] Transcoding WEBM → MP4");
  await runFFmpeg([
    "-y",
    "-i", inputPath,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an", // Wan clips have no audio track — explicit, avoids ffmpeg guessing
    outputPath,
  ]);
}

/**
 * Extracts the last frame of a video file as a PNG, for Wan I2V scene
 * continuity (feeding the next scene's `sourceFrameUrl`).
 */
export async function extractLastFramePng(inputPath: string, outputPath: string): Promise<void> {
  logger.info({ inputPath, outputPath }, "[wanFfmpeg] Extracting last frame");
  await runFFmpeg([
    "-y",
    "-sseof", "-1",
    "-i", inputPath,
    "-update", "1",
    "-q:v", "2",
    "-frames:v", "1",
    outputPath,
  ]);
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error("Last-frame extraction produced an empty file");
  }
}

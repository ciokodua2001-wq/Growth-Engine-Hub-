/**
 * Google Cloud TTS Commercial Narrator
 *
 * Generates professional narration audio for 30-second commercials using
 * Google Cloud Text-to-Speech's Chirp 3: HD voice tier — native bilingual
 * Canadian localization (en-CA / fr-CA) with no ElevenLabs/OpenAI dependency.
 *
 * Six voice styles:
 *   male       — clear, confident male voice
 *   female     — warm, articulate female voice
 *   corporate  — authoritative, professional (B2B)
 *   friendly   — approachable, warm (consumer)
 *   luxury     — smooth, refined (premium brands)
 *   energetic  — dynamic, high-energy (action-driven)
 */

import pino from "pino";
import { synthesizeSpeech, type NarrationLocale } from "@workspace/integrations-google-tts-server";
import { deductPlatformCredits } from "./platformCredits.js";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";

const logger = pino({ name: "googleNarrator" });

// Max chars: ~27.5 s × 12 chars/s ≈ 330. Cap at 600 to leave headroom.
const MAX_SCRIPT_CHARS = 600;

// ── Voice style definitions ───────────────────────────────────────────────────

export type VoiceStyle = "male" | "female" | "corporate" | "friendly" | "luxury" | "energetic";

export const VOICE_STYLES: VoiceStyle[] = [
  "male",
  "female",
  "corporate",
  "friendly",
  "luxury",
  "energetic",
];

interface VoiceConfig {
  // Chirp 3: HD speaker name — shared across all locales, so swapping
  // locale (en-CA <-> fr-CA) keeps the same "character" speaking.
  speaker: string;
  description: string;
}

const VOICE_CONFIGS: Record<VoiceStyle, VoiceConfig> = {
  male:      { speaker: "Charon",      description: "Clear, confident male voice" },
  female:    { speaker: "Kore",        description: "Warm, articulate female voice" },
  corporate: { speaker: "Sadaltager",  description: "Authoritative, professional tone for B2B brands" },
  friendly:  { speaker: "Aoede",       description: "Warm, approachable tone for consumer brands" },
  luxury:    { speaker: "Iapetus",     description: "Smooth, refined tone for premium and luxury brands" },
  energetic: { speaker: "Puck",        description: "Dynamic, high-energy tone for action-driven campaigns" },
};

function voiceName(locale: NarrationLocale, speaker: string): string {
  return `${locale}-Chirp3-HD-${speaker}`;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface NarrationResult {
  narrationUrl: string;
  voiceStyle: VoiceStyle;
  voiceProvider: "google-tts";
  voiceName: string;
  locale: NarrationLocale;
  scriptText: string;
  scriptChars: number;
}

// ── Main narration generator ──────────────────────────────────────────────────

/**
 * Generates professional narration audio for the given script text via
 * Google Cloud TTS. Pass `locale` "fr-CA" for French-Canadian narration —
 * defaults to "en-CA".
 */
export async function generateNarration(params: {
  script: string;
  voiceStyle: VoiceStyle;
  videoId: number;
  locale?: NarrationLocale;
}): Promise<NarrationResult> {
  const { script, voiceStyle, videoId, locale = "en-CA" } = params;
  const config = VOICE_CONFIGS[voiceStyle];
  const name = voiceName(locale, config.speaker);

  const scriptText = prepareScript(script);
  if (!scriptText) throw new Error("Script text is empty — cannot generate narration");

  logger.info(
    { videoId, voiceStyle, voiceName: name, locale, chars: scriptText.length },
    "[Narrator] Generating commercial narration via Google Cloud TTS",
  );

  const audioBuffer = await synthesizeSpeech({ text: scriptText, voiceName: name, locale, format: "mp3" });
  const narrationUrl = await uploadAudio(audioBuffer, "mp3", videoId, voiceStyle);

  deductPlatformCredits(
    "google-tts",
    scriptText.length,
    `Narration TTS (${scriptText.length} chars) — video #${videoId}`,
  ).catch(() => {});

  logger.info({ videoId, voiceStyle, locale }, "[Narrator] Google Cloud TTS narration generated \u2713");

  return {
    narrationUrl,
    voiceStyle,
    voiceProvider: "google-tts",
    voiceName: name,
    locale,
    scriptText,
    scriptChars: scriptText.length,
  };
}

// ── Script preparation ────────────────────────────────────────────────────────

/**
 * Prepares script text for narration:
 * 1. Removes markdown formatting, stage directions ([...]), and URLs
 * 2. Normalises whitespace
 * 3. Caps at MAX_SCRIPT_CHARS (~30s of speech at natural pace)
 */
export function prepareScript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")           // remove [stage directions]
    .replace(/https?:\/\/\S+/g, "")        // remove URLs
    .replace(/[*_#`~>|]/g, "")             // remove markdown symbols
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SCRIPT_CHARS);
}

// ── Object storage upload ─────────────────────────────────────────────────────

async function uploadAudio(
  buffer: Buffer,
  format: "mp3" | "wav",
  videoId: number,
  voiceStyle: VoiceStyle,
): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

  const objectName = `renders/narration/video-${videoId}-${voiceStyle}-${Date.now()}.${format}`;
  const bucket = objectStorageClient.bucket(bucketId);
  await bucket.file(objectName).save(buffer, {
    metadata: { contentType: `audio/${format}` },
  });

  logger.info({ objectName, bytes: buffer.length }, "[Narrator] Audio uploaded to storage");

  return signObjectURL({ bucketName: bucketId, objectName, method: "GET", ttlSec: 86_400 });
}

// ── Requirements check ────────────────────────────────────────────────────────

/**
 * Returns whether Google Cloud TTS credentials are configured.
 */
export function checkNarratorRequirements(): {
  ready: boolean;
  provider: "google-tts";
  configured: boolean;
} {
  const configured = !!(
    (process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING) ||
    process.env.GOOGLE_GENAI_API_KEY
  );
  return { ready: configured, provider: "google-tts", configured };
}

/** Returns the public voice style catalogue for the API response. */
export function getVoiceStyleCatalogue() {
  return VOICE_STYLES.map(style => ({
    style,
    description: VOICE_CONFIGS[style].description,
    voiceNameEnCa: voiceName("en-CA", VOICE_CONFIGS[style].speaker),
    voiceNameFrCa: voiceName("fr-CA", VOICE_CONFIGS[style].speaker),
  }));
}

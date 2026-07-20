/**
 * ElevenLabs Commercial Narrator
 *
 * Generates professional narration audio for 30-second commercials.
 *
 * Six voice styles:
 *   male       — clear, confident male voice
 *   female     — warm, articulate female voice
 *   corporate  — authoritative, professional (B2B)
 *   friendly   — approachable, warm (consumer)
 *   luxury     — smooth, refined (premium brands)
 *   energetic  — dynamic, high-energy (action-driven)
 *
 * Free ElevenLabs plan blocks all premade voices (HTTP 402). The service
 * catches that and automatically falls back to OpenAI TTS, which is always
 * available via Replit AI Integrations — no extra key required.
 */

import pino from "pino";
import { objectStorageClient, signObjectURL } from "./objectStorage.js";

const logger = pino({ name: "elevenLabsNarrator" });

const ELEVENLABS_API_URL = "https://api.elevenlabs.io";
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";
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
  elevenLabsId: string;
  openAiVoice: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";
  stability: number;         // 0-1: higher = more monotone/stable
  similarityBoost: number;   // 0-1: voice clarity
  styleExaggeration: number; // 0-1: expressiveness (v2 only)
  description: string;
}

const VOICE_CONFIGS: Record<VoiceStyle, VoiceConfig> = {
  male: {
    elevenLabsId: "pNInz6obpgDQGcFmaJgB", // Adam — clear, confident male
    openAiVoice: "onyx",
    stability: 0.55,
    similarityBoost: 0.80,
    styleExaggeration: 0.30,
    description: "Clear, confident male voice",
  },
  female: {
    elevenLabsId: "21m00Tcm4TlvDq8ikWAM", // Rachel — warm, articulate female
    openAiVoice: "nova",
    stability: 0.55,
    similarityBoost: 0.80,
    styleExaggeration: 0.30,
    description: "Warm, articulate female voice",
  },
  corporate: {
    elevenLabsId: "N2lVS1w4EtoT3dr4eOTd", // Callum — measured, authoritative
    openAiVoice: "onyx",
    stability: 0.78,
    similarityBoost: 0.85,
    styleExaggeration: 0.12,
    description: "Authoritative, professional tone for B2B brands",
  },
  friendly: {
    elevenLabsId: "IKne3meq5aSn9XLyUdCD", // Charlie — warm, approachable
    openAiVoice: "alloy",
    stability: 0.50,
    similarityBoost: 0.78,
    styleExaggeration: 0.50,
    description: "Warm, approachable tone for consumer brands",
  },
  luxury: {
    elevenLabsId: "onwK4e9ZLuTAKqWW03F9", // Daniel — smooth, refined
    openAiVoice: "shimmer",
    stability: 0.82,
    similarityBoost: 0.90,
    styleExaggeration: 0.18,
    description: "Smooth, refined tone for premium and luxury brands",
  },
  energetic: {
    elevenLabsId: "yoZ06aMxZJJ28mfd3POQ", // Sam — dynamic, expressive
    openAiVoice: "echo",
    stability: 0.35,
    similarityBoost: 0.75,
    styleExaggeration: 0.68,
    description: "Dynamic, high-energy tone for action-driven campaigns",
  },
};

// ── Public types ──────────────────────────────────────────────────────────────

export interface NarrationResult {
  narrationUrl: string;
  voiceStyle: VoiceStyle;
  voiceProvider: "elevenlabs" | "openai";
  openAiVoice?: string;
  scriptText: string;
  scriptChars: number;
}

// ── Main narration generator ──────────────────────────────────────────────────

/**
 * Generates professional narration audio for the given script text.
 *
 * Tries ElevenLabs first — falls back silently to OpenAI TTS if ElevenLabs
 * returns 402/403 (free plan restriction) or if the API key is not configured.
 */
export async function generateNarration(params: {
  script: string;
  voiceStyle: VoiceStyle;
  videoId: number;
}): Promise<NarrationResult> {
  const { script, voiceStyle, videoId } = params;
  const config = VOICE_CONFIGS[voiceStyle];

  const scriptText = prepareScript(script);
  if (!scriptText) throw new Error("Script text is empty — cannot generate narration");

  logger.info(
    { videoId, voiceStyle, voiceId: config.elevenLabsId, chars: scriptText.length },
    "[Narrator] Generating commercial narration",
  );

  // ── Attempt ElevenLabs ────────────────────────────────────────────────────
  const elKey = process.env.ELEVENLABS_API_KEY;
  if (elKey) {
    try {
      const audioBuffer = await callElevenLabs(scriptText, config, elKey);
      const narrationUrl = await uploadAudio(audioBuffer, "mp3", videoId, voiceStyle);
      logger.info({ videoId, voiceStyle }, "[Narrator] ElevenLabs narration generated ✓");
      return {
        narrationUrl,
        voiceStyle,
        voiceProvider: "elevenlabs",
        scriptText,
        scriptChars: scriptText.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ElevenLabsPlan|402|403/i.test(msg)) {
        logger.warn(
          { voiceStyle, msg },
          "[Narrator] ElevenLabs plan restriction — falling back to OpenAI TTS",
        );
      } else {
        logger.warn({ err, voiceStyle }, "[Narrator] ElevenLabs call failed — falling back to OpenAI TTS");
      }
    }
  } else {
    logger.info("[Narrator] ELEVENLABS_API_KEY not set — using OpenAI TTS directly");
  }

  // ── Fallback: OpenAI TTS (always available via Replit AI Integrations) ────
  return generateOpenAiNarration(scriptText, config, voiceStyle, videoId);
}

// ── ElevenLabs API call ───────────────────────────────────────────────────────

async function callElevenLabs(
  text: string,
  config: VoiceConfig,
  apiKey: string,
): Promise<Buffer> {
  const response = await withRetry(async () => {
    const res = await fetch(
      `${ELEVENLABS_API_URL}/v1/text-to-speech/${config.elevenLabsId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL,
          voice_settings: {
            stability: config.stability,
            similarity_boost: config.similarityBoost,
            style: config.styleExaggeration,
            use_speaker_boost: true,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (res.status === 402 || res.status === 403) {
      const body = await res.text();
      // Use a recognisable error class so callers can detect plan errors
      throw new Error(`ElevenLabsPlan restriction ${res.status}: ${body.slice(0, 200)}`);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ElevenLabs API ${res.status}: ${body.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  });

  return response;
}

// ── OpenAI TTS fallback ───────────────────────────────────────────────────────

async function generateOpenAiNarration(
  scriptText: string,
  config: VoiceConfig,
  voiceStyle: VoiceStyle,
  videoId: number,
): Promise<NarrationResult> {
  const openAiVoice = config.openAiVoice;
  logger.info({ videoId, voiceStyle, openAiVoice }, "[Narrator] Generating via OpenAI TTS");

  const { textToSpeech } = await import(
    "@workspace/integrations-openai-ai-server/audio"
  );
  const wavBuffer = await textToSpeech(scriptText, openAiVoice, "wav");
  const narrationUrl = await uploadAudio(wavBuffer, "wav", videoId, voiceStyle);

  logger.info({ videoId, voiceStyle, openAiVoice }, "[Narrator] OpenAI TTS narration generated ✓");

  return {
    narrationUrl,
    voiceStyle,
    voiceProvider: "openai",
    openAiVoice,
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
 * Narration is always available: ElevenLabs (preferred) or OpenAI TTS (fallback).
 * Returns whether ElevenLabs is configured so the client can show which provider
 * will be used.
 */
export function checkNarratorRequirements(): {
  ready: true;
  elevenLabsConfigured: boolean;
  provider: "elevenlabs" | "openai";
} {
  const elevenLabsConfigured = !!process.env.ELEVENLABS_API_KEY;
  return {
    ready: true,
    elevenLabsConfigured,
    provider: elevenLabsConfigured ? "elevenlabs" : "openai",
  };
}

/** Returns the public voice style catalogue for the API response. */
export function getVoiceStyleCatalogue() {
  return VOICE_STYLES.map(style => ({
    style,
    description: VOICE_CONFIGS[style].description,
    openAiVoice: VOICE_CONFIGS[style].openAiVoice,
    elevenLabsId: VOICE_CONFIGS[style].elevenLabsId,
  }));
}

// ── Utility ───────────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseMs = 1_500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Do NOT retry plan errors (402/403) — fail fast to reach fallback
      if (/ElevenLabsPlan|402|403/i.test(msg)) throw err;
      if (attempt === maxAttempts) throw err;
      await new Promise(r => setTimeout(r, baseMs * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

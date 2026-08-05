import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { Buffer } from "node:buffer";

/**
 * Google Cloud Text-to-Speech client.
 *
 * Cloud TTS (unlike the Gemini Developer API) is a full GCP service, so it's
 * authenticated with a service-account identity rather than a bare API key —
 * this is exactly why GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING exists as a
 * separate credential from GOOGLE_GENAI_API_KEY. We deliberately accept the
 * service-account key as a JSON *string* env var (not a mounted file path),
 * since Lightsail/VPS deployments pull all config from process.env.
 *
 * Falls back to a plain API key (GOOGLE_GENAI_API_KEY) if no service account
 * is configured — Cloud TTS's REST surface does accept API-key auth, so the
 * same single key used for Gemini can work here too in simpler deployments.
 */
// Treats unset, blank, and un-filled-in placeholder values (e.g. "REPLACE_ME",
// copied verbatim from .env.example) as "not configured" rather than crashing
// on JSON.parse — an env file with a placeholder still in it should fall back
// to the API key, not take down the process at startup.
function isConfigured(value: string | undefined): value is string {
  return !!value && value.trim() !== "" && !/^(replace_me|your[_-]?key|todo|changeme|xxx+)$/i.test(value.trim());
}

function buildClient(): TextToSpeechClient {
  const projectId = process.env["GOOGLE_CLOUD_PROJECT_ID"];
  const credentialsJson = process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING"];

  if (isConfigured(projectId) && isConfigured(credentialsJson)) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch {
      throw new Error(
        "GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING is not valid JSON. It must contain the full service-account key JSON as a single-line string.",
      );
    }
    return new TextToSpeechClient({ projectId, credentials });
  }

  const apiKey = process.env["GOOGLE_GENAI_API_KEY"];
  if (isConfigured(apiKey)) {
    return new TextToSpeechClient({ apiKey });
  }

  throw new Error(
    "No Google Cloud TTS credentials configured. Set GOOGLE_CLOUD_PROJECT_ID + " +
      "GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING (service account, recommended), " +
      "or GOOGLE_GENAI_API_KEY as a simpler fallback.",
  );
}

export const ttsClient = buildClient();

export type NarrationLocale = "en-CA" | "fr-CA";
export type AudioFormat = "mp3" | "wav";

const AUDIO_ENCODING: Record<AudioFormat, "MP3" | "LINEAR16"> = {
  mp3: "MP3",
  wav: "LINEAR16",
};

/**
 * Synthesizes speech with a Chirp 3: HD voice.
 * `voiceName` must be the full voice id, e.g. "en-CA-Chirp3-HD-Charon".
 */
export async function synthesizeSpeech(params: {
  text: string;
  voiceName: string;
  locale: NarrationLocale;
  format?: AudioFormat;
}): Promise<Buffer> {
  const { text, voiceName, locale, format = "mp3" } = params;

  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: locale, name: voiceName },
    audioConfig: { audioEncoding: AUDIO_ENCODING[format] },
  });

  const audioContent = response.audioContent;
  if (!audioContent) {
    throw new Error("Google Cloud TTS returned no audio content.");
  }
  return Buffer.from(audioContent as Uint8Array);
}

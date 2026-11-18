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
 * A Gemini Developer API key is not valid authentication for Cloud Text-to-Speech.
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

  throw new Error(
    "No Google Cloud TTS service-account credentials configured. Set GOOGLE_CLOUD_PROJECT_ID and " +
      "GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING to a valid service-account identity. GOOGLE_GENAI_API_KEY " +
      "cannot authenticate with Cloud Text-to-Speech.",
  );
}

let cachedClient: TextToSpeechClient | undefined;
function getClient(): TextToSpeechClient {
  cachedClient ??= buildClient();
  return cachedClient;
}

// Keep importing the TTS integration safe for unrelated render/provider code;
// credentials are validated only when an actual Cloud TTS operation is made.
export const ttsClient = new Proxy({} as TextToSpeechClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client) as unknown;
    return typeof value === "function" ? value.bind(client) : value;
  },
});

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
  speakingRate?: number;
}): Promise<Buffer> {
  const { text, voiceName, locale, format = "mp3", speakingRate } = params;

  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: locale, name: voiceName },
    audioConfig: { audioEncoding: AUDIO_ENCODING[format], ...(speakingRate === undefined ? {} : { speakingRate }) },
  });

  const audioContent = response.audioContent;
  if (!audioContent) {
    throw new Error("Google Cloud TTS returned no audio content.");
  }
  return Buffer.from(audioContent as Uint8Array);
}

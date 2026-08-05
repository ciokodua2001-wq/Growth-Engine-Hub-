import { GoogleGenAI } from "@google/genai";

/**
 * Google GenAI (Gemini + Imagen) client — supports two auth modes so the
 * same code works whether this process only has a simple Gemini Developer
 * API key, or a full GCP service account (needed by sibling services like
 * Cloud Text-to-Speech that don't support plain API keys):
 *
 *   1. GOOGLE_GENAI_API_KEY set               → Gemini Developer API (simplest, preferred)
 *   2. GOOGLE_CLOUD_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING → Vertex AI
 *      using a service-account JSON *string* (not a file path) — deliberately, since
 *      Lightsail/VPS deployments pull config from process.env, not mounted credential files.
 */
// Treats unset, blank, and un-filled-in placeholder values (e.g. "REPLACE_ME",
// copied verbatim from .env.example) as "not configured" rather than crashing
// on JSON.parse — an env file with a placeholder still in it should fall back
// or fail with a clear message, not take down the process with a parse error.
function isConfigured(value: string | undefined): value is string {
  return !!value && value.trim() !== "" && !/^(replace_me|your[_-]?key|todo|changeme|xxx+)$/i.test(value.trim());
}

function buildClient(): GoogleGenAI {
  const apiKey = process.env["GOOGLE_GENAI_API_KEY"];
  if (isConfigured(apiKey)) {
    return new GoogleGenAI({ apiKey });
  }

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
    return new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location: process.env["GOOGLE_CLOUD_LOCATION"] || "us-central1",
      googleAuthOptions: { credentials },
    });
  }

  throw new Error(
    "No Google GenAI credentials configured. Set GOOGLE_GENAI_API_KEY (Gemini Developer API), " +
      "or both GOOGLE_CLOUD_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING (Vertex AI).",
  );
}

export const genai = buildClient();

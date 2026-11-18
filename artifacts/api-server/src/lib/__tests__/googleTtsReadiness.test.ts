import { describe, expect, it } from "vitest";
import { hasGoogleCloudTtsCredentials } from "../googleTtsReadiness.js";

describe("Google Cloud TTS readiness", () => {
  it("rejects a Gemini API key without service-account credentials", () => {
    expect(hasGoogleCloudTtsCredentials({ GOOGLE_GENAI_API_KEY: "present" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("rejects missing project ID, invalid JSON, and non-service-account credentials", () => {
    const account = JSON.stringify({ type: "service_account", client_email: "tts@example.test", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" });
    expect(hasGoogleCloudTtsCredentials({ GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING: account } as NodeJS.ProcessEnv)).toBe(false);
    expect(hasGoogleCloudTtsCredentials({ GOOGLE_CLOUD_PROJECT_ID: "project", GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING: "{" } as NodeJS.ProcessEnv)).toBe(false);
    expect(hasGoogleCloudTtsCredentials({ GOOGLE_CLOUD_PROJECT_ID: "project", GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING: JSON.stringify({ type: "authorized_user" }) } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("accepts project ID plus a service-account identity", () => {
    const account = JSON.stringify({ type: "service_account", client_email: "tts@example.test", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" });
    expect(hasGoogleCloudTtsCredentials({ GOOGLE_CLOUD_PROJECT_ID: "project", GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING: account } as NodeJS.ProcessEnv)).toBe(true);
  });
});

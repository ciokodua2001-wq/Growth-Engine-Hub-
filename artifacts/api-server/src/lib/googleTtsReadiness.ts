/** True only when Cloud TTS has the OAuth service-account credentials it requires. */
export function hasGoogleCloudTtsCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  const projectId = env.GOOGLE_CLOUD_PROJECT_ID?.trim();
  const rawCredentials = env.GOOGLE_APPLICATION_CREDENTIALS_JSON_STRING?.trim();
  if (!projectId || !rawCredentials) return false;

  try {
    const credentials: unknown = JSON.parse(rawCredentials);
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) return false;
    const record = credentials as Record<string, unknown>;
    return record.type === "service_account" &&
      typeof record.client_email === "string" && record.client_email.length > 0 &&
      typeof record.private_key === "string" && record.private_key.includes("PRIVATE KEY");
  } catch {
    return false;
  }
}

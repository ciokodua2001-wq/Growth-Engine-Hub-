import type { VideoRenderProvider } from "@workspace/db";

const VALID_PROVIDERS: VideoRenderProvider[] = ["wan", "kling"];

/**
 * Reads ACTIVE_VIDEO_PROVIDER and returns the currently selected primary
 * video render provider.
 *
 * Defaults to "kling" (the long-proven path) whenever the env var is unset
 * or holds an unrecognized value — this keeps any environment that hasn't
 * explicitly opted into Wan (e.g. the Lightsail server, until its own .env
 * is updated) behaving exactly as it did before this migration.
 */
export function getActiveVideoProvider(): VideoRenderProvider {
  const raw = (process.env.ACTIVE_VIDEO_PROVIDER ?? "").trim().toLowerCase();
  return VALID_PROVIDERS.includes(raw as VideoRenderProvider)
    ? (raw as VideoRenderProvider)
    : "kling";
}

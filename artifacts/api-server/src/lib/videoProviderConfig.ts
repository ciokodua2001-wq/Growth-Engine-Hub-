import type { VideoRenderProvider } from "@workspace/db";

const VALID_PROVIDERS: VideoRenderProvider[] = ["wan", "veo", "kling"];

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

export type SupportedAspectRatio = "16:9" | "1:1" | "9:16";

export interface VideoProviderCapabilities {
  supportedAspectRatios: SupportedAspectRatio[];
}

/**
 * Aspect ratios the CURRENTLY ACTIVE provider can actually render, so the
 * client-side format picker never offers a choice that would silently get
 * reinterpreted server-side. Deliberately does NOT expose which provider is
 * active (or its name) — only the resulting capability — to keep vendor
 * choice a business secret (see ffmpegAssembler/veoRenderer comments).
 *
 * Veo 3.1 (all tiers, including Lite) only supports 16:9 and 9:16 — no
 * native 1:1/square mode (see veoRenderer.ts mapAspectRatioForVeo). Wan and
 * Kling both support square natively, so they get all 3.
 */
export function getVideoProviderCapabilities(): VideoProviderCapabilities {
  const provider = getActiveVideoProvider();
  if (provider === "veo") {
    return { supportedAspectRatios: ["16:9", "9:16"] };
  }
  return { supportedAspectRatios: ["16:9", "1:1", "9:16"] };
}

/**
 * Wan 2.2 (14B) ComfyUI workflow_json graph builders.
 *
 * Mirrors the OFFICIAL ComfyUI example graphs exactly (node types, link shape,
 * KSamplerAdvanced two-stage high/low-noise pattern) — verified against:
 *   https://github.com/comfyanonymous/ComfyUI_examples/tree/master/wan22
 *     - text_to_video_wan22_14B.json  (T2V — new scene cut)
 *     - image_to_video_wan22_14B.json (I2V — continuity from a source frame)
 *
 * Model weights (fp8_scaled 14B variants — ~24GB VRAM footprint with ComfyUI's
 * sequential high/low-noise expert swap, NOT the ~80GB naive-load figure on the
 * model card): see the provisioning script this pairs with —
 * infra/vast-ai/wan22-provisioning.sh.
 *
 * IMPORTANT: Wan2.2 I2V does NOT use a clip_vision node (unlike Wan 2.1) — the
 * `WanImageToVideo` node takes the start image directly. The Vast.ai PyWorker's
 * ComfyUI API wrapper auto-downloads any URL used as an image input field and
 * substitutes the local path before execution, so `sourceImageUrl` below can be
 * a plain HTTPS (e.g. Supabase signed) URL — no separate upload step needed.
 */

export interface WanWorkflowNode {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title: string };
}

export type WanWorkflow = Record<string, WanWorkflowNode>;

// ── Fixed generation parameters (shared by T2V + I2V) ─────────────────────────

/** ComfyUI/Vast placeholder — substituted with a fresh random int per generation. */
export const WAN_RANDOM_SEED_PLACEHOLDER = "__RANDOM_INT__";

export const WAN_FPS = 16;
/** 81 frames @ 16fps = 5.0625s — closest 4n+1 frame count to our 5s Kling-parity scene length. */
export const WAN_LENGTH_FRAMES = 81;
export const WAN_SCENE_DURATION_SEC = WAN_LENGTH_FRAMES / WAN_FPS;

export const WAN_STEPS = 20;
export const WAN_CFG = 3.5;
export const WAN_SAMPLER = "euler";
export const WAN_SCHEDULER = "simple";
/** Step boundary where sampling hands off from the high-noise expert to the low-noise expert. */
export const WAN_HIGH_LOW_SPLIT_STEP = 10;
/** ModelSamplingSD3 shift — matches the official Wan2.2 14B example graphs exactly. */
export const WAN_MODEL_SAMPLING_SHIFT = 8;

export const WAN_TEXT_ENCODER_FILE = "umt5_xxl_fp8_e4m3fn_scaled.safetensors";
export const WAN_VAE_FILE = "wan_2.1_vae.safetensors";
export const WAN_T2V_HIGH_NOISE_FILE = "wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors";
export const WAN_T2V_LOW_NOISE_FILE = "wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors";
export const WAN_I2V_HIGH_NOISE_FILE = "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors";
export const WAN_I2V_LOW_NOISE_FILE = "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors";

export const WAN_NEGATIVE_PROMPT =
  "blurry, low quality, distorted, ugly, pixelated, amateur, watermark, text overlay, logo, " +
  "subtitles, captions, on-screen text, static image, still frame, jpeg artifacts, " +
  "extra limbs, deformed hands, deformed face, worst quality, low resolution";

/** WEBM output — see wanFfmpeg.ts for the transcode-to-mp4 step (ComfyUI has no mp4 muxer node). */
export const WAN_SAVE_NODE_ID = "98";
const WAN_WEBM_CODEC = "vp9";
const WAN_WEBM_CRF = 20;

// ── Dimension helper ───────────────────────────────────────────────────────

/**
 * Computes T2V/I2V-safe width/height for a given aspect ratio string
 * (e.g. "16:9", "9:16", "1:1", "4:5", "4:3"). Wan's causal VAE requires
 * dimensions divisible by 32; targets a ~720p-class long edge, matching the
 * official example graphs (1280×704 for 16:9).
 */
export function computeWanDimensions(aspectRatio: string): { width: number; height: number } {
  const [rwRaw, rhRaw] = aspectRatio.split(":").map(Number);
  const rw = Number.isFinite(rwRaw) && rwRaw! > 0 ? rwRaw! : 16;
  const rh = Number.isFinite(rhRaw) && rhRaw! > 0 ? rhRaw! : 9;

  const roundTo32 = (n: number) => Math.max(320, Math.round(n / 32) * 32);

  if (rw >= rh) {
    const width = roundTo32(1280);
    const height = roundTo32((width * rh) / rw);
    return { width, height };
  }
  const height = roundTo32(1280);
  const width = roundTo32((height * rw) / rh);
  return { width, height };
}

// ── Shared graph fragment: text encoders + both diffusion model experts ──────

function buildSharedNodes(opts: {
  positivePrompt: string;
  negativePrompt: string;
  highNoiseFile: string;
  lowNoiseFile: string;
}): WanWorkflow {
  return {
    // CLIP / text encoder
    "10": {
      inputs: { clip_name: WAN_TEXT_ENCODER_FILE, type: "wan", device: "default" },
      class_type: "CLIPLoader",
      _meta: { title: "Load CLIP" },
    },
    "11": {
      inputs: { text: opts.positivePrompt, clip: ["10", 0] },
      class_type: "CLIPTextEncode",
      _meta: { title: "CLIP Text Encode (Positive Prompt)" },
    },
    "12": {
      inputs: { text: opts.negativePrompt, clip: ["10", 0] },
      class_type: "CLIPTextEncode",
      _meta: { title: "CLIP Text Encode (Negative Prompt)" },
    },
    // VAE
    "13": {
      inputs: { vae_name: WAN_VAE_FILE },
      class_type: "VAELoader",
      _meta: { title: "Load VAE" },
    },
    // High-noise expert (first half of sampling)
    "20": {
      inputs: { unet_name: opts.highNoiseFile, weight_dtype: "default" },
      class_type: "UNETLoader",
      _meta: { title: "Load Diffusion Model (High Noise)" },
    },
    "21": {
      inputs: { model: ["20", 0], shift: WAN_MODEL_SAMPLING_SHIFT },
      class_type: "ModelSamplingSD3",
      _meta: { title: "ModelSamplingSD3 (High Noise)" },
    },
    // Low-noise expert (second half of sampling)
    "22": {
      inputs: { unet_name: opts.lowNoiseFile, weight_dtype: "default" },
      class_type: "UNETLoader",
      _meta: { title: "Load Diffusion Model (Low Noise)" },
    },
    "23": {
      inputs: { model: ["22", 0], shift: WAN_MODEL_SAMPLING_SHIFT },
      class_type: "ModelSamplingSD3",
      _meta: { title: "ModelSamplingSD3 (Low Noise)" },
    },
  };
}

function buildSharedTailNodes(latentNodeRef: [string, number]): WanWorkflow {
  return {
    // Stage 1 — high-noise expert, steps 0 → WAN_HIGH_LOW_SPLIT_STEP
    "30": {
      inputs: {
        add_noise: "enable",
        noise_seed: WAN_RANDOM_SEED_PLACEHOLDER,
        steps: WAN_STEPS,
        cfg: WAN_CFG,
        sampler_name: WAN_SAMPLER,
        scheduler: WAN_SCHEDULER,
        start_at_step: 0,
        end_at_step: WAN_HIGH_LOW_SPLIT_STEP,
        return_with_leftover_noise: "enable",
        model: ["21", 0],
        positive: ["11", 0],
        negative: ["12", 0],
        latent_image: latentNodeRef,
      },
      class_type: "KSamplerAdvanced",
      _meta: { title: "KSamplerAdvanced (High Noise Stage)" },
    },
    // Stage 2 — low-noise expert, steps WAN_HIGH_LOW_SPLIT_STEP → end
    "31": {
      inputs: {
        add_noise: "disable",
        noise_seed: 0,
        steps: WAN_STEPS,
        cfg: WAN_CFG,
        sampler_name: WAN_SAMPLER,
        scheduler: WAN_SCHEDULER,
        start_at_step: WAN_HIGH_LOW_SPLIT_STEP,
        end_at_step: 10000,
        return_with_leftover_noise: "disable",
        model: ["23", 0],
        positive: ["11", 0],
        negative: ["12", 0],
        latent_image: ["30", 0],
      },
      class_type: "KSamplerAdvanced",
      _meta: { title: "KSamplerAdvanced (Low Noise Stage)" },
    },
    "40": {
      inputs: { samples: ["31", 0], vae: ["13", 0] },
      class_type: "VAEDecode",
      _meta: { title: "VAE Decode" },
    },
    [WAN_SAVE_NODE_ID]: {
      inputs: {
        images: ["40", 0],
        filename_prefix: "video/growthforge-wan",
        codec: WAN_WEBM_CODEC,
        fps: WAN_FPS,
        crf: WAN_WEBM_CRF,
      },
      class_type: "SaveWEBM",
      _meta: { title: "Save WEBM" },
    },
  };
}

// ── T2V — new scene cut ───────────────────────────────────────────────────────

export function buildWanT2VWorkflow(opts: {
  positivePrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
}): WanWorkflow {
  const shared = buildSharedNodes({
    positivePrompt: opts.positivePrompt,
    negativePrompt: opts.negativePrompt ?? WAN_NEGATIVE_PROMPT,
    highNoiseFile: WAN_T2V_HIGH_NOISE_FILE,
    lowNoiseFile: WAN_T2V_LOW_NOISE_FILE,
  });

  const emptyLatent: WanWorkflow = {
    "14": {
      inputs: { width: opts.width, height: opts.height, length: WAN_LENGTH_FRAMES, batch_size: 1 },
      class_type: "EmptyHunyuanLatentVideo",
      _meta: { title: "Empty Latent Video (T2V)" },
    },
  };

  return { ...shared, ...emptyLatent, ...buildSharedTailNodes(["14", 0]) };
}

// ── I2V — continuity from the previous scene's last frame ────────────────────

export function buildWanI2VWorkflow(opts: {
  positivePrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  /** HTTPS URL (e.g. Supabase signed URL) — auto-downloaded by the Vast.ai API wrapper. */
  sourceImageUrl: string;
}): WanWorkflow {
  const shared = buildSharedNodes({
    positivePrompt: opts.positivePrompt,
    negativePrompt: opts.negativePrompt ?? WAN_NEGATIVE_PROMPT,
    highNoiseFile: WAN_I2V_HIGH_NOISE_FILE,
    lowNoiseFile: WAN_I2V_LOW_NOISE_FILE,
  });

  const imageAndLatent: WanWorkflow = {
    "15": {
      inputs: { image: opts.sourceImageUrl },
      class_type: "LoadImage",
      _meta: { title: "Load Image (Source Frame)" },
    },
    // WanImageToVideo re-derives positive/negative conditioning + the starting
    // latent from the source image — its outputs (not nodes 11/12/14 directly)
    // feed the KSamplerAdvanced stages for I2V.
    "16": {
      inputs: {
        positive: ["11", 0],
        negative: ["12", 0],
        vae: ["13", 0],
        start_image: ["15", 0],
        width: opts.width,
        height: opts.height,
        length: WAN_LENGTH_FRAMES,
        batch_size: 1,
      },
      class_type: "WanImageToVideo",
      _meta: { title: "Wan Image to Video" },
    },
  };

  const tail = buildSharedTailNodes(["16", 2]);
  // I2V conditioning comes from WanImageToVideo's outputs, not the raw CLIPTextEncode nodes.
  (tail["30"]!.inputs as Record<string, unknown>).positive = ["16", 0];
  (tail["30"]!.inputs as Record<string, unknown>).negative = ["16", 1];
  (tail["31"]!.inputs as Record<string, unknown>).positive = ["16", 0];
  (tail["31"]!.inputs as Record<string, unknown>).negative = ["16", 1];

  return { ...shared, ...imageAndLatent, ...tail };
}

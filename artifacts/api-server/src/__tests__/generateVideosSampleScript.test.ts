import { describe, expect, it } from "vitest";
import { GenerateVideosBody } from "@workspace/api-zod";

describe("GenerateVideosBody sample script reference", () => {
  it("accepts an optional sample script up to 12,000 characters", () => {
    const result = GenerateVideosBody.safeParse({
      mode: "brief",
      sampleScript: "Opening image: a city at dawn.",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a sample script longer than 12,000 characters", () => {
    const result = GenerateVideosBody.safeParse({
      mode: "brief",
      sampleScript: "x".repeat(12001),
    });

    expect(result.success).toBe(false);
  });

  it("keeps sample scripts optional", () => {
    const result = GenerateVideosBody.safeParse({ mode: "brief" });
    expect(result.success).toBe(true);
  });
});

describe("GenerateVideosBody logo asset id", () => {
  it("accepts an optional positive logo asset id", () => {
    const ok = GenerateVideosBody.safeParse({ mode: "prompt", logoAssetId: 42 });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.logoAssetId).toBe(42);
    expect(GenerateVideosBody.safeParse({ mode: "prompt", logoAssetId: 0 }).success).toBe(false);
    expect(GenerateVideosBody.safeParse({ mode: "prompt" }).success).toBe(true);
  });
});

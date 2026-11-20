import { describe, expect, it } from "vitest";
import { buildLogoOverlayFilter } from "../ffmpegAssembler.js";

describe("buildLogoOverlayFilter (badge can never be stretched or pushed off-frame)", () => {
  it("sizes the badge from absolute frame pixels, not scale2ref ratios", () => {
    const f = buildLogoOverlayFilter({ frameWidth: 1080, frameHeight: 1920, x: 0.8646, y: 0.0692, scale: 0.2 });
    // 20% of a 1080px-wide frame = 216px. The old scale2ref graph turned this
    // into 400x712, which stretched the crest and clipped its crown off-frame.
    expect(f).toContain("scale=216:-2");
    expect(f).not.toContain("scale2ref");
  });

  it("derives height from the PNG aspect so the crest stays round", () => {
    const f = buildLogoOverlayFilter({ frameWidth: 1080, frameHeight: 1920, x: 0.5, y: 0.5, scale: 0.2 });
    // -2 is the aspect-derived even height; a fixed second number would distort.
    expect(f).toMatch(/scale=\d+:-2/);
  });

  it("keeps the logo width even for yuv420p", () => {
    for (const scale of [0.03, 0.11, 0.17, 0.25, 0.5]) {
      const f = buildLogoOverlayFilter({ frameWidth: 1080, frameHeight: 1920, x: 0.5, y: 0.5, scale });
      const w = Number(f.match(/scale=(\d+):-2/)![1]!);
      expect(w % 2).toBe(0);
      expect(w).toBeGreaterThanOrEqual(2);
    }
  });

  it("computes the expected width for landscape, square and portrait frames", () => {
    const cases: Array<[number, number, number, number]> = [
      [1920, 1080, 0.2, 384], // 16:9
      [1080, 1080, 0.2, 216], // 1:1
      [1080, 1920, 0.15, 162], // 9:16
    ];
    for (const [w, h, scale, expected] of cases) {
      const f = buildLogoOverlayFilter({ frameWidth: w, frameHeight: h, x: 0.5, y: 0.5, scale });
      expect(Number(f.match(/scale=(\d+):-2/)![1]!)).toBe(expected);
    }
  });

  it("anchors position centre-based on the caller's 0..1 values", () => {
    const f = buildLogoOverlayFilter({ frameWidth: 1080, frameHeight: 1920, x: 0.8646, y: 0.0692, scale: 0.2 });
    expect(f).toContain("overlay=x=W*0.8646-w/2:y=H*0.0692-h/2");
  });

  it("clamps out-of-range anchors and scale instead of emitting broken expressions", () => {
    const f = buildLogoOverlayFilter({ frameWidth: 1080, frameHeight: 1920, x: 4, y: -3, scale: 9 });
    expect(f).toContain("scale=1080:-2"); // scale clamped to 1.0
    expect(f).toContain("x=W*1-w/2");
    expect(f).toContain("y=H*0-h/2");
  });

  it("falls back to safe defaults for non-finite input", () => {
    const f = buildLogoOverlayFilter({ frameWidth: NaN, frameHeight: NaN, x: NaN, y: NaN, scale: NaN });
    expect(f).toContain("scale=216:-2"); // 1080 * 0.2 default
    expect(f).toContain("x=W*0.82-w/2");
    expect(f).toContain("y=H*0.82-h/2");
  });

  it("preserves transparency and pixel aspect on both inputs", () => {
    const f = buildLogoOverlayFilter({ frameWidth: 1080, frameHeight: 1920, x: 0.5, y: 0.5, scale: 0.2 });
    expect(f).toContain("format=rgba");
    expect(f.match(/setsar=1/g)?.length).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { isLogoBurnedUrl } from "../logoSource.js";

describe("isLogoBurnedUrl (never stack a crest on an existing badge)", () => {
  it("detects the Grok blueprint logo composite key", () => {
    expect(isLogoBurnedUrl("grok-object://growthforge-media/commercial/grok/72/logo/1795188999.mp4")).toBe(true);
  });

  it("detects the post-render assembly logo key", () => {
    expect(isLogoBurnedUrl("https://s3.ca-central-1.wasabisys.com/growthforge-media/renders/assembled/video-72-logo-1795192364934.mp4?X-Amz-Signature=abc")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isLogoBurnedUrl("https://cdn/RENDERS/Video-72-LOGO-123.MP4")).toBe(true);
  });

  it("accepts a pristine render", () => {
    expect(isLogoBurnedUrl("grok-object://growthforge-media/commercial/grok/72/refined/1795188691081.mp4")).toBe(false);
    expect(isLogoBurnedUrl("https://cdn/growthforge-media/commercial/grok/72/1795188691081-req.mp4")).toBe(false);
  });

  it("accepts a caption-only assembly (chaining a logo must stay allowed)", () => {
    expect(isLogoBurnedUrl("https://cdn/growthforge-media/renders/assembled/video-72-captions-1795192000.mp4")).toBe(false);
  });

  it("treats empty input as not burned", () => {
    expect(isLogoBurnedUrl(null)).toBe(false);
    expect(isLogoBurnedUrl(undefined)).toBe(false);
    expect(isLogoBurnedUrl("")).toBe(false);
  });
});

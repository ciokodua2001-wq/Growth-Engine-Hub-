import { describe, it, expect } from "vitest";
import { GraphApiError, MetaApiShapeError, parseMetaApiResponse } from "../metaApiSchemas.js";

describe("parseMetaApiResponse — success", () => {
  it("returns the id string when body matches { id: string }", () => {
    expect(parseMetaApiResponse("Facebook feed POST", { id: "123456789_987654321" })).toBe(
      "123456789_987654321",
    );
  });

  it("returns the id and ignores extra fields present alongside it", () => {
    expect(
      parseMetaApiResponse("Instagram media_publish", { id: "abc_123", extra: true, nested: { x: 1 } }),
    ).toBe("abc_123");
  });
});

describe("parseMetaApiResponse — GraphApiError (definitive Meta rejection)", () => {
  it("throws GraphApiError when body matches { error: { message } }", () => {
    const body = { error: { message: "Invalid OAuth access token." } };
    expect(() => parseMetaApiResponse("Facebook feed POST", body)).toThrowError(GraphApiError);
  });

  it("throws GraphApiError with the exact message from the Meta error body", () => {
    const body = { error: { message: "The user has not authorized application." } };
    expect(() => parseMetaApiResponse("Facebook feed POST", body)).toThrow(
      "The user has not authorized application.",
    );
  });

  it("throws GraphApiError when error body also has extra fields (type, code, fbtrace_id)", () => {
    const body = {
      error: {
        message: "Content policy violation.",
        type: "OAuthException",
        code: 200,
        fbtrace_id: "abc123",
      },
    };
    expect(() => parseMetaApiResponse("Instagram container creation", body)).toThrowError(GraphApiError);
    expect(() => parseMetaApiResponse("Instagram container creation", body)).toThrow(
      "Content policy violation.",
    );
  });

  it("throws GraphApiError (not MetaApiShapeError) when error.message is present", () => {
    const body = { error: { message: "Session has expired." } };
    try {
      parseMetaApiResponse("Instagram media_publish", body);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GraphApiError);
      expect(err).not.toBeInstanceOf(MetaApiShapeError);
    }
  });
});

describe("parseMetaApiResponse — MetaApiShapeError (unexpected shape)", () => {
  it("throws MetaApiShapeError when body is an empty object", () => {
    expect(() => parseMetaApiResponse("Facebook feed POST", {})).toThrowError(MetaApiShapeError);
  });

  it("throws MetaApiShapeError when id is not a string (e.g. number)", () => {
    expect(() => parseMetaApiResponse("Facebook feed POST", { id: 12345 })).toThrowError(MetaApiShapeError);
  });

  it("throws MetaApiShapeError when id is null", () => {
    expect(() => parseMetaApiResponse("Facebook feed POST", { id: null })).toThrowError(MetaApiShapeError);
  });

  it("throws MetaApiShapeError when the response is wrapped in a data envelope", () => {
    expect(() =>
      parseMetaApiResponse("Instagram container creation", { data: { id: "abc_123" } }),
    ).toThrowError(MetaApiShapeError);
  });

  it("throws MetaApiShapeError when error body lacks the message field", () => {
    expect(() =>
      parseMetaApiResponse("Instagram media_publish", { error: { code: 200 } }),
    ).toThrowError(MetaApiShapeError);
  });

  it("throws MetaApiShapeError when the body is a string (not an object)", () => {
    expect(() => parseMetaApiResponse("Facebook feed POST", "ok")).toThrowError(MetaApiShapeError);
  });

  it("throws MetaApiShapeError when the body is null", () => {
    expect(() => parseMetaApiResponse("Facebook feed POST", null)).toThrowError(MetaApiShapeError);
  });

  it("throws MetaApiShapeError when the body is an array", () => {
    expect(() => parseMetaApiResponse("Facebook feed POST", [{ id: "abc" }])).toThrowError(
      MetaApiShapeError,
    );
  });

  it("MetaApiShapeError message includes the context label", () => {
    try {
      parseMetaApiResponse("Instagram container creation", { unexpected: true });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaApiShapeError);
      expect((err as MetaApiShapeError).message).toContain("Instagram container creation");
    }
  });

  it("MetaApiShapeError message includes a preview of the unexpected body", () => {
    const body = { weirdKey: "some value" };
    try {
      parseMetaApiResponse("Facebook feed POST", body);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaApiShapeError);
      expect((err as MetaApiShapeError).message).toContain("weirdKey");
    }
  });

  it("MetaApiShapeError is not an instance of GraphApiError", () => {
    try {
      parseMetaApiResponse("Facebook feed POST", {});
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaApiShapeError);
      expect(err).not.toBeInstanceOf(GraphApiError);
    }
  });
});

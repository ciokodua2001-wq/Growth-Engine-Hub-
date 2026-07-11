import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptToken, decryptToken, isEncryptedFormat } from "../tokenCrypto.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SESSION_SECRET = "test-session-secret-value";

function saveEnv() {
  const saved = {
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };
  return () => {
    if (saved.TOKEN_ENCRYPTION_KEY === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = saved.TOKEN_ENCRYPTION_KEY;
    if (saved.SESSION_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved.SESSION_SECRET;
  };
}

describe("isEncryptedFormat", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = saveEnv();
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => restore());

  it("returns true for a real output of encryptToken", () => {
    const encrypted = encryptToken("some-facebook-page-token");
    expect(isEncryptedFormat(encrypted)).toBe(true);
  });

  it("returns false for a typical Facebook access token (plaintext)", () => {
    expect(isEncryptedFormat("EAABsbCS4iXoBO_some_long_token_value")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isEncryptedFormat("")).toBe(false);
  });

  it("returns false for a string with only two colon-separated parts", () => {
    expect(isEncryptedFormat("aabbcc:ddeeff")).toBe(false);
  });

  it("returns false when any part contains non-hex characters", () => {
    expect(isEncryptedFormat("zzzzzz:aaaaaa:bbbbbb")).toBe(false);
  });

  it("returns false when any part is an empty segment", () => {
    expect(isEncryptedFormat(":aaaaaa:bbbbbb")).toBe(false);
    expect(isEncryptedFormat("aaaaaa::bbbbbb")).toBe(false);
    expect(isEncryptedFormat("aaaaaa:bbbbbb:")).toBe(false);
  });
});

describe("encryptToken / decryptToken — TOKEN_ENCRYPTION_KEY", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = saveEnv();
    process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => restore());

  it("round-trips a typical Facebook page access token", () => {
    const plaintext = "EAABsbCS4iXoBO_some_long_token_value";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("round-trips an empty string", () => {
    const encrypted = encryptToken("");
    expect(decryptToken(encrypted)).toBe("");
  });

  it("round-trips a token containing colons", () => {
    const plaintext = "token:with:colons:inside";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertext on each call (random IV)", () => {
    const plaintext = "same-token-value";
    const enc1 = encryptToken(plaintext);
    const enc2 = encryptToken(plaintext);
    expect(enc1).not.toBe(enc2);
    expect(decryptToken(enc1)).toBe(plaintext);
    expect(decryptToken(enc2)).toBe(plaintext);
  });

  it("decryptToken throws on a tampered ciphertext", () => {
    const encrypted = encryptToken("token-to-tamper");
    const parts = encrypted.split(":");
    const lastChar = parts[2].slice(-1);
    parts[2] = parts[2].slice(0, -1) + (lastChar === "0" ? "1" : "0");
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });

  it("decryptToken throws on a tampered auth tag", () => {
    const encrypted = encryptToken("tamper-the-tag");
    const parts = encrypted.split(":");
    const lastChar = parts[1].slice(-1);
    parts[1] = parts[1].slice(0, -1) + (lastChar === "0" ? "1" : "0");
    expect(() => decryptToken(parts.join(":"))).toThrow();
  });

  it("decryptToken throws when the input has fewer than 3 colon-separated parts", () => {
    expect(() => decryptToken("only:two")).toThrow("Invalid encrypted token format");
  });

  it("decryptToken throws when the input has more than 3 colon-separated parts", () => {
    expect(() => decryptToken("a:b:c:d")).toThrow("Invalid encrypted token format");
  });

  it("encryptToken throws if TOKEN_ENCRYPTION_KEY is not a valid 64-char hex string", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "tooshort";
    expect(() => encryptToken("anything")).toThrow("TOKEN_ENCRYPTION_KEY");
  });
});

describe("encryptToken / decryptToken — SESSION_SECRET fallback", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = saveEnv();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    process.env.SESSION_SECRET = SESSION_SECRET;
  });

  afterEach(() => restore());

  it("round-trips a token using the SESSION_SECRET-derived key", () => {
    const plaintext = "fb_token_via_session_secret";
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });
});

describe("encryptToken / decryptToken — no key set", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = saveEnv();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => restore());

  it("encryptToken throws when neither key is set", () => {
    expect(() => encryptToken("anything")).toThrow();
  });

  it("decryptToken throws when neither key is set", () => {
    expect(() => decryptToken("aabbcc:ddeeff:001122")).toThrow();
  });
});

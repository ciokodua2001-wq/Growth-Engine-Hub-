import crypto from "node:crypto";

/**
 * Returns the AES-256 key buffer.
 *
 * Priority:
 *   1. TOKEN_ENCRYPTION_KEY — a 64-hex-char (32-byte) secret dedicated to
 *      token encryption.  This is the preferred key and should always be set
 *      in production.
 *   2. SESSION_SECRET (legacy fallback) — derived via SHA-256.  Kept so that
 *      existing deployments don't lose access to already-encrypted tokens.
 *      Rotate by encrypting all tokens with the new key and removing the fallback.
 *
 * Changing the active key without migrating stored tokens will make them
 * unreadable — always use `isEncryptedFormat` + a migration step first.
 */
function getKey(): Buffer {
  const dedicated = process.env.TOKEN_ENCRYPTION_KEY;
  if (dedicated) {
    if (dedicated.length !== 64 || !/^[0-9a-f]+$/i.test(dedicated)) {
      throw new Error(
        "TOKEN_ENCRYPTION_KEY must be a 64-character lowercase hex string (32 bytes)"
      );
    }
    return Buffer.from(dedicated, "hex");
  }

  const session = process.env.SESSION_SECRET;
  if (session) {
    return crypto.createHash("sha256").update(session).digest();
  }

  throw new Error(
    "Neither TOKEN_ENCRYPTION_KEY nor SESSION_SECRET is set — cannot encrypt/decrypt tokens"
  );
}

/**
 * Returns true if `token` matches the `iv:authTag:ciphertext` hex format
 * produced by `encryptToken`.  Use this to detect legacy plaintext rows
 * before attempting decryption.
 */
export function isEncryptedFormat(token: string): boolean {
  const parts = token.split(":");
  return (
    parts.length === 3 &&
    parts.every((p) => p.length > 0 && /^[0-9a-f]+$/i.test(p))
  );
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns a colon-separated string: `iv:authTag:ciphertext` (all hex-encoded).
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypts a token produced by `encryptToken`.
 * Throws if the token is malformed or authentication fails (tampering detected).
 * Call `isEncryptedFormat` first to check for legacy plaintext rows.
 */
export function decryptToken(encrypted: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token format");
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/**
 * Checks whether TOKEN_ENCRYPTION_KEY is set and valid.
 *
 * Returns `{ ok: true }` only when the dedicated key is present and well-formed.
 * Returns `{ ok: false, reason }` when it is absent or malformed — even if a
 * SESSION_SECRET fallback could encrypt tokens, because the fallback is unsafe
 * after a SESSION_SECRET rotation (stored tokens become permanently unreadable).
 *
 * Use this for startup checks and /healthz so ops know when the preferred key
 * is missing before any user's publish call fails with a confusing 500 error.
 */
export function checkEncryptionKey(): { ok: boolean; reason?: string } {
  const dedicated = process.env.TOKEN_ENCRYPTION_KEY;
  if (!dedicated) {
    return {
      ok: false,
      reason:
        "TOKEN_ENCRYPTION_KEY is not set — Meta page tokens cannot be safely decrypted after a key rotation. Set TOKEN_ENCRYPTION_KEY in your environment.",
    };
  }
  if (dedicated.length !== 64 || !/^[0-9a-f]+$/i.test(dedicated)) {
    return {
      ok: false,
      reason:
        "TOKEN_ENCRYPTION_KEY is set but invalid — it must be a 64-character lowercase hex string (32 bytes).",
    };
  }
  return { ok: true };
}

/**
 * Signs a string payload with HMAC-SHA256 using the SESSION_SECRET.
 * Returns `payload.signature` (hex). Used to create tamper-evident OAuth state.
 */
export function signState(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/**
 * Verifies and strips the HMAC signature from a signed state string.
 * Returns the original payload if valid; throws otherwise.
 */
export function verifyState(signed: string): string {
  const lastDot = signed.lastIndexOf(".");
  if (lastDot === -1) throw new Error("Missing state signature");
  const payload = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) {
    throw new Error("State signature invalid");
  }
  return payload;
}

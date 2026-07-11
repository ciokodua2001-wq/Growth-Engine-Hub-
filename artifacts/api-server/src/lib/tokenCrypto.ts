import crypto from "node:crypto";

/**
 * Derives a 32-byte AES key from the SESSION_SECRET using SHA-256.
 * The same secret that protects sessions is used to protect stored tokens —
 * changing SESSION_SECRET will make any previously-encrypted tokens unreadable.
 */
function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set — cannot encrypt/decrypt tokens");
  return crypto.createHash("sha256").update(secret).digest();
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

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM encryption for at-rest broker credentials.
// Key source: env MT5_ENCRYPTION_KEY (32 raw bytes encoded as base64 or hex).

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.MT5_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MT5_ENCRYPTION_KEY is not set. Generate one with: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  // Accept base64 or hex; fall back to raw utf8 when length matches.
  let key: Buffer | null = null;
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) key = b64;
  } catch {
    /* ignore */
  }
  if (!key) {
    try {
      const hex = Buffer.from(raw, "hex");
      if (hex.length === 32) key = hex;
    } catch {
      /* ignore */
    }
  }
  if (!key) {
    const utf = Buffer.from(raw, "utf8");
    if (utf.length === 32) key = utf;
  }
  if (!key) {
    throw new Error(
      "MT5_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 / hex / raw)."
    );
  }
  cachedKey = key;
  return key;
}

/** Encrypt a UTF-8 plaintext. Output format: base64(iv || tag || ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Inverse of encryptSecret. Throws if the ciphertext was tampered with. */
export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** True when the encryption key is configured — used by API routes to fail fast. */
export function isCryptoConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

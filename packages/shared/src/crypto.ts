import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM for short-lived secrets at rest (user GitHub tokens during a delivery). */
export function encrypt(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, "base64");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decrypt(payload: string, keyB64: string): string {
  const buf = Buffer.from(payload, "base64");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

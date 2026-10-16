import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Social tokens at rest (component social.connections.turbineh): AES-256-GCM with a 32-byte key from the environment
 * (SOCIAL_TOKEN_KEY, base64 or hex; SOCIAL_TOKEN_KEY_PREVIOUS is still accepted for decryption while you rotate).
 * Every ciphertext is bound to its row through additional authenticated data (workspace, network, account, kind), so a
 * token copied into another row or workspace does not decrypt. Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * Plain tokens exist only in memory, for the one provider call that needs them.
 */
export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenKeyError";
  }
}

/** Parses a 32-byte key written as base64 (44 chars) or hex (64 chars); null when absent or malformed. */
export function parseKey(raw: string | undefined): Buffer | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

/** The current key, or a TokenKeyError that says how to set it. */
export function tokenKey(env: Record<string, string | undefined> = process.env): Buffer {
  const key = parseKey(env.SOCIAL_TOKEN_KEY);
  if (!key)
    throw new TokenKeyError(
      "SOCIAL_TOKEN_KEY is not set to a 32-byte key (base64 or hex): social accounts cannot be connected.",
    );
  return key;
}

export const tokenKeyConfigured = (env: Record<string, string | undefined> = process.env) =>
  parseKey(env.SOCIAL_TOKEN_KEY) !== null;

/** What a ciphertext belongs to: decrypting it with any other binding fails. */
export interface TokenBinding {
  organizationId: string;
  network: string;
  accountId: string;
  kind: "access" | "refresh" | "grant" | "verifier";
}

const aad = (b: TokenBinding) =>
  Buffer.from(`social-token:v1:${b.organizationId}:${b.network}:${b.accountId}:${b.kind}`);

export function encryptToken(plain: string, binding: TokenBinding, key = tokenKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(binding));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptToken(
  sealed: string,
  binding: TokenBinding,
  keys: Buffer[] = [
    tokenKey(),
    ...[parseKey(process.env.SOCIAL_TOKEN_KEY_PREVIOUS)].filter((k): k is Buffer => k !== null),
  ],
): string {
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || ct === undefined)
    throw new TokenKeyError("Unknown token format");
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(aad(binding));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(ct, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Wrong key or wrong binding: try the previous key, then fail.
    }
  }
  throw new TokenKeyError(
    "A stored social token could not be decrypted (key changed or record tampered with).",
  );
}

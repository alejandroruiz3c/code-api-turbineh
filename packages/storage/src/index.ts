import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Build artefacts (channel A, PLAN §7.1): the source of truth for every delivered app. */
export interface ArtifactStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Short-lived download URL (S3) or an app route path (local). */
  url(key: string, ttlSeconds?: number): Promise<string>;
}

/** Keys are relative paths of safe segments; traversal and absolute paths are rejected, never "cleaned". */
const safeKey = (key: string) => {
  const segments = key.split(/[\\/]/);
  if (key.startsWith("/") || segments.some((s) => s === ".." || s === "" || s === ".")) {
    throw new Error("invalid artifact key");
  }
  return segments.join("/");
};

export class LocalStorage implements ArtifactStorage {
  constructor(private readonly root: string) {}
  async put(key: string, body: Buffer, _contentType?: string): Promise<void> {
    const p = join(this.root, safeKey(key));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  async get(key: string): Promise<Buffer> {
    return readFileSync(join(this.root, safeKey(key)));
  }
  async url(key: string): Promise<string> {
    return `/api/artifacts/${safeKey(key)}`;
  }
}

export class S3Storage implements ArtifactStorage {
  private readonly s3: S3Client;
  constructor(
    private readonly bucket: string,
    cfg: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.s3 = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: false,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: body,
        ContentType: contentType,
      }),
    );
  }
  async get(key: string): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
    return Buffer.from(
      await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
    );
  }
  async url(key: string, ttlSeconds = 900): Promise<string> {
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }), {
      expiresIn: ttlSeconds,
    });
  }
}

export function storageFromEnv(env: NodeJS.ProcessEnv, localRoot: string): ArtifactStorage {
  if (env.STORAGE_DRIVER === "s3") {
    const need = [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ];
    const missing = need.filter((k) => !env[k]);
    if (missing.length) throw new Error(`S3 storage not configured: ${missing.join(", ")}`);
    return new S3Storage(env.S3_BUCKET as string, {
      endpoint: env.S3_ENDPOINT as string,
      region: env.S3_REGION as string,
      accessKeyId: env.S3_ACCESS_KEY_ID as string,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
    });
  }
  return new LocalStorage(localRoot);
}

import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for S3-compatible storage (component storage.private-uploads.turbineh): AWS S3, Cloudflare
 * R2, MinIO, Backblaze B2, Wasabi… No SDK: a few pure functions, unit-tested, and checked end to end against the
 * offline mock (tests/e2e/mocks/S3_BASE_URL.mjs re-verifies every signature with its own implementation).
 */
export interface SigningKey {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as S3 expects it (each path segment; "/" kept between segments). */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((s) =>
      encodeURIComponent(s).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/** "20261013T101500Z" and "20261013". */
export function amzDates(now: Date): { amzDate: string; day: string } {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}

/** Canonical request of SigV4 (method, path, query, signed headers, payload hash). */
export function canonicalRequest(input: {
  method: string;
  path: string;
  query?: URLSearchParams;
  headers: Record<string, string>;
  payloadHash: string;
}): { text: string; signedHeaders: string } {
  const names = Object.keys(input.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]),
  );
  const query = [...(input.query ?? new URLSearchParams()).entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const signedHeaders = names.join(";");
  const text = [
    input.method.toUpperCase(),
    encodePath(input.path),
    query,
    names.map((n) => `${n}:${lower[n]}\n`).join(""),
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  return { text, signedHeaders };
}

/** Headers to send with a signed request: host, x-amz-date, x-amz-content-sha256 and Authorization. */
export function signRequest(input: {
  method: string;
  url: URL;
  body?: Uint8Array;
  headers?: Record<string, string>;
  key: SigningKey;
  now?: Date;
}): Record<string, string> {
  const service = input.key.service ?? "s3";
  const { amzDate, day } = amzDates(input.now ?? new Date());
  const payloadHash = sha256Hex(input.body ?? new Uint8Array());
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: input.url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const { text, signedHeaders } = canonicalRequest({
    method: input.method,
    path: decodeURIComponent(input.url.pathname),
    query: input.url.searchParams,
    headers,
    payloadHash,
  });
  const scope = `${day}/${input.key.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(text)].join("\n");
  const kDate = hmac(`AWS4${input.key.secretAccessKey}`, day);
  const kSigning = hmac(hmac(hmac(kDate, input.key.region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.key.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

import { createHash, randomBytes } from "node:crypto";
import type { Container } from "./mime";

/**
 * Server-side helpers of the recordings (component media.screen-recording.turbineh): the container recognised by
 * content (never by name or the browser's type), HTTP Range parsing for seeking, and share tokens (only their hash is
 * stored). Pure functions, unit-tested in tests/unit/recordings.test.ts.
 */

/** "webm" (EBML header 1A 45 DF A3), "mp4" (an ISO BMFF "ftyp" box first), or null — refuse anything else. */
export function videoContainer(bytes: Uint8Array): Container | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "webm";
  if (bytes.length >= 8 && new TextDecoder("latin1").decode(bytes.subarray(4, 8)) === "ftyp")
    return "mp4";
  return null;
}

export const MIME_OF: Record<Container, string> = { webm: "video/webm", mp4: "video/mp4" };

/**
 * One byte range of `size` bytes from a Range header ("bytes=0-", "bytes=100-199", "bytes=-500"), or null when there is
 * no usable header (send the whole file), or "unsatisfiable" (416). Multiple ranges are answered with the first.
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)(?:,.*)?$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (size === 0) return "unsatisfiable";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/** A share token: 32 random bytes, URL-safe (256 bits — not guessable). */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored for a token: its SHA-256 (a database leak does not reveal working links). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Shape check before any lookup: 43 URL-safe characters. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Reads an upload body up to `max` bytes, stopping as soon as it is exceeded (the rest is never buffered).
 * Returns null when it is too large.
 */
export async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

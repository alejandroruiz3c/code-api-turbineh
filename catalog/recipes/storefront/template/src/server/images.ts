import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { env } from "@/env";

/**
 * Where an uploaded product image lives (storage.objects):
 * - with BLOB_READ_WRITE_TOKEN: Vercel Blob (official SDK, public URL on Blob's CDN), so images survive serverless
 *   instances and never load the database;
 * - without it (local development, the TurbineH sandbox, any host without Blob): the image bytes in PostgreSQL,
 *   served by /shop/images/<id> — a real local fallback, not a stub.
 * The content type is detected from the bytes before this is called (imageType), never taken from the browser.
 */
export type StoredImage =
  | { image: Buffer; imageMime: string; imageBlobUrl: null }
  | { image: null; imageMime: string; imageBlobUrl: string };

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Stores an uploaded image in Vercel Blob when configured, otherwise returns it for the database row. */
export async function storeProductImage(bytes: Buffer, mime: string): Promise<StoredImage> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { image: bytes, imageMime: mime, imageBlobUrl: null };
  const blob = await put(`products/${randomUUID()}.${EXT[mime] ?? "bin"}`, bytes, {
    access: "public",
    contentType: mime,
    addRandomSuffix: false,
    cacheControlMaxAge: 31_536_000,
    token,
  });
  return { image: null, imageMime: mime, imageBlobUrl: blob.url };
}

/** Deletes a replaced image from Vercel Blob (best effort: a leftover file is never worth failing the save). */
export async function deleteStoredImage(url: string | null): Promise<void> {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!url || !token) return;
  await del(url, { token }).catch(() => undefined);
}

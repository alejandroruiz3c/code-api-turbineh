import { del, put, type PutBlobResult } from "@vercel/blob";

/** What can be uploaded: bytes, text or a web Blob/File (streams need multipart uploads, not covered here). */
export type StoredBody = Buffer | Uint8Array | string | Blob;

/**
 * Stores a file in Vercel Blob under `pathname` (e.g. "uploads/<id>.png") and returns its public URL.
 * The SDK authenticates with the BLOB_READ_WRITE_TOKEN environment variable (set by Vercel when a Blob store is
 * connected); without it this throws, so callers that must work locally keep their own fallback.
 * `contentType` should come from the bytes (file type detection), never from the browser.
 */
export async function storeObject(
  pathname: string,
  body: StoredBody,
  contentType: string,
): Promise<PutBlobResult> {
  if (!/^[\w./-]{1,512}$/.test(pathname) || pathname.includes(".."))
    throw new Error("Invalid object path");
  const data = body instanceof Uint8Array && !Buffer.isBuffer(body) ? Buffer.from(body) : body;
  return put(pathname, data, { access: "public", contentType, addRandomSuffix: false });
}

/** Deletes a stored file by its URL (no error when it does not exist). */
export async function deleteObject(url: string): Promise<void> {
  await del(url);
}

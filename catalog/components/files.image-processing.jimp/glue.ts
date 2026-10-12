import { Jimp } from "jimp";

/** Uploads larger than this are rejected before decoding (memory and CPU stay bounded). */
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
/** Larger images are rejected after decoding: no legitimate product photo needs more. */
const MAX_SIDE = 8000;

/**
 * Thumbnail for galleries and product cards: scaled down to `maxWidth` keeping the aspect ratio (never enlarged) and
 * re-encoded as JPEG, which also drops the original metadata (EXIF, e.g. GPS location).
 */
export async function makeThumbnail(input: Buffer, maxWidth = 400): Promise<Buffer> {
  if (input.length > MAX_INPUT_BYTES) throw new Error("Image is too large");
  if (!Number.isInteger(maxWidth) || maxWidth < 16 || maxWidth > 2000)
    throw new Error("Invalid width");
  const img = await Jimp.read(input);
  if (img.bitmap.width > MAX_SIDE || img.bitmap.height > MAX_SIDE)
    throw new Error("Image dimensions are too large");
  if (img.bitmap.width > maxWidth) img.resize({ w: maxWidth });
  return img.getBuffer("image/jpeg");
}

import { fileTypeFromBuffer } from "file-type";

/** Magic numbers live in the first bytes: never scan more than this. */
const SNIFF_BYTES = 4100;

/** Real type of a file from its content (not from its name or the browser's claim); null when unknown. */
export async function detectFileType(
  data: Uint8Array,
): Promise<{ ext: string; mime: string } | null> {
  const t = await fileTypeFromBuffer(data.subarray(0, SNIFF_BYTES));
  return t ? { ext: t.ext, mime: t.mime } : null;
}

/** Upload check: true only when the detected type is in the allow-list (e.g. ["image/png", "application/pdf"]). */
export async function isAllowedFileType(
  data: Uint8Array,
  allowedMimes: readonly string[],
): Promise<boolean> {
  const t = await detectFileType(data);
  return t !== null && allowedMimes.includes(t.mime);
}

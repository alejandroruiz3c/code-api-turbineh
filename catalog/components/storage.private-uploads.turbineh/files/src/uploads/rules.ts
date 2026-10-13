import { sizeLabel, typesLabel, uploadConfig, type UploadConfig } from "./config";
import { sniffType } from "./sniff";

/**
 * Upload limits as pure rules (component storage.private-uploads.turbineh), unit-tested in tests/unit/uploads.test.ts:
 * why a file is refused, or null when it is accepted.
 */
export function uploadError(
  file: { size: number },
  bytes: Uint8Array | null,
  existing: number,
  c: UploadConfig = uploadConfig,
): string | null {
  if (file.size === 0) return "Choose a file.";
  if (file.size > c.maxBytes) return `Files can be up to ${sizeLabel(c.maxBytes)}.`;
  if (existing >= c.maxFilesPerRecord)
    return `This record already has ${c.maxFilesPerRecord} files (the maximum).`;
  if (bytes && !sniffType(bytes, c.types)) return `Only ${typesLabel(c)} files are accepted.`;
  return null;
}

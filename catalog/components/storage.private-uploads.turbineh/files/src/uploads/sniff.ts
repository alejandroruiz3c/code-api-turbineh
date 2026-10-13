import { FILE_TYPES, type FileType } from "./config";

/**
 * File type from the content (magic bytes), never from the name or the browser (component
 * storage.private-uploads.turbineh). HTML, SVG, scripts and executables are never recognised, whatever they are called.
 * Pure functions, unit-tested in tests/unit/uploads.test.ts.
 */
const starts = (bytes: Uint8Array, sig: number[], at = 0) =>
  sig.every((b, i) => bytes[at + i] === b);

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  new TextDecoder("latin1").decode(bytes.subarray(from, Math.min(to, bytes.length)));

/** Plain text: printable UTF-8 with no markup a browser would run. */
function isPlainText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.length === 0) return false;
  const printable = head.every(
    (b) => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b !== 0x7f),
  );
  const text = new TextDecoder().decode(head).toLowerCase();
  return printable && !/<\s*(html|script|svg|!doctype|\?xml|body|iframe)/.test(text);
}

/** The detected type among `allowed`, or null (refuse the file). */
export function sniffType(bytes: Uint8Array, allowed: readonly FileType[]): FileType | null {
  const detected = detect(bytes);
  for (const t of detected) if (allowed.includes(t)) return t;
  return null;
}

/** Every type the content is compatible with, most specific first. */
export function detect(bytes: Uint8Array): FileType[] {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return ["pdf"];
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ["png"];
  if (starts(bytes, [0xff, 0xd8, 0xff])) return ["jpg"];
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return ["webp"];
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return ["gif"];
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // Office Open XML: a zip whose entries name the document part.
    const names = ascii(bytes, 0, 64 * 1024);
    if (names.includes("word/")) return ["docx"];
    if (names.includes("xl/")) return ["xlsx"];
    return [];
  }
  if (isPlainText(bytes)) return ["csv", "txt"];
  return [];
}

export const mimeOf = (t: FileType): string => FILE_TYPES[t].mime;

/** Safe file name for storage and Content-Disposition: no paths, no control characters, bounded length. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || "file").slice(0, 120);
}

/** Content-Disposition value that is safe for any name (ASCII fallback + RFC 5987 UTF-8). */
export function attachmentHeader(name: string): string {
  const safe = safeFileName(name);
  return `attachment; filename="${safe.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

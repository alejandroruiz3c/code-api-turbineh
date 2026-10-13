import { z } from "zod";
import params from "./params.json";

/**
 * Upload rules (component storage.private-uploads.turbineh), written by TurbineH from the request: the largest file,
 * the accepted types (checked by content) and how many files one record may hold. Validated at start-up.
 */
export const FILE_TYPES = {
  pdf: { mime: "application/pdf", label: "PDF" },
  png: { mime: "image/png", label: "PNG" },
  jpg: { mime: "image/jpeg", label: "JPG" },
  webp: { mime: "image/webp", label: "WebP" },
  gif: { mime: "image/gif", label: "GIF" },
  txt: { mime: "text/plain", label: "TXT" },
  csv: { mime: "text/csv", label: "CSV" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "DOCX",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "XLSX",
  },
} as const;
export type FileType = keyof typeof FILE_TYPES;

const TYPE_KEYS = Object.keys(FILE_TYPES) as FileType[];
/** "pdf" or "application/pdf" → "pdf" (the request may state either); "jpeg" → "jpg". */
export function toFileType(value: string): FileType | null {
  const v = value.trim().toLowerCase();
  if (v === "jpeg") return "jpg";
  if ((TYPE_KEYS as string[]).includes(v)) return v as FileType;
  return TYPE_KEYS.find((k) => FILE_TYPES[k].mime === v) ?? null;
}

export const UploadParams = z.object({
  maxBytes: z
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024),
  types: z
    .array(z.string())
    .min(1)
    .max(20)
    .transform((list, ctx) => {
      const out = [...new Set(list.map(toFileType))];
      if (out.includes(null)) ctx.addIssue({ code: "custom", message: "unknown file type" });
      return out.filter((t): t is FileType => t !== null);
    }),
  maxFilesPerRecord: z.number().int().min(1).max(500),
  notifyOnUpload: z.boolean(),
});
export type UploadConfig = z.infer<typeof UploadParams>;

export const uploadConfig: UploadConfig = UploadParams.parse(params);

/** "10 MB", "512 KB". */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${+(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** "PDF, JPG or PNG". */
export function typesLabel(cfg: UploadConfig = uploadConfig): string {
  const labels = cfg.types.map((t) => FILE_TYPES[t].label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels.at(-1)}` : labels[0]!;
}

import { z } from "zod";
import params from "./params.json";

/**
 * Recording settings (component media.screen-recording.turbineh), written by TurbineH from the request: the highest
 * resolution the recorder asks for, the frame rate, the layouts offered, the longest recording, the largest upload and
 * whether recordings can be shared by link. Validated at start-up.
 */
export const RESOLUTIONS = {
  "720p": { width: 1280, height: 720, label: "720p (1280×720)" },
  "1080p": { width: 1920, height: 1080, label: "1080p (1920×1080)" },
  "1440p": { width: 2560, height: 1440, label: "1440p (2560×1440)" },
  "2160p": { width: 3840, height: 2160, label: "4K (3840×2160)" },
} as const;
export type ResolutionKey = keyof typeof RESOLUTIONS;
export const RESOLUTION_KEYS = Object.keys(RESOLUTIONS) as ResolutionKey[];

export const LAYOUT_KEYS = ["bubble", "side-by-side", "screen-only", "camera-only"] as const;
export type LayoutKey = (typeof LAYOUT_KEYS)[number];
export const LAYOUT_LABELS: Record<LayoutKey, string> = {
  bubble: "Camera bubble",
  "side-by-side": "Side by side",
  "screen-only": "Screen only",
  "camera-only": "Camera only",
};

export const RecordingParams = z.object({
  maxResolution: z.enum(RESOLUTION_KEYS as [ResolutionKey, ...ResolutionKey[]]),
  frameRate: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  layouts: z
    .array(z.enum(LAYOUT_KEYS))
    .min(1)
    .refine((l) => new Set(l).size === l.length, "layouts must be unique"),
  maxMinutes: z.number().int().min(1).max(120),
  maxBytes: z
    .number()
    .int()
    .min(1024 * 1024)
    .max(2 * 1024 * 1024 * 1024),
  shareLinks: z.boolean(),
});
export type RecordingConfig = z.infer<typeof RecordingParams>;

export const recordingConfig: RecordingConfig = RecordingParams.parse(params);

/** Resolutions a person may choose: every standard one up to the configured maximum, lowest first. */
export function resolutionChoices(
  max: ResolutionKey = recordingConfig.maxResolution,
): ResolutionKey[] {
  return RESOLUTION_KEYS.slice(0, RESOLUTION_KEYS.indexOf(max) + 1);
}

/** "500 MB", "1.5 GB". */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${+(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** "2:05", "1:02:03". */
export function durationLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

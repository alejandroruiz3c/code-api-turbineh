import { RESOLUTIONS, recordingConfig, type RecordingConfig } from "./config";

/**
 * What the recorder reports about a recording (component media.screen-recording.turbineh), checked before it is
 * stored: title, layout, duration within the app's limit, plausible sizes. Shown to people, never used for access.
 * Pure, unit-tested in tests/unit/recordings.test.ts.
 */
export interface RecordingMeta {
  title: string;
  durationMs: number;
  width: number;
  height: number;
  requestedWidth: number;
  requestedHeight: number;
  frameRate: number;
  layout: string;
}

const MAX_SIDE = RESOLUTIONS["2160p"].width;

export function checkMeta(
  meta: RecordingMeta,
  cfg: RecordingConfig = recordingConfig,
): string | null {
  if (!meta.title.trim() || meta.title.length > 160)
    return "Give the recording a title (up to 160 characters).";
  if (!(cfg.layouts as readonly string[]).includes(meta.layout)) return "Unknown layout.";
  if (!Number.isInteger(meta.durationMs) || meta.durationMs < 0) return "Invalid duration.";
  if (meta.durationMs > cfg.maxMinutes * 60_000 + 5_000)
    return `Recordings are limited to ${cfg.maxMinutes} minutes.`;
  for (const n of [meta.width, meta.height, meta.requestedWidth, meta.requestedHeight])
    if (!Number.isInteger(n) || n < 2 || n > MAX_SIDE) return "Invalid resolution.";
  if (!Number.isInteger(meta.frameRate) || meta.frameRate < 1 || meta.frameRate > 60)
    return "Invalid frame rate.";
  return null;
}

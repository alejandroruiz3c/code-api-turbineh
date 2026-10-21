/**
 * Container and codec of a recording (component media.screen-recording.turbineh): the first type of the preference
 * list the browser's MediaRecorder supports — MP4 (H.264/AAC, then whatever MP4 the browser makes) where available
 * (Safari, recent Chromium), else WebM with VP9 or VP8 and Opus (Chromium, Firefox). Pure, unit-tested with a stub.
 */
export const MIME_PREFERENCE = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export type Container = "mp4" | "webm";

export function pickMimeType(
  isTypeSupported: (type: string) => boolean,
): { mimeType: string; container: Container } | null {
  for (const mimeType of MIME_PREFERENCE)
    if (isTypeSupported(mimeType))
      return { mimeType, container: mimeType.startsWith("video/mp4") ? "mp4" : "webm" };
  return null;
}

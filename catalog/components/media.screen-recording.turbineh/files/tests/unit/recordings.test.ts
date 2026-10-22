import { describe, expect, it } from "vitest";
import { RecordingParams, resolutionChoices } from "@/recordings/config";
import {
  bubbleRect,
  ringWidth,
  centreSquare,
  deliveredLabel,
  outputSize,
  placeSources,
  videoConstraints,
} from "@/recordings/layout";
import {
  hashToken,
  newShareToken,
  parseRange,
  readLimited,
  TOKEN_SHAPE,
  videoContainer,
} from "@/recordings/media";
import { MIME_PREFERENCE, pickMimeType } from "@/recordings/mime";
import { checkMeta } from "@/recordings/rules";

/** Recorder logic (component media.screen-recording.turbineh): layouts, constraints, formats, ranges, share tokens. */
const canvas = { width: 1920, height: 1080 };
const screen = { width: 3840, height: 2160 };
const camera = { width: 1280, height: 720 };

describe("recording layouts", () => {
  it("camera bubble in each of the four corners over the full screen", () => {
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      const p = placeSources("bubble", canvas, screen, camera, corner);
      expect(p.screen).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
      expect(p.cameraShape).toBe("circle");
      const r = p.camera!;
      expect(r).toEqual(bubbleRect(canvas, corner));
      expect(r.width).toBe(270);
      expect(ringWidth(r.width)).toBe(7);
      expect(r.x < 960).toBe(corner.endsWith("left"));
      expect(r.y < 540).toBe(corner.startsWith("top"));
      expect(r.x + r.width).toBeLessThanOrEqual(1920);
      expect(r.y + r.height).toBeLessThanOrEqual(1080);
    }
  });

  it("side by side: screen on the left half and camera on the right half, each keeping its aspect ratio", () => {
    const p = placeSources("side-by-side", canvas, screen, camera);
    expect(p.screen).toEqual({ x: 0, y: 270, width: 960, height: 540 });
    expect(p.camera).toEqual({ x: 960, y: 270, width: 960, height: 540 });
  });

  it("screen only and camera only draw one source, letterboxed without cropping", () => {
    expect(placeSources("screen-only", canvas, { width: 1440, height: 900 }, camera)).toEqual({
      screen: { x: 96, y: 0, width: 1728, height: 1080 },
      camera: null,
      cameraShape: "rect",
    });
    const cam = placeSources("camera-only", canvas, screen, { width: 640, height: 480 });
    expect(cam.screen).toBeNull();
    expect(cam.camera).toEqual({ x: 240, y: 0, width: 1440, height: 1080 });
  });

  it("the bubble samples the centred square of the camera frame", () => {
    expect(centreSquare(camera)).toEqual({ x: 280, y: 0, width: 720, height: 720 });
  });
});

describe("resolution: asks for up to 4K and records at the highest resolution the device delivers", () => {
  it("asks with ideal constraints only (never exact or min), so a device that cannot deliver 4K still records", () => {
    const c = videoConstraints("2160p", 30);
    expect(c).toEqual({
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30 },
    });
    expect(JSON.stringify(c)).not.toMatch(/exact|min|max/);
  });

  it("records at the asked resolution when the devices deliver it, and never upscales beyond what they deliver", () => {
    expect(outputSize("2160p", "bubble", { screen, camera })).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(outputSize("2160p", "camera-only", { screen, camera })).toEqual({
      width: 1280,
      height: 720,
    });
    expect(
      outputSize("2160p", "side-by-side", { screen: { width: 1920, height: 1080 }, camera }),
    ).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(outputSize("1080p", "screen-only", { screen, camera: null })).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(
      outputSize("2160p", "screen-only", { screen: { width: 1366, height: 767 }, camera: null }),
    ).toEqual({
      width: 1362,
      height: 766,
    });
  });

  it("says honestly what was asked and what each device delivers", () => {
    expect(deliveredLabel("2160p", { screen, camera })).toBe(
      "asked 3840×2160 · screen delivers 3840×2160 · camera delivers 1280×720",
    );
    expect(deliveredLabel("1080p", { screen: null, camera })).toContain("screen not shared");
  });

  it("offers every standard resolution up to the app's maximum", () => {
    expect(resolutionChoices("2160p")).toEqual(["720p", "1080p", "1440p", "2160p"]);
    expect(resolutionChoices("1080p")).toEqual(["720p", "1080p"]);
  });
});

describe("recording format", () => {
  it("picks MP4 when the browser records it, else WebM with VP9 or VP8 and Opus", () => {
    expect(pickMimeType(() => true)).toEqual({ mimeType: MIME_PREFERENCE[0], container: "mp4" });
    expect(pickMimeType((t) => t === "video/mp4")).toEqual({
      mimeType: "video/mp4",
      container: "mp4",
    });
    expect(pickMimeType((t) => t.startsWith("video/webm"))).toEqual({
      mimeType: "video/webm;codecs=vp9,opus",
      container: "webm",
    });
    expect(pickMimeType((t) => t === "video/webm;codecs=vp8,opus")?.container).toBe("webm");
    expect(pickMimeType(() => false)).toBeNull();
  });

  it("recognises WebM and MP4 by content and refuses anything else", () => {
    expect(videoContainer(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]))).toBe("webm");
    expect(
      videoContainer(Uint8Array.from([0, 0, 0, 0x24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73])),
    ).toBe("mp4");
    expect(videoContainer(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(videoContainer(Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });

  it("an upload larger than the limit is refused while it is read: reading stops at the limit", async () => {
    const chunk = new Uint8Array(1024).fill(7);
    let pulled = 0;
    const body = () =>
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulled += 1;
          if (pulled > 100) c.close();
          else c.enqueue(chunk);
        },
      });
    expect(await readLimited(body(), 10 * 1024)).toBeNull();
    expect(pulled).toBeLessThan(15);
    pulled = 0;
    expect((await readLimited(body(), 200 * 1024))?.byteLength).toBe(100 * 1024);
  });

  it("checks what the recorder reports: layout of this app, duration limit, plausible sizes", () => {
    const cfg = RecordingParams.parse({
      maxResolution: "2160p",
      frameRate: 30,
      layouts: ["bubble", "screen-only"],
      maxMinutes: 5,
      maxBytes: 10485760,
      shareLinks: true,
    });
    const ok = {
      title: "Demo",
      durationMs: 60_000,
      width: 3840,
      height: 2160,
      requestedWidth: 3840,
      requestedHeight: 2160,
      frameRate: 30,
      layout: "bubble",
    };
    expect(checkMeta(ok, cfg)).toBeNull();
    expect(checkMeta({ ...ok, layout: "camera-only" }, cfg)).toBe("Unknown layout.");
    expect(checkMeta({ ...ok, durationMs: 6 * 60_000 }, cfg)).toMatch(/limited to 5 minutes/);
    expect(checkMeta({ ...ok, width: 8000 }, cfg)).toBe("Invalid resolution.");
    expect(checkMeta({ ...ok, title: " " }, cfg)).toMatch(/title/);
  });
});

describe("playback and sharing", () => {
  it("answers byte ranges for seeking (206), whole file without a Range header, 416 beyond the end", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-2", 1000)).toBe("unsatisfiable");
    expect(parseRange("items=0-1", 1000)).toBeNull();
  });

  it("share tokens are 256-bit random and only their SHA-256 is stored", () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(TOKEN_SHAPE);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });
});

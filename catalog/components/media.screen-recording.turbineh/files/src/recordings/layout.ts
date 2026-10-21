import type { LayoutKey, ResolutionKey } from "./config";
import { RESOLUTIONS } from "./config";

/**
 * Layout math of the recorder (component media.screen-recording.turbineh): where the screen and the camera are drawn
 * on the output canvas for each layout, the media constraints asked of the browser, the size of the output, and the
 * honest line that says what the devices really deliver. Pure functions, unit-tested in tests/unit/recordings.test.ts.
 */
export interface Size {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const CORNERS: Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

export interface Placement {
  /** Where the screen is drawn (null: not drawn). */
  screen: Rect | null;
  /** Where the camera is drawn (null: not drawn). */
  camera: Rect | null;
  /** The camera is clipped to a circle (bubble) or drawn as a rectangle. */
  cameraShape: "circle" | "rect";
}

/** The largest rectangle with the source's aspect ratio that fits `box`, centred in it (letterboxing, no crop). */
export function contain(source: Size, box: Rect): Rect {
  if (source.width <= 0 || source.height <= 0) return { ...box };
  const scale = Math.min(box.width / source.width, box.height / source.height);
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);
  return {
    x: Math.round(box.x + (box.width - width) / 2),
    y: Math.round(box.y + (box.height - height) / 2),
    width,
    height,
  };
}

/** The camera bubble: a circle whose diameter is a quarter of the canvas height (min 64 px), with a margin. */
export function bubbleRect(canvas: Size, corner: Corner): Rect {
  const d = Math.max(64, Math.round(canvas.height / 4));
  const m = Math.round(Math.max(8, canvas.height / 40));
  const x = corner.endsWith("left") ? m : canvas.width - d - m;
  const y = corner.startsWith("top") ? m : canvas.height - d - m;
  return { x, y, width: d, height: d };
}

/** Width of the white ring drawn around the camera bubble (a 40th of its diameter, at least 2 px). */
export function ringWidth(diameter: number): number {
  return Math.max(2, Math.round(diameter / 40));
}

/**
 * Where each source goes on a canvas of `canvas` size for a layout:
 *  - bubble: the screen fills the canvas (contained), the camera is a circle in the chosen corner;
 *  - side-by-side: two equal halves, screen left and camera right, each contained;
 *  - screen-only / camera-only: that source fills the canvas (contained), the other is not drawn.
 */
export function placeSources(
  layout: LayoutKey,
  canvas: Size,
  screen: Size,
  camera: Size,
  corner: Corner = "bottom-right",
): Placement {
  const full: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
  switch (layout) {
    case "bubble":
      return {
        screen: contain(screen, full),
        camera: bubbleRect(canvas, corner),
        cameraShape: "circle",
      };
    case "side-by-side": {
      const half = Math.floor(canvas.width / 2);
      return {
        screen: contain(screen, { x: 0, y: 0, width: half, height: canvas.height }),
        camera: contain(camera, {
          x: half,
          y: 0,
          width: canvas.width - half,
          height: canvas.height,
        }),
        cameraShape: "rect",
      };
    }
    case "screen-only":
      return { screen: contain(screen, full), camera: null, cameraShape: "rect" };
    case "camera-only":
      return { screen: null, camera: contain(camera, full), cameraShape: "rect" };
  }
}

/**
 * The source rectangle to sample from the camera for the bubble: the centred square of the frame (the circle shows a
 * face, not a squashed frame).
 */
export function centreSquare(source: Size): Rect {
  const side = Math.min(source.width, source.height);
  return {
    x: Math.round((source.width - side) / 2),
    y: Math.round((source.height - side) / 2),
    width: side,
    height: side,
  };
}

/**
 * Video constraints for getDisplayMedia / getUserMedia: always `ideal`, never `exact` or `min`, so a device that
 * cannot deliver the asked resolution still records (no OverconstrainedError) at the closest it can.
 */
export function videoConstraints(
  resolution: ResolutionKey,
  frameRate: number,
): MediaTrackConstraints {
  const r = RESOLUTIONS[resolution];
  return {
    width: { ideal: r.width },
    height: { ideal: r.height },
    frameRate: { ideal: frameRate },
  };
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Output canvas size: the chosen resolution, clamped so it is never larger than what the sources the layout draws
 * really deliver (upscaling would only add pixels, not detail). The output keeps the chosen 16:9 shape; the clamp is
 * by the largest delivered source height for the layout (screen-only: the screen; camera-only: the camera; bubble:
 * the screen; side-by-side: twice the larger delivered height fits two halves, so the larger height). Even sizes
 * (video encoders need them).
 */
export function outputSize(
  resolution: ResolutionKey,
  layout: LayoutKey,
  delivered: { screen: Size | null; camera: Size | null },
): Size {
  const asked = RESOLUTIONS[resolution];
  const heights =
    layout === "camera-only"
      ? [delivered.camera?.height]
      : layout === "screen-only" || layout === "bubble"
        ? [delivered.screen?.height ?? delivered.camera?.height]
        : [delivered.screen?.height, delivered.camera?.height];
  const best = Math.max(0, ...heights.filter((h): h is number => typeof h === "number" && h > 0));
  if (best === 0 || best >= asked.height) return { width: asked.width, height: asked.height };
  return { width: even((asked.width * best) / asked.height), height: even(best) };
}

/** "asked 3840×2160 · screen delivers 3840×2160 · camera delivers 1280×720" — what the devices really give. */
export function deliveredLabel(
  resolution: ResolutionKey,
  delivered: { screen: Size | null; camera: Size | null },
): string {
  const asked = RESOLUTIONS[resolution];
  const part = (name: string, s: Size | null) =>
    s ? `${name} delivers ${s.width}×${s.height}` : `${name} not shared`;
  return [
    `asked ${asked.width}×${asked.height}`,
    part("screen", delivered.screen),
    part("camera", delivered.camera),
  ].join(" · ");
}

"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  LAYOUT_LABELS,
  RESOLUTIONS,
  sizeLabel,
  type LayoutKey,
  type ResolutionKey,
} from "@/recordings/config";
import {
  centreSquare,
  CORNERS,
  ringWidth,
  deliveredLabel,
  outputSize,
  placeSources,
  videoConstraints,
  type Corner,
  type Size,
} from "@/recordings/layout";
import { pickMimeType } from "@/recordings/mime";

/** Milliseconds of a monotonic clock (durations of the recording; read in event handlers, never while rendering). */
const clock = (): number => performance.now();
/** "Recording 2026-10-21 14:05" when the person typed no title. */
const defaultTitle = (): string =>
  `Recording ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

type Phase = "idle" | "ready" | "recording" | "uploading";

const sizeOf = (track: MediaStreamTrack | undefined): Size | null => {
  const s = track?.getSettings();
  return s?.width && s.height ? { width: s.width, height: s.height } : null;
};

const CORNER_LABELS: Record<Corner, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

/**
 * The recorder (media.screen-recording.turbineh): asks for the screen (getDisplayMedia) and the camera and microphone
 * (getUserMedia) at up to the chosen resolution with `ideal` constraints, shows what the devices really deliver,
 * composes the chosen layout on a canvas (switchable while recording), records it with MediaRecorder (MP4 when the
 * browser supports it, else WebM) and uploads it to the workspace's private storage.
 */
export function Recorder(props: {
  resolutions: ResolutionKey[];
  layouts: LayoutKey[];
  frameRate: number;
  maxMinutes: number;
  maxBytes: number;
}) {
  const router = useRouter();
  const [resolution, setResolution] = useState<ResolutionKey>(props.resolutions.at(-1) ?? "1080p");
  const [layout, setLayout] = useState<LayoutKey>(props.layouts[0] ?? "bubble");
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [delivered, setDelivered] = useState<string>("");
  const [output, setOutput] = useState<Size | null>(null);
  const [error, setError] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenVideo = useRef<HTMLVideoElement | null>(null);
  const cameraVideo = useRef<HTMLVideoElement | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const audio = useRef<MediaStreamTrack[]>([]);
  const layoutRef = useRef(layout);
  const cornerRef = useRef(corner);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);
  const startLayout = useRef<LayoutKey>(layout);
  const ask = RESOLUTIONS[resolution];

  useEffect(() => {
    layoutRef.current = layout;
    cornerRef.current = corner;
  }, [layout, corner]);

  const stopAll = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    for (const s of streams.current) for (const t of s.getTracks()) t.stop();
    streams.current = [];
    audio.current = [];
  };
  useEffect(() => stopAll, []);

  const sourceVideo = async (stream: MediaStream): Promise<HTMLVideoElement> => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    await v.play();
    return v;
  };

  /** Draws the current layout on the canvas (the live preview, and what is recorded). */
  const draw = () => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const sv = screenVideo.current;
    const cv = cameraVideo.current;
    const screen = sv ? { width: sv.videoWidth, height: sv.videoHeight } : { width: 0, height: 0 };
    const camera = cv ? { width: cv.videoWidth, height: cv.videoHeight } : { width: 0, height: 0 };
    const place = placeSources(
      layoutRef.current,
      { width: canvas.width, height: canvas.height },
      screen,
      camera,
      cornerRef.current,
    );
    // What is drawn, for people using assistive technology and for the E2E suite (same rectangles as the pixels).
    const described = JSON.stringify({ layout: layoutRef.current, ...place });
    if (canvas.dataset.placement !== described) canvas.dataset.placement = described;
    g.fillStyle = "#000";
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (place.screen && sv && screen.width)
      g.drawImage(sv, place.screen.x, place.screen.y, place.screen.width, place.screen.height);
    if (place.camera && cv && camera.width) {
      const r = place.camera;
      if (place.cameraShape === "circle") {
        const sq = centreSquare(camera);
        g.save();
        g.beginPath();
        g.arc(r.x + r.width / 2, r.y + r.height / 2, r.width / 2, 0, Math.PI * 2);
        g.clip();
        g.drawImage(cv, sq.x, sq.y, sq.width, sq.height, r.x, r.y, r.width, r.height);
        g.restore();
        // A white ring around the bubble separates the face from the screen behind it.
        const ring = ringWidth(r.width);
        g.lineWidth = ring;
        g.strokeStyle = "#ffffff";
        g.beginPath();
        g.arc(r.x + r.width / 2, r.y + r.height / 2, r.width / 2 - ring / 2, 0, Math.PI * 2);
        g.stroke();
      } else g.drawImage(cv, r.x, r.y, r.width, r.height);
    }
  };

  const prepare = async () => {
    setError("");
    stopAll();
    const video = videoConstraints(resolution, props.frameRate);
    let screen: MediaStream | null = null;
    let camera: MediaStream | null = null;
    const needsScreen = props.layouts.some((l) => l !== "camera-only");
    const needsCamera = props.layouts.some((l) => l !== "screen-only");
    if (needsScreen) {
      try {
        screen = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
      } catch {
        screen = null;
      }
    }
    if (needsCamera) {
      try {
        camera = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      } catch {
        try {
          camera = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch {
          camera = null;
        }
      }
    }
    if (!screen && !camera) {
      setError("Allow screen sharing or the camera to record.");
      return;
    }
    streams.current = [screen, camera].filter((s): s is MediaStream => s !== null);
    audio.current = camera?.getAudioTracks() ?? [];
    screenVideo.current = screen ? await sourceVideo(screen) : null;
    cameraVideo.current = camera ? await sourceVideo(camera) : null;
    const got = {
      screen: sizeOf(screen?.getVideoTracks()[0]),
      camera: sizeOf(camera?.getVideoTracks()[0]),
    };
    const usable: LayoutKey = !screen ? "camera-only" : !camera ? "screen-only" : layoutRef.current;
    if (usable !== layoutRef.current) {
      layoutRef.current = usable;
      setLayout(usable);
    }
    const size = outputSize(resolution, usable, got);
    setOutput(size);
    setDelivered(deliveredLabel(resolution, got));
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    timer.current = setInterval(draw, Math.round(1000 / props.frameRate));
    setPhase("ready");
  };

  const start = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const type = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!type) {
      setError("This browser cannot record video (MediaRecorder).");
      return;
    }
    const stream = new MediaStream([
      ...canvas.captureStream(props.frameRate).getVideoTracks(),
      ...audio.current,
    ]);
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: type.mimeType });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => void upload(new Blob(chunks, { type: type.mimeType }));
    recorder.current = rec;
    startLayout.current = layoutRef.current;
    startedAt.current = clock();
    setElapsed(0);
    rec.start(1000);
    setPhase("recording");
  };

  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      const ms = clock() - startedAt.current;
      setElapsed(ms);
      if (ms >= props.maxMinutes * 60_000) recorder.current?.stop();
    }, 500);
    return () => clearInterval(t);
  }, [phase, props.maxMinutes]);

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  const upload = async (blob: Blob) => {
    const durationMs = Math.round(clock() - startedAt.current);
    stopAll();
    setPhase("uploading");
    if (blob.size > props.maxBytes) {
      setError(`Recordings are limited to ${sizeLabel(props.maxBytes)}.`);
      setPhase("idle");
      return;
    }
    const canvas = canvasRef.current;
    const q = new URLSearchParams({
      title: title.trim() || defaultTitle(),
      durationMs: String(durationMs),
      width: String(canvas?.width ?? 0),
      height: String(canvas?.height ?? 0),
      requestedWidth: String(ask.width),
      requestedHeight: String(ask.height),
      frameRate: String(props.frameRate),
      layout: startLayout.current,
    });
    const res = await fetch(`/api/recordings?${q.toString()}`, { method: "POST", body: blob });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) {
      setError(body.error ?? "Upload failed.");
      setPhase("idle");
      return;
    }
    router.push(`/dashboard/recordings/${body.id}`);
  };

  const recording = phase === "recording";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Title
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Resolution
          <select
            className="rounded-md border border-field bg-surface px-3 py-2"
            value={resolution}
            disabled={phase !== "idle"}
            onChange={(e) => setResolution(e.target.value as ResolutionKey)}
          >
            {props.resolutions.map((r) => (
              <option key={r} value={r}>
                {RESOLUTIONS[r].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Camera bubble corner
          <select
            className="rounded-md border border-field bg-surface px-3 py-2"
            value={corner}
            onChange={(e) => setCorner(e.target.value as Corner)}
          >
            {CORNERS.map((c) => (
              <option key={c} value={c}>
                {CORNER_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="group" aria-label="Layout" className="flex flex-wrap gap-2">
        {props.layouts.map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={layout === l}
            onClick={() => setLayout(l)}
            className={`rounded-md border px-3 py-1 text-sm ${layout === l ? "border-brand bg-brand text-brand-contrast" : "border-line bg-panel"}`}
          >
            {LAYOUT_LABELS[l]}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted">
        Asks for up to {ask.width}×{ask.height} at {props.frameRate} fps; records at the highest
        resolution your devices deliver.
      </p>
      {delivered ? (
        <p data-testid="delivered" className="text-sm">
          {delivered}
          {output ? ` · recording at ${output.width}×${output.height}` : ""}
        </p>
      ) : null}
      <canvas
        ref={canvasRef}
        data-testid="preview"
        aria-label="Recording preview"
        className="aspect-video w-full rounded-lg border border-line bg-subtle"
      />
      <div className="flex items-center gap-3">
        {phase === "idle" ? (
          <Button onClick={() => void prepare()}>Share screen and camera</Button>
        ) : null}
        {phase === "ready" ? <Button onClick={start}>Start recording</Button> : null}
        {recording ? (
          <Button onClick={stop} className="bg-danger-soft text-danger">
            Stop recording
          </Button>
        ) : null}
        {recording ? (
          <span data-testid="elapsed" className="text-sm text-muted">
            Recording {Math.floor(elapsed / 1000)} s (max {props.maxMinutes} min)
          </span>
        ) : null}
        {phase === "uploading" ? (
          <span role="status" className="text-sm text-muted">
            Uploading…
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

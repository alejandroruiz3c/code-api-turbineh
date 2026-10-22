import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

/**
 * Screen and camera recording end to end (component media.screen-recording.turbineh), on Chromium's fake devices: the
 * fake camera and microphone (--use-fake-device-for-media-stream), permission prompts accepted
 * (--use-fake-ui-for-media-stream) and the screen picker answered with the whole screen
 * (--auto-select-desktop-capture-source). The real getDisplayMedia / getUserMedia / canvas / MediaRecorder path runs.
 */
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
    ],
  },
  permissions: ["camera", "microphone"],
});

type Params = { maxResolution: string; layouts: string[]; shareLinks: boolean };
const params = JSON.parse(readFileSync("src/recordings/params.json", "utf8")) as Params;
const openSignUp = readFileSync("src/lib/sign-up-policy.ts", "utf8").includes('= "open"');
const SIZES: Record<string, [number, number]> = {
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "1440p": [2560, 1440],
  "2160p": [3840, 2160],
};
const LABELS: Record<string, string> = {
  bubble: "Camera bubble",
  "side-by-side": "Side by side",
  "screen-only": "Screen only",
  "camera-only": "Camera only",
};

type Rect = { x: number; y: number; width: number; height: number };
type Placement = { layout: string; screen: Rect | null; camera: Rect | null; cameraShape: string };

/** What the recorder draws now: the layout and its rectangles (the canvas's data-placement, set where it draws). */
async function placement(page: Page): Promise<{ p: Placement; width: number; height: number }> {
  return page.getByTestId("preview").evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return { p: JSON.parse(c.dataset.placement ?? "null"), width: c.width, height: c.height };
  });
}

/** The colour of one pixel of the composed frame (what MediaRecorder records). */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.getByTestId("preview").evaluate(
    (el, [px, py]) => {
      const d = (el as HTMLCanvasElement).getContext("2d")!.getImageData(px!, py!, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    },
    [Math.round(x), Math.round(y)],
  );
}
const isWhite = (c: number[]) => c.every((v) => v > 200);
const isBlack = (c: number[]) => c.every((v) => v < 30);
/** Chromium's fake screen and camera are green test patterns. */
const isPicture = (c: number[]) => !isBlack(c) && !isWhite(c);

/** Layout is on screen: its rectangles are where the layout says, and the pixels show it. */
async function expectLayout(page: Page, layout: string, corner = "bottom-right") {
  await expect.poll(async () => (await placement(page)).p?.layout, { timeout: 5_000 }).toBe(layout);
  await page.waitForTimeout(300);
  const { p, width: w, height: h } = await placement(page);
  if (layout === "bubble") {
    const r = p.camera!;
    expect(p.cameraShape).toBe("circle");
    expect(p.screen).toEqual({ x: 0, y: 0, width: w, height: h });
    expect(r.x + r.width / 2 > w / 2, "bubble on the chosen side").toBe(corner.endsWith("right"));
    expect(r.y + r.height / 2 > h / 2, "bubble at the chosen edge").toBe(
      corner.startsWith("bottom"),
    );
    const ring = Math.max(2, Math.round(r.width / 40));
    expect(
      isWhite(await pixel(page, r.x + ring / 2, r.y + r.height / 2)),
      "white ring of the bubble",
    ).toBe(true);
    expect(
      isPicture(await pixel(page, r.x + r.width / 2, r.y + r.height / 2)),
      "camera inside",
    ).toBe(true);
  } else if (layout === "side-by-side") {
    expect(p.screen!.x + p.screen!.width).toBeLessThanOrEqual(w / 2 + 1);
    expect(p.camera!.x).toBeGreaterThanOrEqual(w / 2 - 1);
    // Two 16:9 feeds in two halves: letterbox bands above and below each, both pictures in the middle.
    expect(isBlack(await pixel(page, w / 4, 4)), "band above the screen").toBe(true);
    expect(isBlack(await pixel(page, (3 * w) / 4, 4)), "band above the camera").toBe(true);
    expect(isPicture(await pixel(page, w / 4, h / 2)), "screen on the left").toBe(true);
    expect(isPicture(await pixel(page, (3 * w) / 4, h / 2)), "camera on the right").toBe(true);
  } else {
    expect(p.camera === null).toBe(layout === "screen-only");
    expect(p.screen === null).toBe(layout === "camera-only");
    expect(isPicture(await pixel(page, w / 4, 4)), "one source fills the frame").toBe(true);
    expect(isPicture(await pixel(page, w - 4, h - 4)), "no bubble in the corner").toBe(true);
  }
}

async function share(page: Page, resolution: string, title: string) {
  await page.goto("/dashboard/recordings/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Resolution").selectOption(resolution);
  await page.getByRole("button", { name: "Share screen and camera" }).click();
  await expect(page.getByTestId("delivered")).toBeVisible();
}

async function recordFor(page: Page, ms: number) {
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("elapsed")).toBeVisible();
  await page.waitForTimeout(ms);
}

async function stopAndOpen(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page).toHaveURL(/\/dashboard\/recordings\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url().split("/").at(-1)!;
}

test.describe.serial("screen and camera recording", () => {
  let id = "";

  test("a member records the screen with the camera, switches the layout while recording and the feeds are rearranged; the video is uploaded to private storage and listed in the video library", async ({
    page,
  }) => {
    await share(page, "720p", "Layouts demo");
    await expect(page.getByTestId("delivered")).toContainText("screen delivers");
    await expect(page.getByTestId("delivered")).toContainText("camera delivers");
    await recordFor(page, 800);
    for (const layout of params.layouts) {
      await page.getByRole("button", { name: LABELS[layout] }).click();
      await expect(page.getByRole("button", { name: LABELS[layout] })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expectLayout(page, layout);
      if (layout === "bubble") {
        // The bubble moves to another corner while recording.
        await page.getByLabel("Camera bubble corner").selectOption("top-left");
        await page.waitForTimeout(300);
        await expectLayout(page, layout, "top-left");
        await page.getByLabel("Camera bubble corner").selectOption("bottom-right");
      }
      await page.waitForTimeout(500);
    }
    id = await stopAndOpen(page);
    await page.goto("/dashboard/recordings");
    const row = page.getByTestId("recording-row").filter({ hasText: "Layouts demo" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("1280×720");
    await expect(row).toContainText(LABELS[params.layouts[0]!]!);
  });

  test("asks for up to 4K and records at the highest resolution the device delivers (camera at 3840x2160 when it supports it)", async ({
    page,
  }) => {
    const top = params.maxResolution;
    const [w, h] = SIZES[top]!;
    await share(page, top, "Top resolution");
    const line = page.getByTestId("delivered");
    await expect(line).toContainText(`asked ${w}×${h}`);
    const text = (await line.textContent()) ?? "";
    // Whatever the devices deliver is what is recorded: never more than asked, never more than delivered.
    const screen = /screen delivers (\d+)×(\d+)/.exec(text);
    const camera = /camera delivers (\d+)×(\d+)/.exec(text);
    expect(camera).not.toBeNull();
    const best = Math.max(Number(screen?.[2] ?? 0), Number(camera?.[2] ?? 0));
    const expected =
      best >= h ? [w, h] : [Math.floor((w * best) / h / 2) * 2, Math.floor(best / 2) * 2];
    await expect(line).toContainText(`recording at ${expected[0]}×${expected[1]}`);
    // Chromium's fake camera delivers what it is asked for: 4K is really asked and delivered here.
    expect(Number(camera?.[1])).toBe(w);
    await recordFor(page, 1500);
    await stopAndOpen(page);
    await expect(page.getByTestId("recorded-resolution")).toHaveText(
      `${expected[0]}×${expected[1]}`,
    );
    const player = page.getByTestId("player");
    await expect
      .poll(() => player.evaluate((v) => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 })
      .toBe(expected[0]);
  });

  test("the recording plays in the player and seeks with byte ranges (206 Partial Content)", async ({
    page,
  }) => {
    await page.goto(`/dashboard/recordings/${id}`);
    const player = page.getByTestId("player");
    await expect
      .poll(() => player.evaluate((v) => (v as HTMLVideoElement).readyState), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);
    expect(await player.evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBe(1280);
    const media = `/dashboard/recordings/${id}/media`;
    const whole = await page.request.get(media);
    expect(whole.status()).toBe(200);
    expect(whole.headers()["content-type"]).toMatch(/^video\/(webm|mp4)$/);
    const size = (await whole.body()).byteLength;
    const part = await page.request.get(media, { headers: { Range: "bytes=10-109" } });
    expect(part.status()).toBe(206);
    expect(part.headers()["content-range"]).toBe(`bytes 10-109/${size}`);
    expect((await part.body()).byteLength).toBe(100);
    expect((await part.body()).equals((await whole.body()).subarray(10, 110))).toBe(true);
  });

  test("a viewer opens a shared link without an account and watches the video; a revoked link no longer works", async ({
    page,
    browser,
  }) => {
    test.skip(!params.shareLinks, "sharing by link is turned off in this app");
    await page.goto(`/dashboard/recordings/${id}`);
    await page.getByRole("button", { name: "Create share link" }).click();
    const href = (await page.getByTestId("share-link").getAttribute("href")) ?? "";
    expect(href).toMatch(/\/v\/[A-Za-z0-9_-]{43}$/);
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const viewer = await anon.newPage();
    await viewer.goto(href);
    await expect(viewer.getByRole("heading", { name: "Layouts demo" })).toBeVisible();
    await expect
      .poll(
        () =>
          viewer.getByTestId("shared-player").evaluate((v) => (v as HTMLVideoElement).readyState),
        {
          timeout: 20_000,
        },
      )
      .toBeGreaterThanOrEqual(1);
    expect(
      (await viewer.request.get(`${href}/media`, { headers: { Range: "bytes=0-9" } })).status(),
    ).toBe(206);
    await page.getByRole("button", { name: "Revoke share link" }).click();
    await expect(page.getByRole("status")).toHaveText("Share link revoked.");
    expect((await viewer.request.get(href)).status()).toBe(404);
    expect((await viewer.request.get(`${href}/media`)).status()).toBe(404);
    // A made-up token of the right shape opens nothing either.
    expect((await viewer.request.get(`/v/${"a".repeat(43)}/media`)).status()).toBe(404);
    // Without the link and without an account, the workspace's video is not served.
    const direct = await viewer.request.get(`/dashboard/recordings/${id}/media`, {
      maxRedirects: 0,
    });
    expect(direct.status()).not.toBe(200);
    await anon.close();
  });

  test("a person in another workspace never sees or plays this workspace's recordings", async ({
    browser,
  }) => {
    test.skip(!openSignUp, "staff-only sign-up: no second workspace can exist");
    const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await other.newPage();
    await signUp(page, `rec-other-${Date.now()}@example.com`);
    await page.goto("/dashboard/recordings");
    await expect(page.getByTestId("recording-row")).toHaveCount(0);
    expect((await page.request.get(`/dashboard/recordings/${id}/media`)).status()).toBe(404);
    const detail = await page.goto(`/dashboard/recordings/${id}`);
    expect(detail?.status()).toBe(404);
    await other.close();
  });

  test("an upload that is not a WebM or MP4 video is refused, and nothing is stored", async ({
    page,
  }) => {
    const q = new URLSearchParams({
      title: "Not a video",
      durationMs: "1000",
      width: "1280",
      height: "720",
      requestedWidth: "1280",
      requestedHeight: "720",
      frameRate: "30",
      layout: params.layouts[0]!,
    });
    const res = await page.request.post(`/api/recordings?${q}`, {
      data: Buffer.from("<html><script>alert(1)</script></html>"),
      headers: { "content-type": "video/webm" },
    });
    expect(res.status()).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Only WebM or MP4 videos are accepted.",
    );
    await page.goto("/dashboard/recordings");
    await expect(page.getByTestId("recording-row").filter({ hasText: "Not a video" })).toHaveCount(
      0,
    );
  });
});

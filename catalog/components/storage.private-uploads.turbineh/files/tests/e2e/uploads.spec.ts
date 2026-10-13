import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD } from "./helpers";

/**
 * Private uploads end to end (component storage.private-uploads.turbineh). Limits come from this app's
 * src/uploads/params.json; with the S3 mock (tests/e2e/mocks/S3_BASE_URL.mjs) the files go through the production S3
 * driver, every request signed with SigV4 and checked by the mock.
 */
type Params = { maxBytes: number; types: string[] };
const params = JSON.parse(readFileSync("src/uploads/params.json", "utf8")) as Params;
const openSignUp = readFileSync("src/lib/sign-up-policy.ts", "utf8").includes('= "open"');

/** A small valid file of the first accepted type. */
function sample(): { name: string; mimeType: string; buffer: Buffer } {
  const t = params.types[0];
  const stamp = `${Date.now()}`;
  if (t === "png")
    return {
      name: `scan-${stamp}.png`,
      mimeType: "image/png",
      buffer: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(stamp),
      ]),
    };
  if (t === "jpg")
    return {
      name: `photo-${stamp}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(stamp)]),
    };
  if (t === "txt" || t === "csv")
    return {
      name: `notes-${stamp}.${t}`,
      mimeType: "text/plain",
      buffer: Buffer.from(`a,b\n${stamp},2\n`),
    };
  return {
    name: `invoice-${stamp}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.7\n% ${stamp}\n1 0 obj\n<<>>\nendobj\n%%EOF\n`),
  };
}

async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/dashboard/files");
  await page.getByLabel("File", { exact: true }).setInputFiles(file);
  await page.getByRole("button", { name: "Upload" }).click();
}

test.describe.serial("private uploads", () => {
  const file = sample();
  let href = "";

  test("a member uploads an allowed file and downloads exactly the same bytes", async ({
    page,
  }) => {
    await upload(page, file);
    await expect(page.getByRole("status")).toHaveText(`Uploaded ${file.name}.`);
    await page.reload();
    const link = page.getByTestId("file-row").filter({ hasText: file.name }).getByRole("link");
    href = (await link.getAttribute("href")) ?? "";
    expect(href).toMatch(/^\/dashboard\/files\/[0-9a-f-]{36}\/download$/);
    const res = await page.request.get(href);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(await res.body()).equals(file.buffer)).toBe(true);
  });

  test("files are stored privately: never under public/, never readable without the app", async ({
    page,
  }) => {
    const direct = await page.request.get(`/${file.name}`);
    expect(direct.status()).toBe(404);
    const s3 = process.env.S3_BASE_URL;
    test.skip(!s3, "local-disk driver: covered by tests/unit/uploads.test.ts");
    const objects = (await (await page.request.get(`${s3}/__objects`)).json()) as {
      key: string;
      size: number;
    }[];
    const stored = objects.find((o) => o.size === file.buffer.length);
    expect(stored).toBeTruthy();
    // The bucket refuses unsigned reads (private).
    expect((await page.request.get(`${s3}${stored!.key}`)).status()).toBe(403);
  });

  test("a file larger than the size limit, or whose content is not an allowed type, is refused", async ({
    page,
  }) => {
    await upload(page, {
      name: "invoice.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<!doctype html><script>alert(1)</script>"),
    });
    await expect(page.getByRole("status")).toHaveText(/^Only .+ files are accepted\.$/);
    const big = Buffer.alloc(params.maxBytes + 1, 0x20);
    big.write("%PDF-1.7\n");
    await upload(page, { name: "too-big.pdf", mimeType: "application/pdf", buffer: big });
    await expect(page.getByRole("status")).toHaveText(/^Files can be up to /);
  });

  test("only people who may see a file can download it: not anonymous visitors, not other workspaces", async ({
    browser,
  }) => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const res = await anon.request.get(href);
    expect(Buffer.from(await res.body()).equals(file.buffer)).toBe(false);
    expect(res.url()).toMatch(/\/sign-in/);
    await anon.close();
    test.skip(!openSignUp, "staff-only sign-up: no second workspace can exist");
    const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await other.newPage();
    await page.goto("/sign-up");
    await page.getByLabel("Name", { exact: true }).fill("Outsider");
    await page.getByLabel("Email").fill(`outsider-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByLabel("Workspace name").fill("Another firm");
    // better-auth allows 3 sign-up requests per 10 s per client in production builds: retry after the window.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole("button", { name: "Create account" }).click();
      try {
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 8_000 });
        break;
      } catch {
        await page.waitForTimeout(10_500);
      }
    }
    await expect(page).toHaveURL(/\/dashboard/);
    expect((await page.request.get(href)).status()).toBe(404);
    await other.close();
  });
});

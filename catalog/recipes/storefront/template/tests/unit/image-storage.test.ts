import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Product image storage (src/server/images.ts) against a local stand-in of the Vercel Blob API, reached through the
 * official SDK (@vercel/blob reads VERCEL_BLOB_API_URL). The stand-in answers like Blob's API does for put and delete,
 * requires the bearer token, and records each request so the test checks exactly what the SDK sent.
 */
const settings = vi.hoisted(() => ({ BLOB_READ_WRITE_TOKEN: undefined as string | undefined }));
vi.mock("@/env", () => ({ env: settings }));

const received: { method: string; url: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
let server: Server;
let base = "";
// Throwaway token generated per run in Blob's documented shape (vercel_blob_rw_<storeId>_<secret>).
const token = `vercel_blob_rw_teststore${randomBytes(4).toString("hex")}_${randomBytes(16).toString("hex")}`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      received.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(403, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "forbidden", message: "Access denied" } }));
      }
      const url = new URL(req.url ?? "/", base);
      if (req.method === "PUT" && url.pathname === "/") {
        const pathname = url.searchParams.get("pathname") ?? "";
        const blobUrl = `https://teststore.public.blob.vercel-storage.com/${pathname}`;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            url: blobUrl,
            downloadUrl: `${blobUrl}?download=1`,
            pathname,
            contentType: req.headers["x-content-type"],
            contentDisposition: `inline; filename="${pathname.split("/").pop()}"`,
            etag: '"e2e"',
          }),
        );
      }
      if (req.method === "POST" && url.pathname === "/delete") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: "not found" } }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv("VERCEL_BLOB_API_URL", base);
  vi.stubEnv("VERCEL_BLOB_RETRIES", "0");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((ok) => server.close(ok));
});

beforeEach(() => {
  received.length = 0;
  settings.BLOB_READ_WRITE_TOKEN = undefined;
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("product image storage", () => {
  it("without a Blob token keeps the image for the database (local fallback) and calls nothing", async () => {
    const { storeProductImage, deleteStoredImage } = await import("@/server/images");
    const stored = await storeProductImage(PNG, "image/png");
    expect(stored).toEqual({ image: PNG, imageMime: "image/png", imageBlobUrl: null });
    await deleteStoredImage("https://teststore.public.blob.vercel-storage.com/products/a.png");
    expect(received).toHaveLength(0);
  });

  it("with a Blob token uploads the bytes to Vercel Blob with the detected type and stores only the public URL", async () => {
    settings.BLOB_READ_WRITE_TOKEN = token;
    const { storeProductImage } = await import("@/server/images");
    const stored = await storeProductImage(PNG, "image/png");
    expect(stored.image).toBeNull();
    expect(stored.imageMime).toBe("image/png");
    expect(stored.imageBlobUrl).toMatch(
      /^https:\/\/teststore\.public\.blob\.vercel-storage\.com\/products\/[0-9a-f-]{36}\.png$/,
    );
    const put = received.find((r) => r.method === "PUT");
    expect(put, "one upload request").toBeDefined();
    expect(new URL(put?.url ?? "", base).searchParams.get("pathname")).toMatch(
      /^products\/[0-9a-f-]{36}\.png$/,
    );
    expect(put?.headers.authorization).toBe(`Bearer ${token}`);
    expect(put?.headers["x-content-type"]).toBe("image/png");
    expect(put?.headers["x-add-random-suffix"]).toBe("0");
    expect(put?.body.equals(PNG), "the exact image bytes are uploaded").toBe(true);
  });

  it("deletes a replaced image from Vercel Blob by its URL", async () => {
    settings.BLOB_READ_WRITE_TOKEN = token;
    const { deleteStoredImage } = await import("@/server/images");
    const url = "https://teststore.public.blob.vercel-storage.com/products/old.png";
    await deleteStoredImage(url);
    const del = received.find((r) => r.method === "POST");
    expect(new URL(del?.url ?? "", base).pathname).toBe("/delete");
    expect(JSON.parse(del?.body.toString() ?? "{}")).toEqual({ urls: [url] });
  });

  it("fails the upload (never stores a broken URL) when Blob refuses the token", async () => {
    settings.BLOB_READ_WRITE_TOKEN = `vercel_blob_rw_teststore_${randomBytes(8).toString("hex")}`;
    const { storeProductImage } = await import("@/server/images");
    await expect(storeProductImage(PNG, "image/png")).rejects.toThrow();
  });

  it("serves a Blob image by its URL, else an admin URL, else the local image route", async () => {
    const { productImageSrc } = await import("@/lib/shop");
    const blob = "https://teststore.public.blob.vercel-storage.com/products/a.png";
    expect(
      productImageSrc({ id: "1", imageUrl: null, imageMime: "image/png", imageBlobUrl: blob }),
    ).toBe(blob);
    expect(
      productImageSrc({
        id: "1",
        imageUrl: "https://x.test/a.jpg",
        imageMime: "image/png",
        imageBlobUrl: blob,
      }),
    ).toBe("https://x.test/a.jpg");
    expect(
      productImageSrc({ id: "1", imageUrl: null, imageMime: "image/png", imageBlobUrl: null }),
    ).toBe("/shop/images/1");
  });
});

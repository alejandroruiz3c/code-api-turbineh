import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { del, list, put } from "@vercel/blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A local stand-in of the Vercel Blob API (the SDK reads VERCEL_BLOB_API_URL): offline, records what the SDK sends.
const seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = [];
const token = `vercel_blob_rw_contract${randomBytes(3).toString("hex")}_${randomBytes(12).toString("hex")}`;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c: Buffer) => (body += c.toString()));
  req.on("end", () => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ error: { code: "forbidden", message: "Access denied" } }));
    }
    if (req.method === "PUT") {
      const pathname = url.searchParams.get("pathname") ?? "";
      const at = `https://contract.public.blob.vercel-storage.com/${pathname}`;
      return res.end(
        JSON.stringify({
          url: at,
          downloadUrl: `${at}?download=1`,
          pathname,
          contentType: req.headers["x-content-type"],
          contentDisposition: "inline",
          etag: '"1"',
        }),
      );
    }
    return res.end("{}");
  });
});

beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.VERCEL_BLOB_RETRIES = "0";
});
afterAll(async () => {
  delete process.env.VERCEL_BLOB_API_URL;
  await new Promise((ok) => server.close(ok));
});

describe("vercel blob contract", () => {
  it("exposes put, list and delete", () => {
    expect([put, del, list].every((f) => typeof f === "function")).toBe(true);
  });

  it("put uploads the bytes with the bearer token and content type and returns the public URL", async () => {
    const r = await put("uploads/a.txt", "hello", {
      access: "public",
      contentType: "text/plain",
      addRandomSuffix: false,
      token,
    });
    expect(r.url).toBe("https://contract.public.blob.vercel-storage.com/uploads/a.txt");
    const req = seen.find((s) => s.method === "PUT");
    expect(req?.headers.authorization).toBe(`Bearer ${token}`);
    expect(req?.headers["x-content-type"]).toBe("text/plain");
    expect(req?.body).toBe("hello");
  });

  it("del sends the URLs to delete", async () => {
    await del("https://contract.public.blob.vercel-storage.com/uploads/a.txt", { token });
    const req = seen.find((s) => s.method === "POST");
    expect(new URL(req?.url ?? "/", "http://x").pathname).toBe("/delete");
    expect(JSON.parse(req?.body ?? "{}")).toEqual({
      urls: ["https://contract.public.blob.vercel-storage.com/uploads/a.txt"],
    });
  });

  it("refuses a wrong token (the error surfaces, nothing is stored)", async () => {
    await expect(
      put("uploads/b.txt", "x", {
        access: "public",
        addRandomSuffix: false,
        token: `vercel_blob_rw_contract_${randomBytes(6).toString("hex")}`,
      }),
    ).rejects.toThrow();
  });
});

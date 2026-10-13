import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { UploadParams, uploadConfig, type UploadConfig } from "@/uploads/config";
import { uploadError } from "@/uploads/rules";
import { canonicalRequest, encodePath, signRequest } from "@/uploads/sigv4";
import { attachmentHeader, detect, safeFileName, sniffType } from "@/uploads/sniff";
import { driverFromEnv, isInside, localDriver } from "@/uploads/storage";

/** Contract of storage.private-uploads.turbineh: limits from params, type by content, private storage, SigV4. */
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const cfg: UploadConfig = {
  maxBytes: 10 * 1024 * 1024,
  types: ["pdf", "png", "jpg"],
  maxFilesPerRecord: 3,
  notifyOnUpload: false,
};

describe("upload limits from params", () => {
  it("the shipped params are valid", () => {
    expect(UploadParams.safeParse(uploadConfig).success).toBe(true);
  });

  it("accepts only the configured types, recognised by content whatever the file name", () => {
    expect(sniffType(PDF, cfg.types)).toBe("pdf");
    expect(sniffType(PNG, cfg.types)).toBe("png");
    expect(sniffType(JPG, cfg.types)).toBe("jpg");
    expect(sniffType(HTML, cfg.types)).toBeNull();
    expect(detect(HTML)).toEqual([]);
    expect(sniffType(new TextEncoder().encode("a,b\n1,2\n"), cfg.types)).toBeNull();
    expect(sniffType(new TextEncoder().encode("a,b\n1,2\n"), ["csv"])).toBe("csv");
  });

  it("refuses empty files, files over the size limit and records that already hold the maximum", () => {
    expect(uploadError({ size: 0 }, null, 0, cfg)).toBe("Choose a file.");
    expect(uploadError({ size: cfg.maxBytes + 1 }, null, 0, cfg)).toBe("Files can be up to 10 MB.");
    expect(uploadError({ size: 10 }, null, 3, cfg)).toMatch(/already has 3 files/);
    expect(uploadError({ size: HTML.length }, HTML, 0, cfg)).toBe(
      "Only PDF, PNG or JPG files are accepted.",
    );
    expect(uploadError({ size: PDF.length }, PDF, 0, cfg)).toBeNull();
  });

  it("never trusts the file name: no paths, no control characters, safe download header", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("..\\..\\boot.ini")).toBe("boot.ini");
    expect(safeFileName("in\u0000voice\n.pdf")).toBe("in_voice_.pdf");
    expect(attachmentHeader('a"b.pdf')).toMatch(/^attachment; filename="a_b.pdf"/);
  });
});

describe("private storage drivers", () => {
  it("stores files on local disk outside public/ and refuses keys that try to escape it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uploads-"));
    const d = localDriver(dir);
    const key = "org_1/0b6f7a52-6d7a-4bb1-9a3e-2f8c2a1c9d10";
    await d.put(key, PDF, "application/pdf");
    expect(Buffer.from((await d.get(key))!)).toEqual(Buffer.from(PDF));
    expect(readdirSync(join(dir, "org_1"))).toHaveLength(1);
    await expect(d.put("../escape/0b6f7a52-6d7a-4bb1-9a3e-2f8c2a1c9d10", PDF, "x")).rejects.toThrow(
      /invalid storage key/,
    );
    await d.delete(key);
    expect(await d.get(key)).toBeNull();
    expect(isInside(resolve(dir), resolve("public"))).toBe(false);
    expect(() => driverFromEnv({ UPLOADS_DIR: "public/uploads" })).toThrow(/outside public/);
    expect(driverFromEnv({}).kind).toBe("local");
  });

  it("uses the S3 driver when a bucket is configured, and refuses it without credentials", () => {
    expect(() => driverFromEnv({ S3_BUCKET: "private-files" })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(
      driverFromEnv({
        S3_BUCKET: "private-files",
        S3_ACCESS_KEY_ID: "id",
        S3_SECRET_ACCESS_KEY: "k".repeat(40),
      }).kind,
    ).toBe("s3");
  });

  it("signs S3 requests with SigV4 (canonical request, scope, signed headers)", () => {
    const now = new Date("2026-10-13T10:15:00Z");
    const url = new URL("http://127.0.0.1:9000/bucket/org_1/0b6f7a52-6d7a-4bb1-9a3e-2f8c2a1c9d10");
    const key = { accessKeyId: "id-1", secretAccessKey: "s".repeat(40), region: "eu-west-1" };
    const h = signRequest({
      method: "PUT",
      url,
      body: PDF,
      key,
      now,
      headers: { "content-type": "application/pdf" },
    });
    expect(h["x-amz-date"]).toBe("20261013T101500Z");
    expect(h.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=id-1\/20261013\/eu-west-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    // Deterministic, and any change to the body changes the signature.
    expect(
      signRequest({
        method: "PUT",
        url,
        body: PDF,
        key,
        now,
        headers: { "content-type": "application/pdf" },
      }).authorization,
    ).toBe(h.authorization);
    expect(
      signRequest({
        method: "PUT",
        url,
        body: PNG,
        key,
        now,
        headers: { "content-type": "application/pdf" },
      }).authorization,
    ).not.toBe(h.authorization);
    const c = canonicalRequest({
      method: "get",
      path: "/b/a b",
      headers: { Host: "x" },
      payloadHash: "UNSIGNED",
    });
    expect(c.text).toBe("GET\n/b/a%20b\n\nhost:x\n\nhost\nUNSIGNED");
    expect(encodePath("/b/it's(1)")).toBe("/b/it%27s%281%29");
  });
});

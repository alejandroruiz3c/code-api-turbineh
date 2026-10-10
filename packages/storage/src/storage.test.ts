import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorage } from "./index.js";

describe("LocalStorage", () => {
  it("stores and reads artefacts and rejects path traversal", async () => {
    const s = new LocalStorage(mkdtempSync(join(tmpdir(), "art-")));
    await s.put("b1/app.zip", Buffer.from("zip"), "application/zip");
    expect((await s.get("b1/app.zip")).toString()).toBe("zip");
    expect(await s.url("b1/app.zip")).toBe("/api/artifacts/b1/app.zip");
    await expect(s.put("../../etc/x", Buffer.from(""), "text/plain")).rejects.toThrow(/invalid/);
  });
});

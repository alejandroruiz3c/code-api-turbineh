import { describe, expect, it } from "vitest";
import { fileTypeFromBuffer } from "file-type";
describe("file-type contract", () => {
  it("detects PNG and PDF by magic bytes", async () => {
    const png = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    expect((await fileTypeFromBuffer(png))?.mime).toBe("image/png");
    expect((await fileTypeFromBuffer(new TextEncoder().encode("%PDF-1.7\n")))?.ext).toBe("pdf");
  });
});

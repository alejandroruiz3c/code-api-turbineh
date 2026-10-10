import { describe, expect, it } from "vitest";
import busboy from "busboy";
describe("busboy contract", () => {
  it("parses a multipart field", async () => {
    const boundary = "X";
    const body = `--X\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--X--\r\n`;
    const bb = busboy({ headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    const fields: Record<string, string> = {};
    await new Promise<void>((resolve) => {
      bb.on("field", (n: string, v: string) => (fields[n] = v));
      bb.on("close", () => resolve());
      bb.end(body);
    });
    expect(fields).toEqual({ a: "1" });
  });
});

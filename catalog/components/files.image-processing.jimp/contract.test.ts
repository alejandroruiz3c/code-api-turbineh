import { describe, expect, it } from "vitest";
import { Jimp } from "jimp";
describe("jimp contract", () => {
  it("creates, resizes and encodes an image", async () => {
    const img = new Jimp({ width: 400, height: 200, color: 0xff0000ff });
    img.resize({ w: 100 });
    expect(img.bitmap.width).toBe(100);
    expect(img.bitmap.height).toBe(50);
    const png = await img.getBuffer("image/png");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});

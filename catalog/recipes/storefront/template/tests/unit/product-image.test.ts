import { describe, expect, it } from "vitest";
import { parseImageUrl, productImageSrc, searchPattern } from "@/lib/shop";

describe("product image URL", () => {
  it("accepts https URLs (trimmed) and empty values", () => {
    expect(parseImageUrl(" https://cdn.example.com/beans.jpg ")).toBe(
      "https://cdn.example.com/beans.jpg",
    );
    expect(parseImageUrl("")).toBeNull();
  });

  it("rejects other schemes, credentials, junk and overlong URLs", () => {
    for (const bad of [
      "http://example.com/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://user:pw@example.com/a.png",
      "not a url",
      `https://example.com/${"a".repeat(2100)}`,
    ]) {
      expect(parseImageUrl(bad)).toBeUndefined();
    }
  });

  it("prefers the URL, then the uploaded image", () => {
    expect(
      productImageSrc({ id: "1", imageUrl: "https://x.test/a.jpg", imageMime: "image/png" }),
    ).toBe("https://x.test/a.jpg");
    expect(productImageSrc({ id: "1", imageUrl: null, imageMime: "image/png" })).toBe(
      "/shop/images/1",
    );
    expect(productImageSrc({ id: "1", imageUrl: null, imageMime: null })).toBeNull();
  });
});

describe("search pattern", () => {
  it("escapes LIKE wildcards", () => {
    expect(searchPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});

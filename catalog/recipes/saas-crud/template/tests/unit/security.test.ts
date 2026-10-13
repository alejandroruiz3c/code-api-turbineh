import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/security/headers";
import { rateLimit } from "@/security/rate-limit";

describe("security headers", () => {
  const headers = Object.fromEntries(securityHeaders().map((h) => [h.key, h.value]));
  it("denies framing and sniffing", () => {
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });
  it("sets a restrictive CSP", () => {
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
  });
  it("allows remote images only over https, and only when the app opts in", () => {
    const img = (headers["Content-Security-Policy"] ?? "")
      .split("; ")
      .find((d) => d.startsWith("img-src"));
    expect(img).toMatch(/^img-src 'self' data: blob:( https:)?$/);
  });
});

describe("rate limit", () => {
  it("blocks after the limit within the window", () => {
    const key = `t-${Math.random()}`;
    expect(rateLimit(key, 2, 1000, 0)).toBe(true);
    expect(rateLimit(key, 2, 1000, 1)).toBe(true);
    expect(rateLimit(key, 2, 1000, 2)).toBe(false);
    expect(rateLimit(key, 2, 1000, 2000)).toBe(true);
  });
});

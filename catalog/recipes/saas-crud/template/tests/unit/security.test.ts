import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/security/headers";
import { memoryStore, rateLimit } from "@/security/rate-limit";

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
  it("blocks after the limit within the window", async () => {
    const store = memoryStore();
    const key = "t-window";
    expect(await rateLimit(key, 2, 1000, { store, now: 0 })).toBe(true);
    expect(await rateLimit(key, 2, 1000, { store, now: 1 })).toBe(true);
    expect(await rateLimit(key, 2, 1000, { store, now: 2 })).toBe(false);
    expect(await rateLimit(key, 2, 1000, { store, now: 2000 })).toBe(true);
  });

  it("is shared by every instance in production: counters live in the database, not in process memory", () => {
    const src = readFileSync("src/security/rate-limit.ts", "utf8");
    expect(src).toMatch(/process\.env\.NODE_ENV === "test"/);
    expect(src).toMatch(/insert\(rateLimits\)[\s\S]*onConflictDoUpdate/);
  });

  it("every call is awaited (an un-awaited limiter is a Promise, always truthy, and never blocks)", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => join("src", f));
    const unawaited = files.flatMap((f) => {
      const src = readFileSync(f, "utf8");
      return [...src.matchAll(/\brateLimit\(/g)]
        .filter((m) => {
          const before = src.slice(Math.max(0, (m.index ?? 0) - 16), m.index);
          return !/await\s*\(?\s*$/.test(before) && !/function\s+$/.test(before);
        })
        .map(() => f);
    });
    expect(unawaited).toEqual([]);
  });
});

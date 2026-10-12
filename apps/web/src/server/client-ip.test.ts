import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://u:p@localhost/db";
  process.env.BETTER_AUTH_SECRET = "s".repeat(40);
  process.env.BETTER_AUTH_URL = "https://example.test";
  process.env.GITHUB_CLIENT_ID = "x";
  process.env.GITHUB_CLIENT_SECRET = "x";
  process.env.DELIVERY_TOKEN_KEY = "k".repeat(44);
  process.env.PRODUCT_ACCESS_TOKEN = "TEST_ACCESS_TOKEN_123";
});

describe("client IP hash (per-IP quota)", () => {
  it("prefers Vercel's header, never returns the IP and is stable per IP", async () => {
    const { clientIpHash } = await import("./client-ip");
    const h = (o: Record<string, string>) => new Headers(o);
    const a = clientIpHash(
      h({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }),
    );
    expect(a).toBe(clientIpHash(h({ "x-real-ip": "203.0.113.7" })));
    expect(a).not.toContain("203.0.113.7");
    expect(clientIpHash(h({ "x-real-ip": "203.0.113.8" }))).not.toBe(a);
    expect(clientIpHash(h({}))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { checkPost, compositionProblems, RULES, weightedLength } from "@/social/limits";
import { fetchPublicImage, isPrivateAddress } from "@/social/media";
import { toLittleText } from "@/social/publishers";
import { afterFailure, backoffMs } from "@/social/retry";

/**
 * Social publishing rules (social.publish.turbineh) without network or database: per-network format and length,
 * LinkedIn's text format, retry backoff, and the image download guard.
 */
describe("format and length per network", () => {
  it("each network's length limit is enforced: X counts 280 weighted characters (links 23, emoji and CJK 2), LinkedIn 3,000, Instagram 2,200", () => {
    expect(weightedLength("hello")).toBe(5);
    expect(weightedLength("see https://example.com/a/very/long/path/that/is/longer/than/23")).toBe(
      4 + 23,
    );
    expect(weightedLength("😀")).toBe(2);
    expect(weightedLength("👩‍👩‍👧‍👦")).toBe(2); // one ZWJ emoji
    expect(weightedLength("日本")).toBe(4);
    expect(weightedLength("é".normalize("NFD"))).toBe(1); // NFC first
    expect(checkPost("x", { text: "a".repeat(280) })).toEqual([]);
    expect(checkPost("x", { text: "a".repeat(281) })[0]?.message).toMatch(/X: 281\/280/);
    expect(checkPost("x", { text: "日".repeat(141) })[0]?.message).toMatch(/282\/280/);
    expect(checkPost("linkedin", { text: "a".repeat(3000) })).toEqual([]);
    expect(checkPost("linkedin", { text: "a".repeat(3001) })).toHaveLength(1);
    expect(
      checkPost("instagram", {
        text: "a".repeat(2201),
        imageUrl: "https://cdn.example.com/a.jpg",
      })[0]?.message,
    ).toMatch(/2201\/2200/);
    expect(RULES.facebook.maxLength).toBe(63206);
  });

  it("Instagram needs an image, at most 30 hashtags and 20 mentions; images must be public https URLs", () => {
    expect(checkPost("instagram", { text: "hi" })[0]?.message).toMatch(/image is required/);
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(
      checkPost("instagram", { text: tags, imageUrl: "https://cdn.example.com/a.jpg" })[0]?.message,
    ).toMatch(/30 hashtags/);
    const ats = Array.from({ length: 21 }, (_, i) => `@u${i}`).join(" ");
    expect(
      checkPost("instagram", { text: ats, imageUrl: "https://cdn.example.com/a.jpg" })[0]?.message,
    ).toMatch(/20 @mentions/);
    expect(
      checkPost("facebook", { text: "hi", imageUrl: "http://cdn.example.com/a.jpg" })[0]?.message,
    ).toMatch(/https/);
  });

  it("a post adapted per network: the network's own version is checked instead of the common text, nothing is cut silently", () => {
    const long = "a".repeat(400);
    expect(
      compositionProblems({ text: long, versions: {}, imageUrl: null }, ["linkedin", "x"]).map(
        (p) => p.network,
      ),
    ).toEqual(["x"]);
    expect(
      compositionProblems({ text: long, versions: { x: "short for X" }, imageUrl: null }, [
        "linkedin",
        "x",
      ]),
    ).toEqual([]);
  });

  it("LinkedIn commentary uses the little text format: reserved characters escaped, hashtags as hashtag templates", () => {
    expect(toLittleText("Hello (world) @you *bold* #News_2026!")).toBe(
      "Hello \\(world\\) \\@you \\*bold\\* {hashtag|\\#|News\\_2026}!",
    );
    expect(toLittleText("#Start of text")).toBe("{hashtag|\\#|Start} of text");
    expect(toLittleText("issue #")).toBe("issue \\#");
  });
});

describe("retries with backoff", () => {
  it("failed publications are retried with exponential backoff and jitter, honouring the provider's Retry-After, up to the attempt limit", () => {
    const mid = () => 0.5;
    expect(backoffMs(1, { random: mid })).toBe(45_000);
    expect(backoffMs(2, { random: mid })).toBe(90_000);
    expect(backoffMs(3, { random: mid })).toBe(180_000);
    expect(backoffMs(20, { random: mid })).toBe(2_700_000); // capped at 1 h ceiling
    expect(backoffMs(1, { random: () => 0 })).toBe(30_000);
    expect(backoffMs(1, { random: () => 0.999999 })).toBeLessThanOrEqual(60_000);
    expect(backoffMs(1, { random: mid, retryAfterMs: 900_000 })).toBe(900_000);
    const now = new Date("2026-10-16T10:00:00Z");
    expect(afterFailure({ attempt: 1, maxAttempts: 5, retryable: true, now, random: mid })).toEqual(
      {
        kind: "retry",
        at: new Date("2026-10-16T10:00:45Z"),
      },
    );
    expect(afterFailure({ attempt: 5, maxAttempts: 5, retryable: true, now })).toEqual({
      kind: "failed",
    });
    expect(afterFailure({ attempt: 1, maxAttempts: 5, retryable: false, now })).toEqual({
      kind: "failed",
    });
  });
});

describe("image download guard", () => {
  it("images for LinkedIn and X are downloaded only from public https addresses (no private, loopback or link-local hosts)", async () => {
    for (const a of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.3.4",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "0.0.0.0",
    ])
      expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["93.184.216.34", "2606:2800:220:1::1", "8.8.8.8"])
      expect(isPrivateAddress(a), a).toBe(false);
    await expect(fetchPublicImage("http://example.com/a.jpg")).rejects.toThrow(/https/);
    await expect(fetchPublicImage("https://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /private/,
    );
    await expect(fetchPublicImage("https://localhost/a.jpg")).rejects.toThrow();
  });
});

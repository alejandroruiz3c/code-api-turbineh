import { describe, expect, it } from "vitest";
import { cookieSecret, safeEqual, signAccessCookie, verifyAccessCookie } from "./access-token";

describe("invitation access (ADR-0030)", () => {
  const secret = cookieSecret("FRONTIERS_TEST_TOKEN", "auth-secret");

  it("signs a workspace cookie that only this secret verifies", async () => {
    const cookie = await signAccessCookie("3f1c2a4e-0000-4000-8000-1234567890ab", secret);
    expect(cookie).not.toContain("FRONTIERS_TEST_TOKEN");
    expect(await verifyAccessCookie(cookie, secret)).toBe("3f1c2a4e-0000-4000-8000-1234567890ab");
    expect(
      await verifyAccessCookie(cookie, cookieSecret("ROTATED_TOKEN_123", "auth-secret")),
    ).toBeNull();
  });

  it("rejects tampered or malformed cookies", async () => {
    const cookie = await signAccessCookie("workspace-aaaa", secret);
    expect(
      await verifyAccessCookie(cookie.replace("workspace-aaaa", "workspace-bbbb"), secret),
    ).toBeNull();
    expect(await verifyAccessCookie("no-dot", secret)).toBeNull();
    expect(await verifyAccessCookie(undefined, secret)).toBeNull();
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
  });
});

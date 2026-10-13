import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({ env: { ADMIN_EMAILS: " Owner@Example.com , staff@example.com" } }));

describe("staff allowlist", () => {
  it("matches emails case-insensitively and denies by default", async () => {
    const { isStaffEmail, maySignUp, staffEmails } = await import("@/lib/staff");
    expect(staffEmails()).toEqual(["owner@example.com", "staff@example.com"]);
    expect(isStaffEmail("OWNER@example.com")).toBe(true);
    expect(isStaffEmail("visitor@example.com")).toBe(false);
    expect(isStaffEmail("owner@example.com", "")).toBe(false);
    expect(maySignUp("visitor@example.com", "open")).toBe(true);
    expect(maySignUp("visitor@example.com", "staff")).toBe(false);
    expect(maySignUp("staff@example.com", "staff")).toBe(true);
    expect(maySignUp("staff@example.com", "staff", "")).toBe(false);
  });

  it("grants staff access only to a verified allowlisted address", async () => {
    const { isStaff } = await import("@/lib/staff");
    expect(isStaff({ email: "owner@example.com", emailVerified: false })).toBe(false);
    expect(isStaff({ email: "owner@example.com", emailVerified: null })).toBe(false);
    expect(isStaff({ email: "owner@example.com" })).toBe(false);
    expect(isStaff({ email: "owner@example.com", emailVerified: true })).toBe(true);
    expect(isStaff({ email: "visitor@example.com", emailVerified: true })).toBe(false);
  });
});

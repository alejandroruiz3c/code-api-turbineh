import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/env", () => ({ env: { ADMIN_EMAILS: "" } }));

describe("role policy", () => {
  it("lets members read and create but not update or delete", async () => {
    const { can } = await import("@/server/authz");
    expect(can("member", "read")).toBe(true);
    expect(can("member", "create")).toBe(true);
    expect(can("member", "update")).toBe(false);
    expect(can("member", "delete")).toBe(false);
    expect(can("admin", "delete")).toBe(true);
  });

  it("staff allow-list denies by default and matches whole emails only", async () => {
    const { isAdminEmail } = await import("@/server/authz");
    expect(isAdminEmail("ana@example.com", "")).toBe(false);
    expect(isAdminEmail("Ana@Example.com", "bob@example.com, ana@example.com")).toBe(true);
    expect(isAdminEmail("eve@example.com.evil.io", "eve@example.com")).toBe(false);
    expect(isAdminEmail("", ",")).toBe(false);
  });
});

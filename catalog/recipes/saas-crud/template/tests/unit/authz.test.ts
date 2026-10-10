import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

describe("role policy", () => {
  it("lets members read and create but not update or delete", async () => {
    const { can } = await import("@/server/authz");
    expect(can("member", "read")).toBe(true);
    expect(can("member", "create")).toBe(true);
    expect(can("member", "update")).toBe(false);
    expect(can("member", "delete")).toBe(false);
    expect(can("admin", "delete")).toBe(true);
  });
});

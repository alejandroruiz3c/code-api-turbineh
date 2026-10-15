import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Workspace access, deny by default (ADR-0054). Fixed invariants of every app, whatever roles the request names (a
 * component replacing the role policy keeps them): they never read the role matrix they protect.
 */
const state = vi.hoisted(() => ({
  member: null as null | "throws" | { role: unknown; organizationId: string },
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "u1", email: "ana@example.com" },
        session: { activeOrganizationId: "org1" },
      }),
      getActiveMember: async () => {
        if (state.member === "throws") throw new Error("database unavailable");
        if (state.member === null)
          throw Object.assign(new Error("not a member"), { statusCode: 400 });
        return state.member;
      },
    },
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/env", () => ({ env: { ADMIN_EMAILS: "" } }));

beforeEach(() => {
  state.member = null;
});

describe("workspace access", () => {
  it("denies a missing or unknown stored role instead of treating it as a member (deny by default)", async () => {
    const { toRole } = await import("@/server/role-policy");
    expect(toRole("owner")).toBe("owner");
    expect(toRole("superuser")).toBeNull();
    expect(toRole(undefined)).toBeNull();
    expect(toRole(null)).toBeNull();
    expect(toRole(42)).toBeNull();
  });

  it("refuses a signed-in user whose membership cannot be verified, or who is not a member", async () => {
    const { requireMember } = await import("@/server/authz");
    state.member = "throws";
    await expect(requireMember()).rejects.toThrow("Could not verify workspace membership");
    state.member = null;
    await expect(requireMember()).rejects.toThrow("redirect:/sign-up?step=organization");
    state.member = { role: "superuser", organizationId: "org1" };
    await expect(requireMember()).rejects.toThrow(/role in this workspace is not recognised/);
    state.member = { role: "owner", organizationId: "org1" };
    await expect(requireMember()).resolves.toMatchObject({ role: "owner", organizationId: "org1" });
  });

  it("unknown roles can do nothing; the workspace owner can always manage members", async () => {
    const { can } = await import("@/server/authz");
    for (const action of [
      "read",
      "create",
      "update",
      "delete",
      "approve",
      "export",
      "configure",
      "manage_members",
      "view_audit",
    ] as const) {
      expect(can("superuser", action), `superuser ${action}`).toBe(false);
      expect(can("", action), `empty role ${action}`).toBe(false);
    }
    expect(can("owner", "manage_members")).toBe(true);
  });
});

describe("clientIp (trusted proxies only)", () => {
  it("never trusts X-Forwarded-For without a trusted proxy: a client cannot pick its own rate-limit bucket", async () => {
    const { clientIp } = await import("@/server/authz");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }), 0)).toBe("unknown");
  });

  it("takes the entry the nearest trusted proxy appended, ignoring what the client prepended", async () => {
    const { clientIp, trustedProxyHops } = await import("@/server/authz");
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7, 10.0.0.2" });
    expect(clientIp(h, 1)).toBe("10.0.0.2");
    expect(clientIp(h, 2)).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" }), 1)).toBe("unknown");
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ VERCEL: "1" })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "2" })).toBe(2);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "99" })).toBe(0);
  });
});

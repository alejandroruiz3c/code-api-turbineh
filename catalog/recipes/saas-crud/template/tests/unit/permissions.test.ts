import { describe, expect, it, vi } from "vitest";
import { can } from "@/server/authz";
import { ROLE_MATRIX } from "@/server/permissions";

vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/env", () => ({ env: { ADMIN_EMAILS: "" } }));

/**
 * The base role policy as fixed expectations (ADR-0054): written out here, never read from ROLE_MATRIX, so a change to
 * the policy cannot make its own test pass. TurbineH replaces this file with the request's roles when it states them.
 */
const EXPECTED: Record<string, Record<string, boolean>> = {
  owner: {
    read: true,
    create: true,
    update: true,
    delete: true,
    approve: true,
    export: true,
    configure: true,
    manage_members: true,
    view_audit: true,
  },
  admin: {
    read: true,
    create: true,
    update: true,
    delete: true,
    approve: true,
    export: true,
    configure: true,
    manage_members: true,
    view_audit: true,
  },
  member: {
    read: true,
    create: true,
    update: false,
    delete: false,
    approve: false,
    export: false,
    configure: false,
    manage_members: false,
    view_audit: false,
  },
};

describe("base role policy (fixed expectations)", () => {
  it("each workspace role can do exactly what is written here, nothing else", () => {
    for (const [role, rights] of Object.entries(EXPECTED))
      for (const [action, allowed] of Object.entries(rights))
        expect(can(role, action as Parameters<typeof can>[1]), `${role} ${action}`).toBe(allowed);
  });

  it("a member cannot approve, export, change settings, manage members or read the audit log", () => {
    for (const action of [
      "approve",
      "export",
      "configure",
      "manage_members",
      "view_audit",
    ] as const)
      expect(can("member", action), `member ${action}`).toBe(false);
  });

  it("a member is labelled Member, never with an admin-like role", () => {
    expect(ROLE_MATRIX.member?.label).toBe("Member");
  });
});

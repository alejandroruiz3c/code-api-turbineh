import { describe, expect, it, vi } from "vitest";
import { canWith } from "@/server/role-policy";
import { MembershipParams } from "@/membership/config";
import params from "@/membership/params.json";

vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/env", () => ({ env: { ADMIN_EMAILS: "" } }));

const cfg = MembershipParams.parse(params);

/** Role policy from the request's roles (domain.membership-access.turbineh replaces the base owner/admin/member). */
describe("role policy", () => {
  it("applies the request's roles: each role can do exactly what its params list, nothing else", async () => {
    const { can } = await import("@/server/authz");
    for (const role of cfg.roles)
      for (const action of [
        "read",
        "create",
        "update",
        "delete",
        "manage_members",
        "view_audit",
      ] as const)
        expect(can(role.key, action), `${role.key} ${action}`).toBe(role.can.includes(action));
  });

  it("maps owner/editor/viewer: viewers read but cannot edit, only owners manage members and read the audit log", () => {
    const fieldnote = MembershipParams.parse({
      roles: [
        {
          key: "owner",
          label: "Owner",
          can: [
            "read",
            "create",
            "update",
            "delete",
            "manage_members",
            "view_audit",
            "see_all_scopes",
          ],
        },
        {
          key: "editor",
          label: "Editor",
          can: ["read", "create", "update", "delete", "see_all_scopes"],
        },
        { key: "viewer", label: "Viewer", can: ["read", "see_all_scopes"] },
      ],
      defaultRole: "viewer",
      inviteRoles: ["editor", "viewer"],
      invitationDays: 7,
      scope: null,
    });
    expect(canWith(fieldnote, "viewer", "read")).toBe(true);
    expect(canWith(fieldnote, "viewer", "update")).toBe(false);
    expect(canWith(fieldnote, "viewer", "create")).toBe(false);
    expect(canWith(fieldnote, "editor", "update")).toBe(true);
    expect(canWith(fieldnote, "editor", "manage_members")).toBe(false);
    expect(canWith(fieldnote, "owner", "view_audit")).toBe(true);
    expect(canWith(fieldnote, "intruder", "read")).toBe(false);
  });

  it("denies a missing or unknown stored role instead of giving it another role (deny by default)", async () => {
    const { toRole, can } = await import("@/server/role-policy");
    expect(toRole("superuser")).toBeNull();
    expect(toRole(undefined)).toBeNull();
    expect(toRole("owner")).toBe("owner");
    expect(can("superuser", "read")).toBe(false);
    // Approving, exporting and changing settings are never implied by the params' read/update rights.
    for (const role of cfg.roles.filter((r) => r.key !== "owner"))
      for (const action of ["approve", "export", "configure"] as const)
        expect(can(role.key, action), `${role.key} ${action}`).toBe(false);
  });

  it("staff allow-list denies by default and matches whole emails only", async () => {
    const { isAdminEmail } = await import("@/server/authz");
    expect(isAdminEmail("ana@example.com", "")).toBe(false);
    expect(isAdminEmail("Ana@Example.com", "bob@example.com, ana@example.com")).toBe(true);
    expect(isAdminEmail("eve@example.com.evil.io", "eve@example.com")).toBe(false);
  });
});

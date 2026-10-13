import { describe, expect, it } from "vitest";
import { MembershipParams } from "@/membership/config";
import params from "@/membership/params.json";
import {
  checkInvitation,
  grantableRoles,
  hashToken,
  needsScope,
  newInvitationToken,
  roleChangeError,
} from "@/membership/rules";

const cfg = MembershipParams.parse({
  roles: [
    {
      key: "owner",
      label: "Owner",
      can: ["read", "create", "update", "delete", "manage_members", "view_audit", "see_all_scopes"],
    },
    {
      key: "staff",
      label: "Staff",
      can: ["read", "create", "update", "delete", "manage_members", "see_all_scopes"],
    },
    { key: "client", label: "Client", can: ["read", "create"] },
  ],
  defaultRole: "client",
  inviteRoles: ["staff", "client"],
  invitationDays: 7,
  scope: { kind: "company", label: "Company", plural: "Companies" },
});

describe("membership rules (domain.membership-access.turbineh)", () => {
  it("ships valid parameters (roles, default role, invitable roles, scope)", () => {
    expect(MembershipParams.safeParse(params).success).toBe(true);
    expect(MembershipParams.safeParse({ ...params, defaultRole: "ghost" }).success).toBe(false);
    expect(
      MembershipParams.safeParse({
        ...params,
        roles: params.roles.filter((r) => r.key !== "owner"),
      }).success,
    ).toBe(false);
  });

  it("stores only a hash of the invitation token", () => {
    const { token, tokenHash } = newInvitationToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it("accepts an invitation once, before it expires, only with the invited email", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    const inv = {
      status: "pending",
      expiresAt: new Date("2026-10-20T10:00:00Z"),
      email: "Ana@Example.com",
    };
    expect(checkInvitation(inv, "ana@example.com", now)).toEqual({ ok: true });
    expect(checkInvitation(inv, "eve@example.com", now)).toEqual({
      ok: false,
      reason: "wrong-email",
    });
    expect(checkInvitation({ ...inv, status: "accepted" }, "ana@example.com", now)).toEqual({
      ok: false,
      reason: "used",
    });
    expect(checkInvitation(inv, "ana@example.com", new Date("2026-10-21T00:00:00Z"))).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(checkInvitation(null, "ana@example.com", now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("lets only managers invite, only with invitable roles, and owners only by owners", () => {
    expect(grantableRoles(cfg, "owner")).toEqual(["staff", "client", "owner"]);
    expect(grantableRoles(cfg, "staff")).toEqual(["staff", "client"]);
    expect(grantableRoles(cfg, "client")).toEqual([]);
  });

  it("never removes the last owner and never lets you change your own role", () => {
    const base = { cfg, actorRole: "owner", actorUserId: "u1", targetUserId: "u2", owners: 1 };
    expect(roleChangeError({ ...base, targetRole: "owner", newRole: "client" })).toMatch(
      /at least one owner/,
    );
    expect(roleChangeError({ ...base, targetRole: "owner", newRole: null })).toMatch(
      /at least one owner/,
    );
    expect(
      roleChangeError({ ...base, targetUserId: "u1", targetRole: "owner", newRole: "client" }),
    ).toMatch(/your own/);
    expect(
      roleChangeError({
        ...base,
        actorRole: "staff",
        targetRole: "owner",
        newRole: "client",
        owners: 2,
      }),
    ).toMatch(/Only an owner/);
    expect(roleChangeError({ ...base, targetRole: "client", newRole: "staff" })).toBeNull();
  });

  it("invites people who see only their own company with that company (per-record scope)", () => {
    expect(needsScope(cfg, "client")).toBe(true);
    expect(needsScope(cfg, "staff")).toBe(false);
  });
});

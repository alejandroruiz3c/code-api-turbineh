import { describe, expect, it } from "vitest";
import {
  excludedSensitiveFields,
  sensitiveField,
  stateField,
  tenantField,
} from "./field-policy.js";
import { canDo, extractPermissions, mapToOrgRoles, PRIVILEGED_ACTIONS } from "./permissions.js";

describe("sensitive-field classifier (ADR-0054)", () => {
  it("flags secrets and credentials in any naming style", () => {
    for (const name of [
      "accessToken",
      "refresh_token",
      "token",
      "apiKey",
      "api_key",
      "API key",
      "clientSecret",
      "webhookSecret",
      "password",
      "passwordHash",
      "credentials",
      "privateKey",
      "private_key",
      "stripeSecretKey",
      "oauthToken",
      "cardNumber",
      "cvv",
    ])
      expect(sensitiveField(name), name).not.toBeNull();
  });

  it("does not flag ordinary fields, counters about tokens or keys of other kinds", () => {
    for (const name of [
      "title",
      "tokensUsed",
      "tokenCount",
      "maxTokens",
      "keyResult",
      "primaryKey",
      "secretary",
      "description",
      "email",
    ])
      expect(sensitiveField(name), name).toBeNull();
  });

  it("reports every excluded field with a stable id", () => {
    const out = excludedSensitiveFields([
      { name: "Integration", fields: [{ name: "name" }, { name: "accessToken" }] },
    ]);
    expect(out).toEqual([
      expect.objectContaining({
        id: "SEC-INTEGRATION-ACCESS-TOKEN",
        entity: "Integration",
        field: "accessToken",
        reason: "token",
      }),
    ]);
    expect(out[0]?.note).toMatch(/encryption at rest with a write-only input: not covered/);
  });
});

describe("state and tenant fields (ADR-0054)", () => {
  it("treats status, stage and lifecycle stamps as state set by the server, not address parts", () => {
    for (const name of [
      "status",
      "approvalStatus",
      "stage",
      "publishedAt",
      "approvedBy",
      "isPaid",
      "workflowState",
    ])
      expect(stateField(name), name).not.toBeNull();
    for (const name of ["state", "billingState", "title", "dueDate", "paidAmount", "approver"])
      expect(stateField(name), name).toBeNull();
  });

  it("knows tenant ids the server owns", () => {
    for (const name of ["workspaceId", "workspace_id", "tenantId", "orgId", "organizationId"])
      expect(tenantField(name), name).toBe(true);
    expect(tenantField("projectId")).toBe(false);
  });
});

describe("roles: members never inherit an admin-like role (ADR-0054)", () => {
  it("maps a single high-ranked role to owner and admin, never to member", () => {
    expect(mapToOrgRoles([{ id: "admin", rank: 5 }])).toEqual({ admin: ["owner", "admin"] });
    expect(mapToOrgRoles([{ id: "viewer", rank: 1 }])).toEqual({ viewer: ["member"] });
  });

  it("a request naming only admins gives invited members the least privilege, labelled Member", () => {
    const m = extractPermissions("Admins manage the inventory and export reports.");
    expect(m.byOrgRole.member.label).toBe("Member");
    expect(m.byOrgRole.admin.label).toBe("Admin");
    for (const a of PRIVILEGED_ACTIONS) expect(canDo(m, "member", a), a).toBe(false);
    expect(canDo(m, "member", "update")).toBe(false);
    expect(canDo(m, "member", "read")).toBe(true);
    expect(canDo(m, "owner", "approve")).toBe(true);
  });

  it("the template default denies approve, export, settings, members and audit to members", () => {
    const m = extractPermissions("A simple notes app.");
    for (const a of PRIVILEGED_ACTIONS) expect(canDo(m, "member", a), a).toBe(false);
    expect(canDo(m, "member", "create")).toBe(true);
  });

  it("a privilege reaches members only when the request grants it to them in so many words", () => {
    const m = extractPermissions("Roles: manager and member. Members approve requests.");
    expect(canDo(m, "member", "approve")).toBe(true);
    expect(canDo(m, "member", "configure")).toBe(false);
  });
});

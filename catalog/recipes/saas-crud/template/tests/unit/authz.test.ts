import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const state = vi.hoisted(() => ({
  ip: "203.0.113.7",
  session: null as null | { user: Record<string, unknown> },
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `${state.ip}, 10.0.0.1` }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/env", () => ({ env: { ADMIN_EMAILS: "" } }));

beforeEach(() => {
  state.session = null;
});

describe("role policy", () => {
  it("checks every workspace role against the role matrix: each role can do exactly what it lists, nothing else", async () => {
    const { can } = await import("@/server/authz");
    const { ROLE_MATRIX } = await import("@/server/permissions");
    const actions = [
      "read",
      "create",
      "update",
      "delete",
      "approve",
      "export",
      "configure",
      "manage_members",
      "view_audit",
    ] as const;
    for (const [role, rights] of Object.entries(ROLE_MATRIX))
      for (const action of actions)
        expect(can(role, action), `${role} ${action}`).toBe(rights.can.includes(action));
    // The workspace owner can always manage the workspace; unknown roles can do nothing.
    expect(can("owner", "manage_members")).toBe(true);
    expect(can("superuser", "read")).toBe(false);
  });

  it("gives an unknown stored role the least privilege (deny by default)", async () => {
    const { toRole, can, DEFAULT_ROLE } = await import("@/server/role-policy");
    const { ROLE_MATRIX } = await import("@/server/permissions");
    expect(toRole("owner")).toBe("owner");
    expect(toRole("superuser")).toBe(DEFAULT_ROLE);
    expect(toRole(undefined)).toBe(DEFAULT_ROLE);
    expect(can(toRole("superuser"), "delete")).toBe(
      ROLE_MATRIX[DEFAULT_ROLE]?.can.includes("delete") ?? false,
    );
  });

  it("staff allow-list denies by default and matches whole emails only", async () => {
    const { isAdminEmail } = await import("@/server/authz");
    expect(isAdminEmail("ana@example.com", "")).toBe(false);
    expect(isAdminEmail("Ana@Example.com", "bob@example.com, ana@example.com")).toBe(true);
    expect(isAdminEmail("eve@example.com.evil.io", "eve@example.com")).toBe(false);
    expect(isAdminEmail("", ",")).toBe(false);
  });
});

describe("requireSession (signed in, not necessarily a member)", () => {
  it("sends anonymous callers to sign-in", async () => {
    const { requireSession } = await import("@/server/authz");
    await expect(requireSession()).rejects.toThrow("redirect:/sign-in");
  });

  it("returns the signed-in user with a lower-case email", async () => {
    state.session = {
      user: { id: "u1", email: "Ana@Example.com", name: "Ana", emailVerified: true },
    };
    const { requireSession } = await import("@/server/authz");
    await expect(requireSession()).resolves.toEqual({
      userId: "u1",
      email: "ana@example.com",
      name: "Ana",
      emailVerified: true,
    });
  });
});

describe("publicAction (anonymous visitors)", () => {
  const schema = z.object({ email: z.email(), name: z.string().trim().min(1) });

  it("validates FormData with the schema and passes the parsed input and client IP", async () => {
    const { publicAction } = await import("@/server/authz");
    const handler = vi.fn(async (input: z.output<typeof schema>) => `hi ${input.name}`);
    const action = publicAction("t-valid", { rateLimit: { limit: 5 }, schema }, handler);
    const form = new FormData();
    form.set("email", "ana@example.com");
    form.set("name", " Ana ");
    form.set("extra", "dropped");
    // useActionState passes (previousState, formData): the FormData is the last argument.
    await expect(action(null, form)).resolves.toBe("hi Ana");
    expect(handler).toHaveBeenCalledWith(
      { email: "ana@example.com", name: "Ana" },
      { ip: "203.0.113.7" },
    );
  });

  it("refuses invalid input before the handler runs", async () => {
    const { publicAction } = await import("@/server/authz");
    const handler = vi.fn(async () => "ran");
    const action = publicAction(
      "t-invalid",
      {
        rateLimit: { limit: 5 },
        schema,
        refuse: (reason, issues) => `${reason}:${issues.length > 0}`,
      },
      handler,
    );
    await expect(action({ email: "not-an-email", name: "" })).resolves.toBe("invalid:true");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rate-limits per client IP and throws a user-facing error by default", async () => {
    const { publicAction } = await import("@/server/authz");
    const action = publicAction("t-limit", { rateLimit: { limit: 2 }, schema }, async () => "ok");
    const input = { email: "ana@example.com", name: "Ana" };
    await expect(action(input)).resolves.toBe("ok");
    await expect(action(input)).resolves.toBe("ok");
    await expect(action(input)).rejects.toThrow("Too many attempts");
    state.ip = "198.51.100.9";
    await expect(action(input)).resolves.toBe("ok");
  });
});

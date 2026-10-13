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
  it("lets members read and create but not update or delete", async () => {
    const { can } = await import("@/server/authz");
    expect(can("member", "read")).toBe(true);
    expect(can("member", "create")).toBe(true);
    expect(can("member", "update")).toBe(false);
    expect(can("member", "delete")).toBe(false);
    expect(can("admin", "delete")).toBe(true);
  });

  it("gives an unknown stored role the least privilege (deny by default)", async () => {
    const { toRole, can } = await import("@/server/role-policy");
    expect(toRole("owner")).toBe("owner");
    expect(toRole("superuser")).toBe("member");
    expect(toRole(undefined)).toBe("member");
    expect(can(toRole("superuser"), "delete")).toBe(false);
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

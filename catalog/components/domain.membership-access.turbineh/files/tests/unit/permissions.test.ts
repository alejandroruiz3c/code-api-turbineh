import { describe, expect, it, vi } from "vitest";
import { can } from "@/server/authz";

vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/env", () => ({ env: { ADMIN_EMAILS: "" } }));

/**
 * Fixed invariants of the request's roles (ADR-0054), whatever src/membership/params.json lists. TurbineH replaces
 * this file with the request's full matrix as fixed expectations when it states one.
 */
describe("request roles (fixed invariants)", () => {
  it("the workspace owner can approve, export, change settings and manage members", () => {
    for (const action of ["approve", "export", "configure", "manage_members"] as const)
      expect(can("owner", action), `owner ${action}`).toBe(true);
  });

  it("unknown roles can do nothing", () => {
    for (const action of ["read", "create", "update", "delete", "approve", "export"] as const)
      expect(can("intruder", action), `intruder ${action}`).toBe(false);
  });
});

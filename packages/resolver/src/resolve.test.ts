import { describe, expect, it } from "vitest";
import { checkComponent, resolveSet, type Candidate } from "./index.js";

const base = (over: Partial<Candidate> = {}): Candidate => ({
  id: "auth.session.better-auth",
  status: "approved",
  provides: ["auth.session"],
  pkg: { name: "better-auth", version: "1.7.6" },
  license: { declared: "MIT", detected: "MIT" },
  peer: { next: "^14.0.0 || ^15.0.0 || ^16.0.0", react: "^18.0.0 || ^19.0.0" },
  conflicts: [],
  requires: [],
  ...over,
});
const stack = { next: "16.3.6", react: "19.3.0" };

describe("checkComponent", () => {
  it("accepts an approved, permissive, compatible component", () => {
    expect(checkComponent(base(), stack)).toEqual([]);
  });
  it("rejects non-approved components", () => {
    expect(checkComponent(base({ status: "evaluated" }), stack)[0]?.rule).toBe("status");
  });
  it("rejects disallowed or mismatching licenses", () => {
    expect(
      checkComponent(
        base({ license: { declared: "GPL-3.0-only", detected: "GPL-3.0-only" } }),
        stack,
      ).map((r) => r.rule),
    ).toContain("license");
    expect(
      checkComponent(base({ license: { declared: "MIT", detected: "GPL-3.0-only" } }), stack).map(
        (r) => r.rule,
      ),
    ).toContain("license-mismatch");
  });
  it("rejects incompatible peer ranges and ignores peers the stack does not use", () => {
    expect(checkComponent(base({ peer: { next: "^14.0.0" } }), stack)[0]?.rule).toBe("peer");
    expect(checkComponent(base({ peer: { vue: "^3.0.0" } }), stack)).toEqual([]);
  });
});

describe("resolveSet", () => {
  it("falls back to the next ranked candidate and reports gaps", () => {
    const bad = base({ id: "auth.session.old", peer: { next: "^13.0.0" } });
    const res = resolveSet({ "auth.session": [bad, base()], "payments.checkout": [] }, stack);
    expect(res.selected["auth.session"]?.id).toBe("auth.session.better-auth");
    expect(res.rejected.map((r) => r.id)).toContain("auth.session.old");
    expect(res.gaps).toEqual(["payments.checkout"]);
  });
  it("rejects conflicting components", () => {
    const a = base({ id: "data.orm.a", provides: ["data.orm"], conflicts: ["data.orm.b"] });
    const b = base({ id: "data.orm.b", provides: ["data.orm.extra"] });
    const res = resolveSet({ "data.orm": [a], "data.orm.extra": [b] }, stack);
    expect(res.gaps).toEqual(["data.orm.extra"]);
    expect(res.rejected.some((r) => r.rule === "conflict")).toBe(true);
  });
  it("flags missing requirements", () => {
    const needsOrm = base({ requires: ["data.orm"] });
    expect(resolveSet({ "auth.session": [needsOrm] }, stack).ok).toBe(false);
  });
  it("selects a component shared by several capabilities once", () => {
    const shared = base({ provides: ["auth.session", "authz.organizations"] });
    const res = resolveSet({ "auth.session": [shared], "authz.organizations": [shared] }, stack);
    expect(res.gaps).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { canDo, specFidelitySync } from "./index.js";
import { LEARNING_SPECS } from "./learning-specs.fixtures.js";

const withParent = (kind: string) => kind === "relationship" || kind === "event";

describe.each(LEARNING_SPECS)("spec fidelity · $id", (s) => {
  const { spec, fidelity } = specFidelitySync(s.prompt, s.spec, {
    knownEntities: s.recipeEntities,
  });

  it("classifies every entity as a person would", () => {
    const got = Object.fromEntries(
      fidelity.entities.map((e) => [
        e.name,
        {
          kind: e.kind,
          ...(e.shape ? { shape: e.shape } : {}),
          ...(withParent(e.kind) ? { parent: e.parent } : {}),
        },
      ]),
    );
    const want = Object.fromEntries(
      Object.entries(s.expected.kinds).map(([k, v]) => [
        k,
        {
          kind: v.kind,
          ...(v.shape ? { shape: v.shape } : {}),
          ...(withParent(v.kind) ? { parent: v.parent ?? null } : {}),
        },
      ]),
    );
    expect(got).toEqual(want);
  });

  it("maps the spec's roles and rules onto the workspace roles", () => {
    const labels = Object.fromEntries(
      Object.entries(fidelity.permissions.byOrgRole).map(([k, v]) => [k, v.label]),
    );
    expect(labels).toEqual(s.expected.roles);
    for (const [role, action, allowed, resource] of s.expected.can) {
      expect(
        canDo(fidelity.permissions, role, action, resource),
        `${role} ${action} ${resource ?? ""}`,
      ).toBe(allowed);
    }
    if (s.expected.scope) {
      expect(fidelity.permissions.byOrgRole[s.expected.scope.role].scope).toEqual({
        kind: s.expected.scope.kind,
        of: s.expected.scope.of,
      });
    } else {
      expect(
        Object.values(fidelity.permissions.byOrgRole).every((r) => r.scope.kind === "all"),
      ).toBe(true);
    }
    expect(fidelity.permissions.signUpEmailDomains).toEqual(s.expected.signUpEmailDomains ?? []);
  });

  it("extracts the stated constraints", () => {
    const c = fidelity.constraints;
    expect(c.timeZone.value).toBe(s.expected.timeZone);
    const e = s.expected.constraints ?? {};
    if (e.maxBytes) expect(c.uploads?.maxBytes).toBe(e.maxBytes);
    if (e.types) expect(c.uploads?.types).toEqual(e.types);
    if (e.statuses) expect(c.statusLists[0]?.values).toEqual(e.statuses);
    if (e.noticeHours) expect(c.notice?.hours).toBe(e.noticeHours);
    if (e.cron) expect(c.schedules[0]?.cron).toBe(e.cron);
    if (e.openingDays) expect(c.openingHours.map((h) => h.weekday)).toEqual(e.openingDays);
    if (e.currency) expect(c.currency).toBe(e.currency);
    if (e.boost)
      expect(c.numbers.find((n) => n.what.startsWith("move up by"))?.value).toBe(e.boost);
    if (e.sort) expect(c.sort[0]).toEqual(e.sort);
  });

  it("detects the domain patterns the request describes", () => {
    expect(fidelity.patterns.map((p) => p.id).sort()).toEqual([...s.expected.patterns].sort());
  });

  it("keeps every entity with fields after modelling", () => {
    expect(spec.entities.every((e) => e.fields.length > 0)).toBe(true);
  });
});

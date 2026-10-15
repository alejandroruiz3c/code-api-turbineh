import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { validateManifest, type ComponentManifest } from "./validate.js";

const base = parse(
  readFileSync(
    new URL("../../../catalog/components/data.validation.zod/component.yaml", import.meta.url),
    "utf8",
  ),
) as ComponentManifest;

const approved = (patch: Partial<ComponentManifest> = {}): ComponentManifest => ({
  ...structuredClone(base),
  status: "approved",
  quality: { tests: { command: "pnpm test", passed: true, date: "2026-10-10" } },
  ...patch,
});

describe("validateManifest", () => {
  it("accepts the example manifest", () => {
    expect(validateManifest(base).errors).toEqual([]);
  });

  it("rejects unknown fields and bad ids", () => {
    expect(validateManifest({ ...base, extra: 1 }).ok).toBe(false);
    expect(validateManifest({ ...base, id: "Zod" }).ok).toBe(false);
  });

  it("requires id prefix to match category", () => {
    expect(validateManifest({ ...base, category: "ui" }).errors.join()).toMatch(
      /must match category/,
    );
  });

  it("accepts an approved manifest that meets every gate", () => {
    expect(validateManifest(approved()).errors).toEqual([]);
  });

  it("blocks approval on failing tests, license mismatch, disallowed license or unmitigated high finding", () => {
    expect(
      validateManifest(approved({ quality: { tests: { command: "x", passed: false } } })).ok,
    ).toBe(false);
    expect(
      validateManifest(approved({ license: { declared: "MIT", detected: "GPL-3.0-only" } })).ok,
    ).toBe(false);
    expect(
      validateManifest(
        approved({ license: { declared: "GPL-3.0-only", detected: "GPL-3.0-only" } }),
      ).ok,
    ).toBe(false);
    const sec = { ...base.security, findings: [{ id: "GHSA-x", severity: "high" }] };
    expect(validateManifest(approved({ security: sec })).ok).toBe(false);
    const mitigated = {
      ...base.security,
      findings: [{ id: "GHSA-x", severity: "high", mitigation: "not reachable" }],
    };
    expect(validateManifest(approved({ security: mitigated })).ok).toBe(true);
  });

  it("requires tested evidence for approval", () => {
    const evidence = base.evidence.filter((e) => e.origin !== "tested");
    expect(validateManifest(approved({ evidence })).ok).toBe(false);
  });
});

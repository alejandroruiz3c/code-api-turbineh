import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOwners } from "@turbineh/assembler";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { assembleCombination, combinations, DOMAIN_PROBES } from "./combinations.js";

const repo = join(import.meta.dirname, "../../..");

describe("recipe + component combinations (ADR-0037 §D4)", () => {
  it("covers every recipe and ai-agents + domain.bookings (the 66af3182 combination)", () => {
    const names = combinations(repo).map((c) => c.name);
    expect(names).toContain("ai-agents");
    expect(names).toContain("bookings");
    expect(names).toContain("ai-agents+domain.bookings.turbineh");
    // The booking domain is an ai-agents component: the plain bookings recipe does not assemble it.
    expect(names).not.toContain("bookings+domain.bookings.turbineh");
  });

  it("every domain component has a probe request, so its combinations are checked", () => {
    const dir = join(repo, "catalog/components");
    const domains = readdirSync(dir).filter((id) => {
      const m = parse(readFileSync(join(dir, id, "component.yaml"), "utf8")) as {
        status?: string;
      };
      return id.startsWith("domain.") && m.status === "approved";
    });
    expect(domains.length).toBeGreaterThan(0);
    for (const id of domains) expect(Object.keys(DOMAIN_PROBES), id).toContain(id);
  });

  it("assembles ai-agents + domain.bookings like the pipeline: required, domain and native components", () => {
    const out = join(mkdtempSync(join(tmpdir(), "combo-")), "app");
    const r = assembleCombination(repo, combinations(repo).at(-1)!, out);
    expect(r.domains).toEqual(["domain.bookings.turbineh"]);
    expect(r.components).toEqual(
      expect.arrayContaining([
        "ai.orchestrator.turbineh",
        "security.ai-safety.turbineh",
        "domain.bookings.turbineh",
      ]),
    );
    const owners = readOwners(out);
    expect(owners["tests/e2e/booking-assistant.spec.ts"]).toBe(
      "component:domain.bookings.turbineh",
    );
    expect(owners["src/bookings/params.json"]).toBe("component:domain.bookings.turbineh");
  });
});

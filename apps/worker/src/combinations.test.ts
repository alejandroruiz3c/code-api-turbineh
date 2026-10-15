import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOwners } from "@turbineh/assembler";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  assembleCombination,
  combinations,
  COMPONENT_COMBINATIONS,
  DOMAIN_PROBES,
} from "./combinations.js";

const repo = join(import.meta.dirname, "../../..");

describe("recipe + component combinations (ADR-0037 §D4)", () => {
  it("covers every recipe and ai-agents + domain.bookings (the 66af3182 combination)", () => {
    const names = combinations(repo).map((c) => c.name);
    expect(names).toContain("ai-agents");
    expect(names).toContain("bookings");
    expect(names).toContain("ai-agents+domain.bookings.turbineh");
    // The bookings recipe is built on the booking domain, with its own request (Sala Nueve), not the AI probe.
    expect(names.filter((n) => n === "bookings+domain.bookings.turbineh")).toHaveLength(1);
    expect(
      combinations(repo).find((c) => c.name === "bookings+domain.bookings.turbineh")?.prompt,
    ).toMatch(/Sala Nueve/);
  });

  it("every domain component has a probe request or a checked combination", () => {
    const dir = join(repo, "catalog/components");
    const domains = readdirSync(dir).filter((id) => {
      const m = parse(readFileSync(join(dir, id, "component.yaml"), "utf8")) as {
        status?: string;
      };
      return id.startsWith("domain.") && m.status === "approved";
    });
    expect(domains.length).toBeGreaterThan(0);
    const checked = new Set([
      ...Object.keys(DOMAIN_PROBES),
      ...COMPONENT_COMBINATIONS.flatMap((c) => c.with ?? []),
    ]);
    for (const id of domains) expect([...checked], id).toContain(id);
  });

  it("assembles ai-agents + domain.bookings like the pipeline: required, domain and native components", () => {
    const out = join(mkdtempSync(join(tmpdir(), "combo-")), "app");
    const combo = combinations(repo).find((c) => c.name === "ai-agents+domain.bookings.turbineh")!;
    const r = assembleCombination(repo, combo, out);
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

  it("assembles component combinations with the request's parameters (ADR-0041)", () => {
    const out = join(mkdtempSync(join(tmpdir(), "combo-")), "app");
    const combo = combinations(repo).find((c) => c.name === "tracker+domain.workflow.turbineh")!;
    const r = assembleCombination(repo, combo, out);
    expect(r.components).toContain("domain.workflow.turbineh");
    const params = JSON.parse(readFileSync(join(out, "src/workflow/params.json"), "utf8")) as {
      workflows: { key: string }[];
    };
    expect(params.workflows[0]?.key).toBe("piece");
    expect(readOwners(out)["src/workflow/params.json"]).toBe("component:domain.workflow.turbineh");
  });
});

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENT_PLAN_CASES, REPO_STACK, scoreComponentPlans } from "./component-plan-bench.js";
import { componentPlan } from "./product.js";

const dir = join(import.meta.dirname, "../../../catalog/components");
const ids = (need: string) =>
  componentPlan("t", { need, stack: REPO_STACK }, dir).components.map((c) => c.id);

describe("component-only plans select what the need asks for (ADR-0051)", () => {
  it("the 2026-10-13 incident: an HTTP client need selects ky and nothing unrelated", () => {
    const selected = ids(
      "Small fetch-based HTTP client with retries and timeouts for external APIs",
    );
    expect(selected).toContain("ops.http-client.ky");
    // Retries and timeouts are built into ky; a separate retry helper is the only other acceptable pick.
    expect(
      selected.filter((id) => !["ops.http-client.ky", "ops.retry.p-retry"].includes(id)),
    ).toEqual([]);
    for (const unrelated of [
      "commerce.cart.zustand",
      "data.fetching.react-query",
      "data.fuzzy-search.fuse",
      "email.transactional.turbineh",
      "ops.queue-throttle.p-queue",
    ])
      expect(selected).not.toContain(unrelated);
  });

  it("labelled single-capability needs: every required component, nothing unrelated", () => {
    const r = scoreComponentPlans(dir, COMPONENT_PLAN_CASES);
    expect(r.rows.filter((x) => !x.hit).map((x) => x.need)).toEqual([]);
    expect(r.rows.filter((x) => x.unrelated.length > 0)).toEqual([]);
    expect(r.precision).toBe(1);
  });

  it("a need with two capabilities still gets both", () => {
    const selected = ids("Send transactional emails with PDF invoices attached");
    expect(selected.some((id) => id.startsWith("email.transactional"))).toBe(true);
    expect(selected.some((id) => id.startsWith("files.pdf."))).toBe(true);
  });

  it("inference needs get the orchestrator with its declared AI Safety Pack; plain code does not", () => {
    const ai = ids("AI assistant that summarizes support tickets");
    expect(ai).toContain("ai.orchestrator.turbineh");
    expect(ai).toContain("security.ai-safety.turbineh");
    expect(ids("Generate QR codes for event tickets")).not.toContain("ai.orchestrator.turbineh");
  });

  it("never packages platform services", () => {
    expect(ids("Analyse my repository structure")).not.toContain("ops.repo-analysis.turbineh");
  });
});

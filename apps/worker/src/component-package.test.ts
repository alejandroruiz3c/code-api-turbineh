import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContractRun } from "@turbineh/curation";
import { flowOutcome, flowResult, flowState, PACKAGE_NOT_VERIFIED_TITLE } from "@turbineh/engine";
import { LocalStorage } from "@turbineh/storage";
import { describe, expect, it } from "vitest";
import { generateComponentPackage, type ComponentPackageDeps } from "./component-package.js";
import { REPO_STACK } from "./component-plan-bench.js";
import { componentPlan } from "./product.js";

const repoRoot = join(import.meta.dirname, "../../..");
const NEED = "Small fetch-based HTTP client with retries and timeouts for external APIs";

function setup(runContracts: ComponentPackageDeps["runContracts"]) {
  const events: { phase: string; type: string; data: Record<string, unknown> }[] = [];
  const plan = componentPlan(
    "470bc606-12e6-433b-b286-25b48c78e970",
    { need: NEED, stack: REPO_STACK },
    join(repoRoot, "catalog/components"),
  );
  const deps: ComponentPackageDeps = {
    repoRoot,
    storage: new LocalStorage(mkdtempSync(join(tmpdir(), "turbineh-pkg-test-"))),
    emit: async (phase, type, data) => {
      events.push({ phase, type, data });
    },
    runContracts,
  };
  return { events, plan, deps };
}

const passing: ComponentPackageDeps["runContracts"] = async (ids, _dir, onStep) => {
  await onStep({ name: "install", state: "start" });
  await onStep({ name: "install", state: "done", ok: true, ms: 900 });
  await onStep({ name: "contract", state: "start" });
  await onStep({ name: "typecheck", state: "start" });
  await onStep({ name: "contract", state: "done", ok: true, ms: 400, tests: ids.length });
  await onStep({ name: "typecheck", state: "done", ok: true, ms: 300 });
  return {
    components: ids.map((id) => ({ id, passed: true, missing: false, failure: "" })),
    steps: [
      { name: "install", ok: true, ms: 900 },
      { name: "contract", ok: true, ms: 400, tests: ids.length },
      { name: "typecheck", ok: true, ms: 300 },
    ],
    runTail: "",
    typecheckTail: "exit=0",
  } satisfies ContractRun;
};

const rowOf = (
  plan: ReturnType<typeof componentPlan>,
  outcome: Awaited<ReturnType<typeof generateComponentPackage>>,
) => {
  const { artifact, ...metrics } = outcome.metrics;
  return {
    id: plan.id,
    status: outcome.status,
    options: { mode: "generate" },
    metrics: { ...metrics, plan },
    artifact: artifact as Record<string, unknown>,
    error: null,
  };
};

describe("capability package for a repository (ADR-0051)", () => {
  it("runs the package's contract tests in the sandbox and says each step live", async () => {
    const { events, plan, deps } = setup(passing);
    const outcome = await generateComponentPackage(plan.id, plan, deps);
    expect(outcome.status).toBe("done");
    expect(events.map((e) => `${e.phase}:${e.type}`)).toEqual([
      "assembling:start",
      "assembling:done",
      "verifying:start",
      "verifying:step",
      "verifying:step",
      "verifying:step",
      "verifying:step",
      "verifying:step",
      "verifying:step",
      "verifying:done",
      "delivering:start",
      "delivering:done",
    ]);
    expect(events[0]?.data.components).toEqual(["ops.http-client.ky"]);
    const row = rowOf(plan, outcome);
    expect(flowState(row)).toBe("verified");
    const o = flowOutcome(row);
    expect(o.kind).toBe("package_verified");
    expect(o.state).toBe("verified");
    expect(o.actions.map((a) => a.id)).toEqual(["open_pull_request", "download_zip", "apply_cli"]);
    expect(flowResult(row, { zipUrl: "z", manifestUrl: "m" }).outcome).toEqual(o);
  });

  it("no sandbox: delivered as generated, 'not verified yet', and every surface says the same", async () => {
    const { events, plan, deps } = setup(async () => {
      throw new Error("docker: command not found");
    });
    const outcome = await generateComponentPackage(plan.id, plan, deps);
    expect(outcome.status).toBe("done");
    expect(events.at(-1)).toMatchObject({ phase: "delivering", type: "done" });
    expect(events.find((e) => e.phase === "verifying" && e.type === "done")?.data).toMatchObject({
      ran: false,
    });
    const row = rowOf(plan, outcome);
    const result = flowResult(row, { zipUrl: "z", manifestUrl: "m" });
    expect(flowState(row)).toBe("generated");
    expect(result.state).toBe("generated");
    expect(result.outcome?.kind).toBe("package_unverified");
    expect(result.outcome?.title).toBe(PACKAGE_NOT_VERIFIED_TITLE);
    expect(result.outcome?.left[0]).toMatch(/Verify it inside your project/);
    const apply = result.outcome?.actions.find((a) => a.id === "apply_cli");
    expect(apply?.command).toBe(`turbineh apply ${plan.id}`);
    expect(apply?.detail).toMatch(/ky@2\.1\.0/);
    // Not a failure: nothing to report as an error.
    expect(result.errors).toEqual([]);
  });

  it("a failing contract test is delivered, never 'verified', with an actionable error", async () => {
    const { plan, deps } = setup(async (ids) => ({
      components: ids.map((id) => ({ id, passed: false, missing: false, failure: "boom" })),
      steps: [
        { name: "install", ok: true, ms: 1 },
        { name: "contract", ok: false, ms: 1, tests: 0 },
        { name: "typecheck", ok: true, ms: 1 },
      ],
      runTail: "",
      typecheckTail: "exit=0",
    }));
    const row = rowOf(plan, await generateComponentPackage(plan.id, plan, deps));
    const result = flowResult(row, { zipUrl: "z", manifestUrl: "m" });
    expect(result.state).toBe("generated");
    expect(result.outcome?.meaning).toMatch(/did not pass/);
    expect(result.errors[0]?.code).toBe("verification_failed");
  });
});

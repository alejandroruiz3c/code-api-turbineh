import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ContractRun, ContractStep } from "@turbineh/curation";
import type { CatalogEntry } from "@turbineh/engine";
import type { CheckResult, Plan } from "@turbineh/shared";
import type { ArtifactStorage } from "@turbineh/storage";
import type { BuildOutcome } from "./pipeline.js";
import { catalogEntries, storeCapabilityPackage } from "./product.js";

export type Emit = (phase: string, type: string, data: Record<string, unknown>) => Promise<void>;

export interface ComponentPackageDeps {
  repoRoot: string;
  storage: ArtifactStorage;
  emit: Emit;
  /** The contract harness (`runContracts` from @turbineh/curation); injected so tests need no Docker. */
  runContracts: (
    ids: string[],
    componentsDir: string,
    onStep: (s: ContractStep) => Promise<void>,
  ) => Promise<ContractRun>;
}

/** Why a capability package was not verified at generation (it is verified inside the project on integration). */
export interface PackageVerification {
  ran: boolean;
  ok: boolean;
  /** Plain words, shown on the result: what ran, or why nothing ran. */
  summary: string;
  tests: number;
  failures: { component: string; message: string }[];
  /** Checks of the run (contract tests, strict types), empty when nothing ran. */
  checks: CheckResult[];
}

/**
 * Component-only generation (a capability for an existing project, ADR-0051): the certified components are packaged
 * and their contract tests run together in the sandbox (install with network and no secrets, tests and strict types
 * with --network none — the certification harness). The package is "verified" only when that run passed; otherwise
 * it is delivered as "generated" (not verified yet: it is verified inside the project when integrated). Every phase
 * emits start/done events so the flow page always says what is happening.
 */
export async function generateComponentPackage(
  buildId: string,
  plan: Plan,
  deps: ComponentPackageDeps,
): Promise<BuildOutcome> {
  const t0 = performance.now();
  const componentsDir = join(deps.repoRoot, "catalog/components");
  const ids = plan.components.map((c) => c.id);
  await deps.emit("assembling", "start", { components: ids, package: "components" });
  const entries = catalogEntries(componentsDir).filter((c) => ids.includes(c.id));
  await deps.emit("assembling", "done", {
    components: entries.map((c) => c.id),
    files: entries.length,
    package: "components",
  });

  const testable = entries.filter((c) => existsSync(join(c.dir, "contract.test.ts")));
  const verification = await verifyContracts(testable, entries, componentsDir, deps);
  const checks = verification.checks;
  const state = verification.ran && verification.ok ? "verified" : "generated";

  await deps.emit("delivering", "start", { channel: "package" });
  const pkg = await storeCapabilityPackage(
    buildId,
    deps.storage,
    {
      slug: plan.capability.id,
      name: plan.capability.name,
      need: plan.need,
      planId: buildId,
      state,
      summary: plan.need,
      components: entries.map((c) => ({
        id: c.id,
        version: c.version,
        license: c.license,
        purl: c.purl,
        capability: c.provides[0] ?? c.category,
        why: plan.components.find((p) => p.id === c.id)?.why ?? "",
      })),
      checks,
      plan,
    },
    { components: entries },
  );
  await deps.emit("delivering", "done", {
    channel: "package",
    package: true,
    verified: state === "verified",
  });
  return {
    buildId,
    status: "done",
    metrics: {
      verify: checks,
      packageVerification: verification,
      timings: { total: Math.round(performance.now() - t0) },
      reuse: { reusedShare: 1, generatedLines: 0 },
      artifact: { slug: plan.capability.id, package: pkg },
    },
  };
}

async function verifyContracts(
  testable: (CatalogEntry & { dir: string })[],
  all: CatalogEntry[],
  componentsDir: string,
  deps: ComponentPackageDeps,
): Promise<PackageVerification> {
  if (testable.length === 0) {
    return {
      ran: false,
      ok: false,
      summary:
        all.length === 0
          ? "No component to check."
          : "These components have no contract tests of their own (TurbineH modules are checked inside complete builds), so nothing ran in the sandbox for this package.",
      tests: 0,
      failures: [],
      checks: [],
    };
  }
  const ids = testable.map((c) => c.id);
  await deps.emit("verifying", "start", {
    package: "components",
    components: ids,
    steps: ["install", "contract", "typecheck"],
  });
  try {
    const run = await deps.runContracts(ids, componentsDir, (s) =>
      deps.emit("verifying", "step", { ...s }),
    );
    const failures = run.components
      .filter((c) => !c.passed)
      .map((c) => ({ component: c.id, message: c.failure || "contract test did not pass" }));
    const tests = run.steps.find((s) => s.name === "contract")?.tests ?? 0;
    const ok = failures.length === 0 && run.steps.every((s) => s.ok);
    await deps.emit("verifying", "done", {
      ok,
      package: "components",
      steps: run.steps.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms, tests: s.tests })),
    });
    return {
      ran: true,
      ok,
      summary: ok
        ? `${tests} contract test(s) of ${ids.length} component(s) passed together in the TurbineH sandbox (no network, no secrets), with strict type checking.`
        : `The contract tests did not all pass in the TurbineH sandbox: ${failures.map((f) => f.component).join(", ")}.`,
      tests,
      failures,
      checks: run.steps
        .filter((s) => s.name !== "install")
        .map((s) => ({ name: s.name, ok: s.ok })),
    };
  } catch (err) {
    // No sandbox available (or the install could not reach the registry): deliver, say it was not verified yet.
    const reason = err instanceof Error ? err.message.split("\n")[0]?.slice(0, 200) : String(err);
    await deps.emit("verifying", "done", {
      ok: false,
      ran: false,
      package: "components",
      reason,
    });
    return {
      ran: false,
      ok: false,
      summary:
        "The sandbox check could not run this time, so the package is delivered without it; it is verified inside your project when you integrate it.",
      tests: 0,
      failures: [],
      checks: [],
    };
  }
}

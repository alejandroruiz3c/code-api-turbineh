/**
 * Consistency of a delivered flow (ADR-0064): every surface the person or a coding agent reads — the approved plan,
 * the result, "Next steps", DEPLOY.md, AGENTS.md and turbineh.json — is compared with the delivery manifest. The
 * contradictions are recorded with the build (`metrics.consistency`); CI runs the same check on every recipe.
 */
import { existsSync, readFileSync } from "node:fs";
import { deliveredLeft, flowNeeds } from "@turbineh/engine";
import { join } from "node:path";
import {
  agentsFacts,
  checkConsistency,
  deployFacts,
  guideFacts,
  nextStepsFacts,
  planFacts,
  resultFacts,
  type Contradiction,
  type DeliveryManifest,
  type Plan,
  type SurfaceFacts,
} from "@turbineh/shared";

/** Planned vs delivered: everything the plan decided is delivered or reported as a broken promise, nothing added. */
export function compareManifests(
  planned: DeliveryManifest,
  final: DeliveryManifest,
): Contradiction[] {
  const out: Contradiction[] = [];
  const broken = new Set(final.brokenPromises.map((b) => b.capability));
  for (const p of planned.entries) {
    const f = final.entries.find((e) => e.capability === p.capability);
    if (!f) {
      out.push({
        surface: "generation",
        field: "entries",
        detail: `${p.capability} was planned but has no outcome`,
      });
      continue;
    }
    if (p.way === "not_included") continue;
    if (f.status === "not_delivered" && !broken.has(p.capability) && planned.approved)
      out.push({
        surface: "generation",
        field: "brokenPromises",
        detail: `${p.capability} was approved and not delivered, but is not reported as a broken promise`,
      });
    if (f.way !== p.way || f.component !== p.component)
      out.push({
        surface: "generation",
        field: "entries",
        detail: `${p.capability}: approved ${p.component ?? p.way}, generated ${f.component ?? f.way}`,
      });
  }
  for (const f of final.entries)
    if (!planned.entries.some((p) => p.capability === f.capability))
      out.push({
        surface: "generation",
        field: "entries",
        detail: `${f.component ?? f.capability} is in the package but was not in the approved plan`,
      });
  if (planned.criteria.join("\n") !== final.criteria.join("\n"))
    out.push({
      surface: "generation",
      field: "criteria",
      detail: "the criteria changed after the plan was approved",
    });
  return out;
}

/** Every surface of a delivered flow, read back from what was really written. */
export function deliverySurfaces(input: {
  manifest: DeliveryManifest;
  repoDir?: string;
  plan?: Plan;
  metrics: Record<string, unknown>;
}): SurfaceFacts[] {
  const read = (rel: string) =>
    input.repoDir && existsSync(join(input.repoDir, rel))
      ? readFileSync(join(input.repoDir, rel), "utf8")
      : null;
  const report = input.metrics.report as
    { nextSteps?: string[]; criteria?: { criterion: string }[] } | undefined;
  // The result as the API, the web and the CLI show it (engine `flowResult` / `flowOutcome`): settings and what is left.
  const row = { metrics: { ...input.metrics, manifest: input.manifest } };
  const left = deliveredLeft(row) ?? [];
  const OPEN = / — no passing test proves it yet: /;
  const surfaces: SurfaceFacts[] = [
    resultFacts({
      components: ((input.metrics.components as string[] | undefined) ?? []).filter(
        (c): c is string => typeof c === "string",
      ),
      ...(report?.criteria ? { criteria: report.criteria.map((c) => c.criterion) } : {}),
      openCriteria: left.filter((l) => OPEN.test(l)).map((l) => l.split(OPEN)[0] ?? l),
      needs: flowNeeds(row),
    }),
  ];
  if (report?.nextSteps) surfaces.push(nextStepsFacts(report.nextSteps));
  const deploy = read("DEPLOY.md");
  if (deploy) surfaces.push(deployFacts(deploy));
  const agents = read("AGENTS.md");
  if (agents) surfaces.push(agentsFacts(agents));
  const guide = read("turbineh.json");
  if (guide) surfaces.push(guideFacts(JSON.parse(guide) as Parameters<typeof guideFacts>[0]));
  return surfaces;
}

export interface ConsistencyReport {
  ok: boolean;
  surfaces: string[];
  contradictions: Contradiction[];
}

/**
 * The consistency of one delivered flow: package surfaces against the reconciled manifest, the approved plan against
 * the manifest it was rendered from, and the plan's manifest against what was generated.
 */
export function deliveryConsistency(input: {
  manifest: DeliveryManifest;
  repoDir?: string;
  plan?: Plan;
  metrics: Record<string, unknown>;
}): ConsistencyReport {
  const surfaces = deliverySurfaces(input);
  const contradictions = checkConsistency(input.manifest, surfaces, { delivered: true });
  const names = surfaces.map((s) => s.surface);
  if (input.plan?.delivery) {
    contradictions.push(
      ...checkConsistency(input.plan.delivery, planFacts(input.plan), { delivered: false }),
    );
    contradictions.push(...compareManifests(input.plan.delivery, input.manifest));
    names.push("plan", "plan decisions", "generation");
  }
  return { ok: contradictions.length === 0, surfaces: names, contradictions };
}

/**
 * Precision of the components-only offer (ADR-0062) on the labelled set bench/offers/labelled.json: for each request,
 * the scope gate and the offer run against the real catalogue with the given decider; an offered component counts as
 * correct only when the label lists it (an empty label means nothing may be offered). Declared dependencies of an
 * offered component (e.g. the AI Safety Pack) are not counted.
 *
 *   pnpm --filter @turbineh/worker exec tsx src/offer-bench.ts                 # code only (open engine)
 *   pnpm --filter @turbineh/worker exec tsx src/offer-bench.ts --engine --env <path/.env.local>
 *                                                                              # the installed engine, real backends
 * Results go to bench/offers/results/<date>-<mode>.json. Keys are read from the env file, never printed.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildSpec } from "@turbineh/compiler";
import type { Decider } from "@turbineh/decider";
import { explainUncovered, gateRequest } from "./scope.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const componentsDir = join(root, "catalog/components");

export interface LabelledRequest {
  id: string;
  need: string;
  criteria: string[];
  acceptable: string[];
}

export interface OfferCase {
  id: string;
  gate: string;
  offered: string[];
  wrong: string[];
  decidedBy: string | null;
  coreNotIncluded: boolean | null;
}

export const labelledSet = (): LabelledRequest[] =>
  (
    JSON.parse(readFileSync(join(root, "bench/offers/labelled.json"), "utf8")) as {
      requests: LabelledRequest[];
    }
  ).requests;

const specFor = (criteria: string[]): BuildSpec =>
  ({
    recipe: "out_of_scope",
    out_of_scope_reason: "no family matches",
    closest_recipe: null,
    app_name: "Request",
    slug: "request",
    summary: "",
    roles: [],
    entities: [],
    pages: [],
    capabilities: [],
    acceptance_criteria: criteria,
    site: null,
    palette: null,
  }) as unknown as BuildSpec;

export async function runOfferSet(
  decider: Decider,
): Promise<{ cases: OfferCase[]; offered: number; correct: number; precision: number | null }> {
  const cases: OfferCase[] = [];
  for (const r of labelledSet()) {
    const verdict = await gateRequest({
      prompt: r.need,
      spec: specFor(r.criteria),
      componentsDir,
      decider,
    });
    const out =
      verdict.status === "uncovered"
        ? await explainUncovered({ prompt: r.need, verdict, componentsDir, decider, planId: null })
        : null;
    const offered = (out?.explanation.offer?.components ?? [])
      .filter((c) => !c.requiredBy)
      .map((c) => c.id);
    cases.push({
      id: r.id,
      gate: verdict.status,
      offered,
      wrong: offered.filter((id) => !r.acceptable.includes(id)),
      decidedBy: out?.result?.decidedBy ?? null,
      coreNotIncluded: out?.result?.coreNotIncluded ?? null,
    });
  }
  const offered = cases.reduce((a, c) => a + c.offered.length, 0);
  const correct = offered - cases.reduce((a, c) => a + c.wrong.length, 0);
  return { cases, offered, correct, precision: offered ? correct / offered : null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const useEngine = process.argv.includes("--engine");
  let decider: Decider;
  if (useEngine) {
    const at = process.argv.indexOf("--env");
    const file = at > 0 ? process.argv[at + 1] : join(root, ".env.local");
    for (const line of readFileSync(file ?? "", "utf8").split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (m?.[1] && process.env[m[1]] === undefined)
        process.env[m[1]] = m[2]?.replace(/^"|"$/g, "") ?? "";
    }
    const { decisionIO } = await import("@turbineh/decider");
    const { engine } = await import("@turbineh/decider/engine");
    decider = engine.fromEnv(process.env, decisionIO);
    console.log(`engine: ${engine.edition} ${engine.version} · decider ${decider.id}`);
  } else {
    decider = (await import("@turbineh/decider")).openDecider;
  }
  const r = await runOfferSet(decider);
  for (const c of r.cases)
    console.log(
      `${c.id.padEnd(28)} gate=${c.gate.padEnd(9)} offered=[${c.offered.join(", ")}]${c.wrong.length ? `  WRONG: ${c.wrong.join(", ")}` : ""}${c.decidedBy ? ` (${c.decidedBy})` : ""}`,
    );
  console.log(
    `requests ${r.cases.length} · offered ${r.offered} · correct ${r.correct} · precision ${r.precision === null ? "n/a (nothing offered)" : r.precision.toFixed(3)}`,
  );
  const dir = join(root, "bench/offers/results");
  mkdirSync(dir, { recursive: true });
  const out = join(
    dir,
    `${new Date().toISOString().slice(0, 10)}-${useEngine ? `engine-${decider.id}` : "code"}.json`,
  );
  writeFileSync(
    out,
    `${JSON.stringify({ at: new Date().toISOString(), mode: useEngine ? decider.id : "code", ...r }, null, 2)}\n`,
  );
  console.log(`→ ${out}`);
}

/**
 * pnpm catalog:curate <batch.yaml> [--skip-evaluate]
 * Evaluates every entry (registry metadata, licence, OSV) and certifies them with their contract tests.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { certify } from "./certify.js";
import { evaluate, type CurationEntry } from "./evaluate.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const batchFile = resolve(process.cwd(), process.argv[2] ?? "");
const skipEvaluate = process.argv.includes("--skip-evaluate");
const today = new Date().toISOString().slice(0, 10);
const componentsDir = join(repoRoot, "catalog/components");
const batch = parse(readFileSync(batchFile, "utf8")) as { name: string; entries: CurationEntry[] };

if (!skipEvaluate) {
  for (const e of batch.entries) {
    const r = await evaluate(e, componentsDir, today);
    console.log(`evaluated ${r.id} ${r.version} ${r.license} advisories=${r.advisories.length}`);
  }
}
const evidence = join(repoRoot, "bench/results", `${today}-certify-${batch.name}.json`);
const results = await certify(
  batch.entries.map((e) => e.id),
  componentsDir,
  evidence,
  today,
  relative(repoRoot, evidence),
);
for (const r of results)
  console.log(
    `${r.approved ? "APPROVED" : "not approved"}  ${r.id}  ${r.approved ? "" : r.reason}`,
  );
console.log(
  `\n${results.filter((r) => r.approved).length}/${results.length} approved · evidence: ${relative(repoRoot, evidence)}`,
);

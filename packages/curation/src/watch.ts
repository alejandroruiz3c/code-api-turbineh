/**
 * pnpm catalog:watch — re-checks every approved npm component against OSV (the catalog can age: a version that was
 * clean when approved may get an advisory later). Prints a Markdown report; exit code 1 when anything is found, so a
 * scheduled workflow can open an issue. Read-only: approval changes go through curation.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { osvAdvisories } from "./evaluate.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const componentsDir = join(repoRoot, "catalog/components");
const out = process.argv[2];

const findings: { id: string; pkg: string; advisories: { id: string; severity: string }[] }[] = [];
for (const d of readdirSync(componentsDir).sort()) {
  const m = parse(readFileSync(join(componentsDir, d, "component.yaml"), "utf8")) as {
    status: string;
    source: { purl: string };
  };
  const purl = /^pkg:npm\/(.+)@([^@]+)$/.exec(m.source.purl);
  if (m.status !== "approved" || !purl?.[1] || !purl[2]) continue;
  const advisories = await osvAdvisories(purl[1], purl[2]);
  if (advisories.length > 0) findings.push({ id: d, pkg: `${purl[1]}@${purl[2]}`, advisories });
}
const report = findings.length
  ? `## Catalog watch: ${findings.length} component(s) with advisories\n\n${findings
      .map(
        (f) =>
          `- \`${f.id}\` (${f.pkg}): ${f.advisories.map((a) => `${a.id} (${a.severity})`).join(", ")}`,
      )
      .join(
        "\n",
      )}\n\nNext step: re-run curation for these components (pick a patched version) or move them out of \`approved\`.\n`
  : "## Catalog watch: no advisories\n";
if (out) writeFileSync(out, report);
console.log(report);
process.exit(findings.length ? 1 : 0);

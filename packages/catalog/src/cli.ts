/** `pnpm catalog:validate` — validates every catalog/components/<id>/component.yaml. Exit 1 on any error. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guideErrors } from "./guide.js";
import { checkComponents, checkRecipes } from "./agent-ready.js";
import { buildIndex, INDEX_DIR } from "./catalog-index.js";
import { docsIssues } from "./docs.js";
import { validateManifestFile } from "./validate.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../catalog/components");
const dirs = existsSync(root)
  ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())
  : [];
let failed = 0;

for (const dir of dirs) {
  const file = join(root, dir.name, "component.yaml");
  const res = existsSync(file)
    ? validateManifestFile(file)
    : { file, ok: false, errors: ["missing component.yaml"] };
  // The directory name must equal the manifest id so lookups are unambiguous.
  if (res.ok) {
    const { parse } = await import("yaml");
    const { readFileSync } = await import("node:fs");
    const id = (parse(readFileSync(file, "utf8")) as { id: string }).id;
    if (id !== basename(dir.name)) res.errors.push(`directory "${dir.name}" must equal id "${id}"`);
    // Optional component guides (ADR-0033): complete, and every guarantee linked to a shipped test.
    res.errors.push(...guideErrors(join(root, dir.name), id));
    res.ok = res.errors.length === 0;
  }
  if (!res.ok) failed++;
  console.log(
    `${res.ok ? "✓" : "✗"} ${dir.name}${res.ok ? "" : "\n    " + res.errors.join("\n    ")}`,
  );
}

console.log(`\n${dirs.length - failed}/${dirs.length} manifests valid`);

// Agent-ready standard (ADR-0032): recipe templates and native component files.
const issues = [...checkRecipes(join(root, "../recipes")), ...checkComponents(root)];
for (const i of issues) console.log(`✗ [${i.rule}] ${i.where}\n    ${i.message}`);
console.log(
  issues.length === 0
    ? "agent-ready: every recipe template and component passes"
    : `agent-ready: ${issues.length} issue(s)`,
);

// Documentation standard (ADR-0032): every component is documented (docs.yaml). Missing or incomplete docs are not a
// rejection: the intake documentation step writes them (pnpm catalog:document).
const undocumented = dirs.flatMap((d) =>
  docsIssues(join(root, d.name), d.name).map((m) => `${d.name}: ${m}`),
);
for (const u of undocumented) console.log(`✗ [docs] ${u}`);
console.log(
  undocumented.length === 0
    ? `docs: all ${dirs.length} components documented to the standard`
    : `docs: ${undocumented.length} component(s) to document — run pnpm catalog:document`,
);

// The agent-readable index must match the manifests and docs.
const { json, llms } = buildIndex(root);
const indexDir = join(root, "../..", INDEX_DIR);
const stale = [
  ["index.json", json],
  ["llms.txt", llms],
].filter(([f, want]) => {
  const p = join(indexDir, f as string);
  return !existsSync(p) || readFileSync(p, "utf8") !== want;
});
if (stale.length) console.log(`✗ [index] ${INDEX_DIR} is out of date — run pnpm catalog:index`);

if (
  dirs.length === 0 ||
  failed > 0 ||
  issues.length > 0 ||
  undocumented.length > 0 ||
  stale.length > 0
)
  process.exit(1);

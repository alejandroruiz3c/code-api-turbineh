/**
 * `pnpm catalog:snippets [--check] [id…]` — public usage snippets (ADR-0066, audit F-04).
 *
 * Derives every component's example from its own contract test (or snippet.ts), compiles each one with `tsc --noEmit`
 * against the pinned versions (one file per snippet, the contract harness settings), repairs `import` interface
 * signatures from the imports the component really uses, and writes `example` + `example_check` into guide.yaml.
 * `example_check.compiled.on` keeps its date while the snippet, its packages and TypeScript are unchanged.
 *
 * --check (CI): writes nothing; exit 1 when a snippet does not compile or a guide is not what this would write.
 * Runs in the sandbox container; with CI=true (ephemeral runner, no secrets) directly on the runner.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  repairImportSignatures,
  usageSources,
  type ExampleCheck,
} from "@turbineh/catalog/snippets";
import { parse } from "yaml";
import { compileSnippets, expectedExample, signatureLines, writeGuideExample } from "./snippets.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const componentsDir = join(repoRoot, "catalog/components");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const ids = args.filter((a) => !a.startsWith("--"));
const today = new Date().toISOString().slice(0, 10);

const outcomes = await compileSnippets(componentsDir, {
  onRunner: process.env.CI === "true",
  ...(ids.length ? { ids } : {}),
});
const failed = new Set<string>();
let written = 0;
const counts: Record<string, number> = {};
for (const o of outcomes) {
  const kind = o.snippet?.kind ?? "none";
  counts[kind] = (counts[kind] ?? 0) + 1;
  const dir = join(componentsDir, o.id);
  const guideFile = join(dir, "guide.yaml");
  const guide = parse(readFileSync(guideFile, "utf8")) as {
    example?: string;
    example_check?: ExampleCheck;
    interfaces: { name: string; signature: string; where?: string }[];
  };
  const fail = (why: string) => {
    failed.add(o.id);
    console.log(`✗ ${o.id}: ${why}`);
  };
  if (!o.snippet) {
    fail("no verifiable example source (contract.test.ts or snippet.ts)");
    continue;
  }
  if (o.errors.length)
    fail(
      `snippet (${o.snippet.from}) does not compile\n    ${o.errors.slice(0, 6).join("\n    ")}`,
    );
  // Interfaces: `import` signatures as the component's own usage imports them; one that still does not compile and
  // has no real import to take is not a fact about the package and is removed.
  const badLines = new Set(
    o.signatureErrors.map((e) => signatureLines(guide.interfaces)[e.line - 1]).filter(Boolean),
  );
  const repaired = repairImportSignatures(guide.interfaces, usageSources(dir));
  const interfaces = repaired.filter(
    (r, i) =>
      !(
        badLines.has(guide.interfaces[i]?.signature.trim() ?? "") &&
        r.signature === guide.interfaces[i]?.signature
      ),
  );
  if (checkOnly && o.signatureErrors.length)
    fail(
      `interface signatures do not compile\n    ${o.signatureErrors
        .map((e) => e.error)
        .slice(0, 4)
        .join("\n    ")}`,
    );
  const want = expectedExample(o, guide.example_check, guide.example, today);
  if (!want) continue;
  const sameInterfaces = JSON.stringify(interfaces) === JSON.stringify(guide.interfaces);
  const same =
    (guide.example ?? "").replace(/\s+$/, "") === want.example.replace(/\s+$/, "") &&
    JSON.stringify(guide.example_check ?? null) === JSON.stringify(want.check) &&
    sameInterfaces;
  if (same) continue;
  if (checkOnly) {
    fail(
      "guide.yaml example, example_check or interfaces are not what was compiled — run pnpm catalog:snippets",
    );
    continue;
  }
  if (interfaces.length === 0) {
    fail("no interface signature compiles");
    continue;
  }
  if (
    writeGuideExample(guideFile, want.example, want.check, sameInterfaces ? undefined : interfaces)
  )
    written++;
}
console.log(
  `\n${outcomes.length - failed.size}/${outcomes.length} components ok · ${Object.entries(counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ")}${checkOnly ? "" : ` · ${written} guide(s) written (run again with --check)`}`,
);
process.exitCode = failed.size ? 1 : 0;

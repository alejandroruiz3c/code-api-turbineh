import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { GateFailure } from "@turbineh/verifier";

/**
 * Failure attribution (ADR-0037 §D2). A failing check is attributed to the component that owns the failing test file
 * and the files it imports (`.turbineh/owners.json`, written at assembly). Only post-assembly parts implicated by that
 * evidence can be removed by the corrector; everything else stays. Deterministic: file paths and imports, no model.
 */

/** A removable post-assembly part: glue, Backup Coder fill, business rules, or an integrated library. */
export interface SwapPart {
  capability: string;
  kind: "glue" | "backup" | "rules" | "integration";
  files: string[];
  /** npm package of an integrated library (its contract test and glue import it). */
  package?: string;
  /** Entity whose behaviour T3 rules change (its generated pages and E2E). */
  entity?: string;
}

export interface FailureAttribution {
  step: GateFailure["step"];
  test: string | null;
  file: string | null;
  line: number | null;
  /** Owner of the failing file (`component:<id>`, `recipe:<id>`, `entity:<Name>`, part owners…), or null. */
  owner: string | null;
  /** Local files the failing file imports (one level), and their owners. */
  imports: { file: string; owner: string | null }[];
  /** Capabilities of the parts implicated by this failure — the only ones a correction may remove. */
  implicated: string[];
  reason: string;
}

const OWNERS_FILE = ".turbineh/owners.json";
const EXT = [".ts", ".tsx", ".js", ".mjs", ".jsx"];

export function readOwnerMap(dir: string): Record<string, string> {
  const p = join(dir, OWNERS_FILE);
  if (!existsSync(p)) return {};
  try {
    return (JSON.parse(readFileSync(p, "utf8")) as { files?: Record<string, string> }).files ?? {};
  } catch {
    return {};
  }
}

/** Import specifiers of a source file (static, dynamic, re-exports, require). */
export function importSpecifiers(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(
    /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm,
  )) {
    const s = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (s) out.add(s);
  }
  return [...out];
}

/** Resolves a local specifier ("./x", "../x", "@/x") to a file of the package, if it exists. */
export function resolveLocal(dir: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  const candidates = [
    base,
    ...EXT.map((e) => base + e),
    ...EXT.map((e) => join(base, `index${e}`)),
    // TS ESM style: "./x.js" → x.ts
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
  ];
  return candidates.find((c) => existsSync(join(dir, c)) && !c.endsWith("/")) ?? null;
}

/** npm package name of a bare specifier ("@scope/pkg/sub" → "@scope/pkg"). */
export const packageOf = (spec: string) =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec);

function read(dir: string, file: string): string {
  try {
    return readFileSync(join(dir, file), "utf8");
  } catch {
    return "";
  }
}

/**
 * The parts a correction removes for these attributed failures: exactly the implicated ones. An integrated library
 * leaves with its glue helper; a glue helper alone leaves without its library.
 */
export function culpritsOf(parts: SwapPart[], failures: FailureAttribution[]): SwapPart[] {
  const implicated = new Set(failures.flatMap((f) => f.implicated));
  const libraries = new Set(
    parts
      .filter((p) => p.kind === "integration" && implicated.has(p.capability))
      .map((p) => p.capability),
  );
  return parts.filter((p) =>
    p.kind === "integration"
      ? libraries.has(p.capability)
      : implicated.has(p.capability) || (p.kind === "glue" && libraries.has(p.capability)),
  );
}

/** Attributes every failure to owners and implicated parts. `log` is the failing steps' output (install fallback). */
export function attributeFailures(
  dir: string,
  failures: GateFailure[],
  parts: SwapPart[],
  log = "",
): FailureAttribution[] {
  const owners = readOwnerMap(dir);
  const partOwner = new Map<string, string>();
  for (const p of parts) for (const f of p.files) partOwner.set(f, `${p.kind}:${p.capability}`);
  const ownerOf = (f: string) => partOwner.get(f) ?? owners[f] ?? null;
  return failures.map((f) => {
    if (f.step === "install" || (f.step === "migrations" && /lockfile|ERR_PNPM/i.test(log))) {
      // Dependencies changed after assembly only through integrated libraries: the ones named in the log, else all.
      const libs = parts.filter((p) => p.kind === "integration");
      const named = libs.filter((p) => p.package && log.includes(p.package));
      const implicated = (named.length ? named : libs).map((p) => p.capability);
      return {
        step: f.step,
        test: f.test,
        file: f.file,
        line: f.line,
        owner: null,
        imports: [],
        implicated,
        reason: named.length
          ? `install failed naming ${named.map((p) => p.package).join(", ")}`
          : libs.length
            ? "install failed after libraries were integrated; only they changed the dependencies"
            : "install failed; no integrated library changed the dependencies",
      };
    }
    if (!f.file) {
      return {
        step: f.step,
        test: f.test,
        file: null,
        line: f.line,
        owner: null,
        imports: [],
        implicated: [],
        reason: "no file in the failure output: nothing can be attributed, nothing is removed",
      };
    }
    const file = f.file;
    const src = read(dir, file);
    const specs = importSpecifiers(src);
    const locals = specs
      .map((s) => resolveLocal(dir, file, s))
      .filter((x): x is string => x !== null && x !== file);
    // Packages imported by the failing file and by the local files it imports.
    const packages = new Set(
      [...specs, ...locals.flatMap((l) => importSpecifiers(read(dir, l)))]
        .filter((s) => !s.startsWith(".") && !s.startsWith("@/") && !s.startsWith("node:"))
        .map(packageOf),
    );
    const related = new Set([file, ...locals]);
    const owner = ownerOf(file);
    const implicated = parts
      .filter(
        (p) =>
          p.files.some((x) => related.has(x)) ||
          (p.kind === "integration" && p.package !== undefined && packages.has(p.package)) ||
          // Business rules change the behaviour of their entity's pages: its tests implicate them.
          (p.kind === "rules" && p.entity !== undefined && owner === `entity:${p.entity}`),
      )
      .map((p) => p.capability);
    return {
      step: f.step,
      test: f.test,
      file,
      line: f.line,
      owner,
      imports: locals.map((l) => ({ file: l, owner: ownerOf(l) })),
      implicated: [...new Set(implicated)],
      reason: implicated.length
        ? `the failing file or its imports belong to ${[...new Set(implicated)].join(", ")}`
        : `the failing file belongs to ${owner ?? "no recorded owner"}; no removable part is involved`,
    };
  });
}

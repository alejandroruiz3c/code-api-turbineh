import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  componentSnippet,
  snippetPackages,
  type ExampleCheck,
  type Snippet,
} from "@turbineh/catalog/snippets";
import { sandbox } from "@turbineh/verifier";
import {
  Document,
  parse,
  parseDocument,
  Scalar,
  type Node,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import { HARNESS, TSCONFIG } from "./certify.js";

/** One component's public snippet and what the compile harness found. */
export interface SnippetOutcome {
  id: string;
  snippet: Snippet | null;
  /** Packages (name@version) the snippet compiles against (TypeScript snippets). */
  against: string[];
  /** tsc errors of the snippet; empty when it compiles. */
  errors: string[];
  /** Interface names whose `import` signature does not compile, with the error. */
  signatureErrors: { line: number; error: string }[];
}

interface Manifest {
  source: { purl: string };
  integration?: { types?: string };
}

/**
 * name → pinned version of everything a snippet may import: the catalogue's npm components (their purl and declared
 * `@types`), the contract harness (react, zod, TypeScript, types) and, for the rest of the stack apps are built on
 * (pg, next…), the saas-crud recipe template's exact pins.
 */
export function pinnedVersions(componentsDir: string): Record<string, string> {
  const template = join(componentsDir, "../recipes/saas-crud/template/package.json");
  const tpl = existsSync(template)
    ? (JSON.parse(readFileSync(template, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      })
    : {};
  const pinned: Record<string, string> = {
    ...tpl.dependencies,
    ...tpl.devDependencies,
    ...HARNESS,
  };
  for (const id of readdirSync(componentsDir).sort()) {
    const file = join(componentsDir, id, "component.yaml");
    if (!existsSync(file)) continue;
    const m = parse(readFileSync(file, "utf8")) as Manifest;
    const purl = /^pkg:npm\/(.+)@([^@]+)$/.exec(m.source.purl);
    if (purl) pinned[decodeURIComponent(purl[1] as string)] = purl[2] as string;
    const types = /^(@types\/[^@]+)@(.+)$/.exec(m.integration?.types ?? "");
    if (types?.[1] && types[2]) pinned[types[1]] = types[2];
  }
  return pinned;
}

/** The packages to install for a set of imported package names: each at its pin, plus its `@types/…` when pinned. */
export function installSet(
  names: Iterable<string>,
  pinned: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {
    typescript: pinned.typescript as string,
    "@types/node": pinned["@types/node"] as string,
  };
  for (const n of names) {
    if (pinned[n]) out[n] = pinned[n];
    const t = `@types/${n.startsWith("@") ? n.slice(1).replace("/", "__") : n}`;
    if (pinned[t]) out[t] = pinned[t];
  }
  // React types come with React; react-dom's server renderer needs react at the same pin.
  if (out.react) {
    out["@types/react"] = pinned["@types/react"] as string;
    out["@types/react-dom"] = pinned["@types/react-dom"] as string;
    out["react-dom"] = pinned["react-dom"] as string;
  }
  return out;
}

/** The `import …` interface signatures of a guide, as one module (each line must compile). */
export function signatureModule(guide: { interfaces?: { signature: string }[] }): string {
  const lines = signatureLines(guide.interfaces ?? []);
  return lines.length ? `${lines.map((l) => l.replace(/;?$/, ";")).join("\n")}\nexport {};\n` : "";
}

/** The distinct `import … from "<package>"` signatures, in order (line n of the signature module = entry n-1). */
export function signatureLines(interfaces: { signature: string }[]): string[] {
  return [
    ...new Set(
      interfaces
        .map((i) => i.signature.trim())
        .filter((s) => /^import\s.+\sfrom\s+["']([^"'@/.][^"']*|@[^"'/]+\/[^"']+)["']$/.test(s)),
    ),
  ];
}

/**
 * Compiles every TypeScript snippet (and every `import` interface signature) of the catalogue with `tsc --noEmit`,
 * one file per snippet, against the pinned versions — the contract harness (ADR-0002) settings. Install has network
 * and no secrets; the type check has none. In the sandbox container, or directly on an ephemeral CI runner
 * (`onRunner`, install with --ignore-scripts).
 */
export async function compileSnippets(
  componentsDir: string,
  opts: { onRunner?: boolean; ids?: string[] } = {},
): Promise<SnippetOutcome[]> {
  const ids = (opts.ids ?? readdirSync(componentsDir).sort()).filter((id) =>
    existsSync(join(componentsDir, id, "guide.yaml")),
  );
  const pinned = pinnedVersions(componentsDir);
  const imported = new Set<string>();
  const work = mkdtempSync(join(tmpdir(), "turbineh-snippets-"));
  mkdirSync(join(work, "snippets"));
  const outcomes: SnippetOutcome[] = [];
  for (const id of ids) {
    const dir = join(componentsDir, id);
    const guide = parse(readFileSync(join(dir, "guide.yaml"), "utf8")) as {
      example?: string;
      interfaces?: { name: string; signature: string; where?: string }[];
    };
    const snippet = componentSnippet(dir, guide.example);
    const against = snippet?.kind === "typescript" ? snippetPackages(snippet.code, pinned) : [];
    for (const a of against) imported.add(a.slice(0, a.lastIndexOf("@")));
    if (snippet?.kind === "typescript")
      writeFileSync(join(work, "snippets", `${id}.ts`), snippet.code);
    const sig = signatureModule(guide);
    if (sig) {
      writeFileSync(join(work, "snippets", `${id}.signatures.ts`), sig);
      for (const a of snippetPackages(sig, pinned)) imported.add(a.slice(0, a.lastIndexOf("@")));
    }
    outcomes.push({ id, snippet, against, errors: [], signatureErrors: [] });
  }
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify(
      {
        name: "turbineh-snippets",
        private: true,
        type: "module",
        dependencies: installSet(imported, pinned),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(work, "tsconfig.json"),
    JSON.stringify({ ...TSCONFIG, include: ["snippets/*.ts"] }, null, 2),
  );
  const install = "pnpm install --ignore-scripts --config.strict-peer-dependencies=false";
  const check = "pnpm exec tsc -p tsconfig.json --pretty false";
  let tail: string;
  if (opts.onRunner) {
    execFileSync("sh", ["-c", `${install} > /dev/null`], { cwd: work, stdio: "inherit" });
    execFileSync("sh", ["-c", `${check} > tsc.out 2>&1; echo exit=$?`], { cwd: work });
    tail = readFileSync(join(work, "tsc.out"), "utf8");
  } else {
    const i = await sandbox(work, `${install} 2>&1 | tail -5`, { network: "bridge", env: {} });
    if (i.code !== 0) throw new Error(`install failed: ${i.tail}`);
    await sandbox(work, `${check} > tsc.out 2>&1; echo exit=$?`, { network: "none", env: {} });
    tail = existsSync(join(work, "tsc.out")) ? readFileSync(join(work, "tsc.out"), "utf8") : "";
  }
  const lines = tail.split("\n");
  for (const o of outcomes) {
    o.errors.push(...lines.filter((l) => l.startsWith(`snippets/${o.id}.ts(`)));
    for (const l of lines) {
      const m = /^snippets\/(.+)\.signatures\.ts\((\d+),/.exec(l);
      if (m?.[1] === o.id) o.signatureErrors.push({ line: Number(m[2]), error: l });
    }
  }
  // Anything tsc reports outside a snippet file (configuration, a broken package) fails every snippet.
  const global = lines.filter((l) => /error TS/.test(l) && !l.startsWith("snippets/"));
  if (global.length)
    for (const o of outcomes) if (o.snippet?.kind === "typescript") o.errors.push(...global);
  return outcomes;
}

/** `example` and `example_check` of a guide as they must be: the snippet, its source and its last compile. */
export function expectedExample(
  o: SnippetOutcome,
  current: ExampleCheck | undefined,
  currentExample: string | undefined,
  today: string,
): { example: string; check: ExampleCheck } | null {
  if (!o.snippet) return null;
  const s = o.snippet;
  const check: ExampleCheck = { kind: s.kind, from: s.from };
  if (s.kind === "typescript" && o.errors.length === 0) {
    const unchanged =
      current?.compiled &&
      // guide.yaml keeps the snippet as a YAML block, which drops its trailing newline: compare without it (as the
      // --check comparison does), or the compile date would change every day and --check would fail.
      (currentExample ?? "").replace(/\s+$/, "") === s.code.replace(/\s+$/, "") &&
      current.compiled.typescript === HARNESS.typescript &&
      JSON.stringify(current.compiled.against) === JSON.stringify(o.against);
    check.compiled = unchanged
      ? (current.compiled as NonNullable<ExampleCheck["compiled"]>)
      : { against: o.against, typescript: HARNESS.typescript, on: today };
  }
  return { example: s.code, check };
}

/** A one-line scalar: plain when YAML reads it back unchanged, else double-quoted. */
function yamlScalar(v: string): string {
  return /^[A-Za-z]/.test(v) && !/: | #|\n/.test(v) && !/[:\s]$/.test(v) ? v : JSON.stringify(v);
}

/** One top-level `key: value` of a guide as YAML text (block literal for multi-line strings), ending in a newline. */
function yamlEntry(key: string, value: unknown): string {
  const doc = new Document({ [key]: value });
  if (typeof value === "string" && value.includes("\n")) {
    const node = doc.get(key, true) as Scalar;
    node.type = Scalar.BLOCK_LITERAL;
  }
  return doc.toString({ lineWidth: 110 });
}

/**
 * Writes `example` (block literal), `example_check` (right after it) and repaired interface signatures into
 * guide.yaml as text edits, so the rest of a hand-written guide keeps its exact formatting. The generated-guide
 * provenance stops listing the example as model-written.
 */
export function writeGuideExample(
  guideFile: string,
  example: string,
  check: ExampleCheck,
  interfaces?: { name: string; signature: string; where?: string }[],
): boolean {
  const before = readFileSync(guideFile, "utf8");
  let text = before;
  const doc = () => parseDocument(text);
  const lineStart = (at: number) => text.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = (at: number) => {
    const n = text.indexOf("\n", at);
    return n < 0 ? text.length : n + 1;
  };
  const topPair = (key: string) => {
    const map = doc().contents as YAMLMap<Scalar, Node>;
    return map.items.find((p) => p.key?.value === key);
  };
  /** Replaces a top-level entry (key line through the end of its value) or inserts it after `after`. */
  const setEntry = (key: string, value: unknown, after?: string) => {
    const entry = yamlEntry(key, value);
    const pair = topPair(key);
    if (pair?.key?.range && pair.value?.range) {
      const start = lineStart(pair.key.range[0]);
      const end = lineEnd(Math.max(pair.value.range[1] - 1, pair.key.range[0]));
      text = text.slice(0, start) + entry + text.slice(end);
      return;
    }
    const anchor = after ? topPair(after) : undefined;
    if (anchor?.value?.range) {
      const at = lineEnd(Math.max(anchor.value.range[1] - 1, 0));
      text = text.slice(0, at) + entry + text.slice(at);
    } else text = `${text.replace(/\n*$/, "\n")}${entry}`;
  };
  const current = (parse(text) as { example?: string }).example ?? "";
  if (current.replace(/\n+$/, "") !== example.replace(/\n+$/, ""))
    setEntry("example", example.replace(/\n+$/, ""));
  setEntry("example_check", check, "example");
  if (interfaces) {
    const seq = topPair("interfaces")?.value as YAMLSeq<YAMLMap<Scalar, Scalar>> | undefined;
    const items = seq?.items ?? [];
    const edits: { start: number; end: number; text: string }[] = [];
    items.forEach((item) => {
      const name = (item.get("name") as unknown as string | undefined) ?? "";
      const next = interfaces.find((x) => x.name === name);
      if (!item.range) return;
      if (!next) {
        edits.push({
          start: lineStart(item.range[0]),
          end: lineEnd(Math.max(item.range[1] - 1, 0)),
          text: "",
        });
        return;
      }
      for (const field of ["signature", "where"] as const) {
        const node = item.get(field, true) as Scalar | undefined;
        if (node?.range && next[field] !== undefined && node.value !== next[field])
          edits.push({
            start: node.range[0],
            end: node.range[1],
            text: yamlScalar(next[field] as string),
          });
      }
    });
    for (const e of edits.sort((a, b) => b.start - a.start))
      text = text.slice(0, e.start) + e.text + text.slice(e.end);
  }
  // Provenance of generated guides: the example is no longer model-written.
  text = text
    .replace(/^( {4}- example)\n(?=( {4}- | {2}checked:))/m, "")
    .replace(
      "    - example imports only what the component provides",
      '    - "example: the component\'s contract test or snippet.ts, compiled (example_check)"',
    );
  if (text === before) return false;
  // A text edit must leave valid YAML with exactly the intended example.
  const check2 = parseDocument(text);
  if (
    check2.errors.length ||
    (check2.toJS() as { example?: string }).example?.replace(/\n+$/, "") !==
      example.replace(/\n+$/, "")
  )
    throw new Error(
      `${guideFile}: edit would not round-trip (${check2.errors[0]?.message ?? "example differs"})`,
    );
  writeFileSync(guideFile, text);
  return true;
}

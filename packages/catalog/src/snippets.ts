import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { parse } from "yaml";
import { validateParams } from "./params.js";

/**
 * Public usage snippets (ADR-0066, audit F-04). The example a component shows — on Discover, in `/v1/capabilities`,
 * in the catalogue index and in apps (docs/components/*.md) — is never written by hand or by a model:
 *  - `typescript`: derived from the component's own contract test (the first test, its assertions turned into
 *    `console.log(value); // → expected`), or taken verbatim from its `snippet.ts`. Compiled with `tsc --noEmit`
 *    against the pinned package version (`pnpm catalog:snippets`, CI job "Snippets compile").
 *  - `app`: a `snippet.ts` that imports the component's own files through `@/…`; compiled inside the assembled apps
 *    that contain the component (`verify:recipe --all --domains --quick --snippets`, CI job "Assembled combinations").
 *  - `json`: the request parameters of a parameterised component; validated against its params.schema.json.
 *  - `shell`: CLI and HTTP calls; every `turbineh <command>` and `/v1/…` route it uses must exist.
 */
export type SnippetKind = "typescript" | "app" | "json" | "shell";

export interface Snippet {
  kind: SnippetKind;
  code: string;
  /** Where it comes from: "contract.test.ts › <title>", "snippet.ts", "params.schema.json" or "guide.yaml". */
  from: string;
}

/** Recorded in guide.yaml under `example_check` by `pnpm catalog:snippets` after a successful compile. */
export interface ExampleCheck {
  kind: SnippetKind;
  from: string;
  /** TypeScript snippets: the pinned packages and TypeScript version it compiled against, and when. */
  compiled?: { against: string[]; typescript: string; on: string };
}

const MAX_COMMENT = 70;

function oneLine(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_COMMENT ? `${t.slice(0, MAX_COMMENT - 1).trimEnd()}…` : t;
}

function phrase(matcher: string, not: boolean, args: string[]): string {
  const a = oneLine(args.join(", "));
  const neg = not ? "not " : "";
  switch (matcher) {
    case "toBe":
    case "toEqual":
    case "toStrictEqual":
      return `${neg}${a}`;
    case "toContain":
      return `${not ? "does not contain" : "contains"} ${a}`;
    case "toMatch":
      return `${not ? "does not match" : "matches"} ${a}`;
    case "toHaveLength":
      return `${neg}length ${a}`;
    case "toHaveProperty":
      return `${not ? "has no" : "has"} property ${a}`;
    case "toBeNull":
      return `${neg}null`;
    case "toBeUndefined":
      return `${neg}undefined`;
    case "toBeDefined":
      return not ? "undefined" : "defined";
    case "toBeTruthy":
      return not ? "falsy" : "truthy";
    case "toBeFalsy":
      return not ? "truthy" : "falsy";
    case "toBeGreaterThan":
      return `${neg}> ${a}`;
    case "toBeGreaterThanOrEqual":
      return `${neg}>= ${a}`;
    case "toBeLessThan":
      return `${neg}< ${a}`;
    case "toBeLessThanOrEqual":
      return `${neg}<= ${a}`;
    case "toBeInstanceOf":
      return `${neg}instance of ${a}`;
    case "toThrow":
      return not ? "does not throw" : a ? `throws ${a}` : "throws";
    default:
      return `${neg}${matcher}${a ? ` ${a}` : ""}`;
  }
}

interface ExpectChain {
  subject: ts.Expression;
  not: boolean;
  mode: "" | "rejects" | "resolves";
  matcher: string;
  args: ts.Expression[];
}

/** `expect(x).not.rejects.toBe(y)` (possibly awaited) → its parts; null when the expression is not an assertion. */
function expectChain(expr: ts.Expression): ExpectChain | null {
  let e = expr;
  if (ts.isAwaitExpression(e)) e = e.expression;
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression)) return null;
  const matcher = e.expression.name.text;
  const args = [...e.arguments];
  let not = false;
  let mode: ExpectChain["mode"] = "";
  let cur: ts.Expression = e.expression.expression;
  while (ts.isPropertyAccessExpression(cur)) {
    const n = cur.name.text;
    if (n === "not") not = true;
    else if (n === "rejects" || n === "resolves") mode = n;
    else return null;
    cur = cur.expression;
  }
  if (
    !ts.isCallExpression(cur) ||
    !ts.isIdentifier(cur.expression) ||
    cur.expression.text !== "expect" ||
    !cur.arguments[0]
  )
    return null;
  return { subject: cur.arguments[0], not, mode, matcher, args };
}

function isExpectStatement(s: ts.Statement): s is ts.ExpressionStatement {
  return ts.isExpressionStatement(s) && expectChain(s.expression) !== null;
}

/** The statements of a function body (block or concise arrow). */
function bodyText(fn: ts.Expression, src: ts.SourceFile): string | null {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  if (ts.isBlock(fn.body)) {
    return fn.body.statements.map((s) => s.getText(src)).join("\n");
  }
  return `${fn.body.getText(src)};`;
}

/** An assertion statement as plain code: the value it checks, logged, with the expectation as a comment. */
/**
 * `pad` is the statement's own indentation: lines this function writes get it, lines copied from the test keep
 * theirs (absolute in the file), so the caller's dedent treats both alike.
 */
function rewriteAssertion(s: ts.ExpressionStatement, src: ts.SourceFile, pad: string): string {
  const c = expectChain(s.expression) as ExpectChain;
  const text = (n: ts.Node) => n.getText(src);
  const args = c.args.map(text);
  const comment = phrase(c.matcher, c.not, args);
  if (c.matcher === "toThrow" && c.mode === "") {
    const body = bodyText(c.subject, src) ?? `(${text(c.subject)})();`;
    if (c.not) return `${body} // ${comment}`;
    return `try {\n${pad}  ${body.split("\n").join("\n  ")}\n${pad}} catch (err) {\n${pad}  console.log(err); // → ${comment}\n${pad}}`;
  }
  if (c.mode === "rejects") {
    const subject = bodyText(c.subject, src) !== null ? `(${text(c.subject)})()` : text(c.subject);
    return `await ${subject}.catch((err: unknown) => console.log(err)); // → rejects: ${comment}`;
  }
  if (c.mode === "resolves") return `console.log(await ${text(c.subject)}); // → ${comment}`;
  return `console.log(${text(c.subject)}); // → ${comment}`;
}

function callName(e: ts.Expression): string | null {
  if (!ts.isCallExpression(e)) return null;
  const f = e.expression;
  if (ts.isIdentifier(f)) return f.text;
  if (ts.isPropertyAccessExpression(f) && ts.isIdentifier(f.expression))
    return `${f.expression.text}.${f.name.text}`;
  return null;
}

function stringArg(e: ts.CallExpression): string {
  const a = e.arguments[0];
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : "";
}

/** Indentation-preserving re-indent of a statement's text (it keeps its own inner layout). */
function dedent(text: string, column: number): string {
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? l : l.slice(Math.min(column, l.length - l.trimStart().length))))
    .join("\n");
}

/** A statement's text with every assertion inside it (loops, blocks) rewritten, indentation kept. */
function statementText(s: ts.Statement, src: ts.SourceFile): string {
  const col = (n: ts.Node) => src.getLineAndCharacterOfPosition(n.getStart(src)).character;
  if (isExpectStatement(s)) return dedent(rewriteAssertion(s, src, " ".repeat(col(s))), col(s));
  const nested: ts.ExpressionStatement[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStatement(n) && isExpectStatement(n)) nested.push(n);
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(s, visit);
  const start = s.getStart(src);
  let text = s.getText(src);
  for (const n of nested.sort((a, b) => b.getStart(src) - a.getStart(src))) {
    const replacement = rewriteAssertion(n, src, " ".repeat(col(n)));
    text = text.slice(0, n.getStart(src) - start) + replacement + text.slice(n.getEnd() - start);
  }
  return dedent(text, col(s));
}

/**
 * The usage snippet of a contract test: imports (vitest removed, unused names pruned), declarations at file and
 * `describe` level, then the body of the first test with each assertion turned into `console.log(value); // → …`.
 * Deterministic: the same test always gives the same snippet.
 */
export function snippetFromContract(source: string): { code: string; title: string } | null {
  const src = ts.createSourceFile("contract.test.ts", source, ts.ScriptTarget.Latest, true);
  const imports: ts.ImportDeclaration[] = [];
  const decls: string[] = [];
  let test: { title: string; fn: ts.Expression } | null = null;

  const visitLevel = (statements: readonly ts.Statement[]) => {
    for (const s of statements) {
      if (ts.isImportDeclaration(s)) {
        imports.push(s);
        continue;
      }
      if (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression)) {
        const name = callName(s.expression);
        if (name === "describe" || name === "describe.sequential") {
          const fn = s.expression.arguments[1];
          if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isBlock(fn.body))
            visitLevel(fn.body.statements);
          continue;
        }
        if (name === "it" || name === "test") {
          const fn = s.expression.arguments[1];
          if (!test && fn) test = { title: stringArg(s.expression), fn };
          continue;
        }
        if (name && /^(before|after)(All|Each)$/.test(name)) continue;
      }
      decls.push(statementText(s, src));
    }
  };
  visitLevel(src.statements);
  const found = test as { title: string; fn: ts.Expression } | null;
  if (!found) return null;
  const fn = found.fn;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  const body = ts.isBlock(fn.body)
    ? fn.body.statements.map((s) => statementText(s, src))
    : [`${fn.body.getText(src)};`];
  const code = [...decls, ...body].join("\n");
  const used = (name: string) =>
    new RegExp(`(^|[^\\w$.])${name.replace(/\$/g, "\\$")}\\b`).test(code);

  const importLines = imports.flatMap((d) => {
    const from = (d.moduleSpecifier as ts.StringLiteral).text;
    if (from === "vitest") return [];
    const clause = d.importClause;
    if (!clause) return [d.getText(src)];
    const typeOnly = clause.isTypeOnly ? "type " : "";
    const parts: string[] = [];
    if (clause.name && used(clause.name.text)) parts.push(clause.name.text);
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) {
      if (used(nb.name.text)) parts.push(`* as ${nb.name.text}`);
    } else if (nb) {
      const names = nb.elements.filter((el) => used(el.name.text)).map((el) => el.getText(src));
      if (names.length) parts.push(`{ ${names.join(", ")} }`);
    }
    return parts.length ? [`import ${typeOnly}${parts.join(", ")} from "${from}";`] : [];
  });
  return { code: `${[...importLines, "", code].join("\n").trim()}\n`, title: found.title };
}

const JSON_COMMENT = /^\s*\/\/.*$/gm;

/** The snippet a component shows, from its own files (see the module comment), or null without a usable source. */
export function componentSnippet(componentDir: string, currentExample?: string): Snippet | null {
  const own = join(componentDir, "snippet.ts");
  if (existsSync(own)) {
    const code = readFileSync(own, "utf8");
    return {
      kind: /from\s+["']@\//.test(code) ? "app" : "typescript",
      code: code.endsWith("\n") ? code : `${code}\n`,
      from: "snippet.ts",
    };
  }
  const contract = join(componentDir, "contract.test.ts");
  if (existsSync(contract)) {
    const s = snippetFromContract(readFileSync(contract, "utf8"));
    if (s) return { kind: "typescript", code: s.code, from: `contract.test.ts › ${s.title}` };
  }
  if (currentExample === undefined) return null;
  if (isJsonExample(currentExample) && existsSync(join(componentDir, "params.schema.json")))
    return { kind: "json", code: currentExample, from: "params.schema.json" };
  if (/^\s*(#|turbineh\s|curl\s)/m.test(currentExample) && !/^\s*import\s/m.test(currentExample))
    return { kind: "shell", code: currentExample, from: "guide.yaml" };
  return null;
}

/** A params example: one JSON object after optional `//` comment lines (comments may also follow it). */
export function isJsonExample(example: string): boolean {
  try {
    const v: unknown = JSON.parse(example.replace(JSON_COMMENT, ""));
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
}

export function jsonExampleValue(example: string): Record<string, unknown> {
  return JSON.parse(example.replace(JSON_COMMENT, "")) as Record<string, unknown>;
}

/** `turbineh <command>` invocations and `/v1/…` paths a shell example uses (for the existence check). */
export function shellReferences(example: string): { commands: string[]; routes: string[] } {
  const commands = [...example.matchAll(/^\s*turbineh\s+([a-z][a-z-]*)/gm)].map(
    (m) => m[1] as string,
  );
  const routes = [...example.matchAll(/(\/v1\/[A-Za-z0-9_/${}.-]+)/g)].map((m) =>
    (m[1] as string).replace(/\/$/, ""),
  );
  return { commands: [...new Set(commands)], routes: [...new Set(routes)] };
}

/** The npm packages (name@version) a TypeScript snippet compiles against: its bare imports, at the pinned versions. */
export function snippetPackages(code: string, pinned: Record<string, string>): string[] {
  const specs = [...code.matchAll(/from\s+["']([^"'./@][^"']*|@[^"'/]+\/[^"']+)["']/g)].map(
    (m) => m[1] as string,
  );
  const names = specs.map((s) =>
    s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : (s.split("/")[0] as string),
  );
  return [...new Set(names)]
    .filter((n) => pinned[n])
    .sort()
    .map((n) => `${n}@${pinned[n]}`);
}

/** Every name a module imports, with the exact import statement that brings it (default, named or namespace). */
export function importStatements(
  source: string,
): Map<string, { signature: string; where: string }> {
  const src = ts.createSourceFile("s.ts", source, ts.ScriptTarget.Latest, true);
  const out = new Map<string, { signature: string; where: string }>();
  for (const s of src.statements) {
    if (!ts.isImportDeclaration(s) || !s.importClause) continue;
    const where = (s.moduleSpecifier as ts.StringLiteral).text;
    if (where === "vitest") continue;
    const type = s.importClause.isTypeOnly ? "type " : "";
    const c = s.importClause;
    if (c.name)
      out.set(c.name.text, { signature: `import ${type}${c.name.text} from "${where}"`, where });
    const nb = c.namedBindings;
    if (nb && ts.isNamespaceImport(nb))
      out.set(nb.name.text, {
        signature: `import ${type}* as ${nb.name.text} from "${where}"`,
        where,
      });
    else if (nb)
      for (const el of nb.elements) {
        const imported = (el.propertyName ?? el.name).text;
        const elType = type || (el.isTypeOnly ? "type " : "");
        out.set(imported, { signature: `import ${elType}{ ${imported} } from "${where}"`, where });
      }
  }
  return out;
}

/**
 * Interface signatures written as an import statement are replaced by the import the component's own contract test
 * or snippet really uses (default vs named export, subpath), so they compile. Other signatures are left as they are.
 */
export function repairImportSignatures<
  T extends { name: string; signature: string; where?: string },
>(interfaces: T[], sources: string[]): T[] {
  const known = new Map<string, { signature: string; where: string }>();
  for (const s of sources)
    for (const [k, v] of importStatements(s)) if (!known.has(k)) known.set(k, v);
  return interfaces.map((i) => {
    if (!/^import\s/.test(i.signature.trim())) return i;
    const real = known.get(i.name.replace(/\(.*$/, "").trim());
    return real ? { ...i, signature: real.signature, where: real.where } : i;
  });
}

/** The full sources a component's usage comes from (contract test and snippet.ts), for signature repair. */
export function usageSources(componentDir: string): string[] {
  return ["contract.test.ts", "snippet.ts"]
    .map((f) => join(componentDir, f))
    .filter((f) => existsSync(f))
    .map((f) => readFileSync(f, "utf8"));
}

/** Commands the `turbineh` CLI registers (packages/cli/src/registry.ts). */
function cliCommands(repoRoot: string): Set<string> {
  const f = join(repoRoot, "packages/cli/src/registry.ts");
  if (!existsSync(f)) return new Set();
  const body = /export const COMMANDS[^{]*\{([^}]*)\}/.exec(readFileSync(f, "utf8"))?.[1] ?? "";
  return new Set([...body.matchAll(/([a-z]+)\s*[,:]/g)].map((m) => m[1] as string));
}

/** `/v1/…` routes of the product API (apps/web/src/app/v1), with `[param]` segments. */
function apiRoutes(repoRoot: string): string[][] {
  const base = join(repoRoot, "apps/web/src/app");
  const out: string[][] = [];
  const walk = (dir: string, segs: string[]) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), [...segs, e.name]);
      else if (e.name === "route.ts") out.push(segs);
    }
  };
  walk(join(base, "v1"), ["v1"]);
  return out;
}

function routeExists(path: string, routes: string[][]): boolean {
  const segs = path.replace(/^\//, "").split("/");
  return routes.some(
    (r) =>
      r.length === segs.length &&
      r.every((x, i) => x === segs[i] || /^\[.+\]$/.test(x) || /^\$|^\{/.test(segs[i] ?? "")),
  );
}

/**
 * Checks a guide's example and `example_check` without installing anything (catalog:validate and unit tests):
 *  - the example is exactly the snippet derived from the component's own files, and `example_check` names its kind
 *    and source; TypeScript snippets carry the compile record (`compiled`) of `pnpm catalog:snippets`;
 *  - JSON examples satisfy the component's params schema; shell examples only use CLI commands and API routes that
 *    exist. Compilation itself is the job of `pnpm catalog:snippets --check` (CI).
 */
export function exampleErrors(componentDir: string, repoRoot: string): string[] {
  const file = join(componentDir, "guide.yaml");
  if (!existsSync(file)) return [];
  const g = parse(readFileSync(file, "utf8")) as {
    example?: string;
    example_check?: ExampleCheck;
  };
  const s = componentSnippet(componentDir, g.example);
  if (!s)
    return [
      "guide.yaml: the example has no verifiable source — add a contract.test.ts or a snippet.ts (ADR-0066)",
    ];
  const errors: string[] = [];
  const norm = (x: string | undefined) => (x ?? "").replace(/\s+$/, "");
  if (norm(g.example) !== norm(s.code))
    errors.push(
      `guide.yaml: example differs from the snippet derived from ${s.from} — run pnpm catalog:snippets`,
    );
  if (g.example_check?.kind !== s.kind || g.example_check?.from !== s.from)
    errors.push(
      `guide.yaml: example_check must be { kind: ${s.kind}, from: ${s.from} } — run pnpm catalog:snippets`,
    );
  if (s.kind === "typescript" && !g.example_check?.compiled)
    errors.push(
      "guide.yaml: example_check.compiled missing (snippet not compiled) — run pnpm catalog:snippets",
    );
  if (s.kind === "json") {
    const bad = validateParams(componentDir, jsonExampleValue(s.code));
    if (bad.length)
      errors.push(`guide.yaml: JSON example does not satisfy the params schema: ${bad.join("; ")}`);
  }
  if (s.kind === "shell") {
    const refs = shellReferences(s.code);
    const commands = cliCommands(repoRoot);
    for (const c of refs.commands)
      if (!commands.has(c))
        errors.push(`guide.yaml: example uses \`turbineh ${c}\`, not a CLI command`);
    const routes = apiRoutes(repoRoot);
    for (const r of refs.routes)
      if (!routeExists(r, routes)) errors.push(`guide.yaml: example calls ${r}, not an API route`);
  }
  return errors;
}

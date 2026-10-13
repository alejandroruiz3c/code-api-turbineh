import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProofAlias } from "@turbineh/shared";
import { parse } from "yaml";

/**
 * Criteria aliases (ADR-0047). A domain component's tests use generic words ("customer", "staff member", "record");
 * the request names them its own way ("patient", "physiotherapist", "piece"). A component declares, in
 * `aliases.yaml`, which of its params hold this app's word for each generic one. The assembler resolves them from the
 * params the app ships and attaches them to the proofs of that component's tests only. Facts (service names,
 * prices…) are declared with `asserted`: they count only when the test asserts the values read from params.
 *
 *   file: src/bookings/params.json            # the component's params in the app
 *   tests: [tests/e2e/booking-assistant.spec.ts]
 *   aliases:
 *     - { term: customer, from: customer.singular }
 *     - { term: service, from: "services[].name", asserted: "params\\.services" }
 */
export interface AliasDeclaration {
  file: string;
  tests: string[];
  aliases: { term: string; from: string | string[]; asserted?: string }[];
}

export interface ResolvedAliases {
  component: string;
  tests: string[];
  aliases: ProofAlias[];
}

const JSON_PATH = ".turbineh/aliases.json";

export function readAliasDeclaration(componentDir: string): AliasDeclaration | null {
  const file = join(componentDir, "aliases.yaml");
  if (!existsSync(file)) return null;
  const raw = parse(readFileSync(file, "utf8")) as Partial<AliasDeclaration> | null;
  if (
    !raw ||
    typeof raw.file !== "string" ||
    !Array.isArray(raw.tests) ||
    !Array.isArray(raw.aliases)
  )
    throw new Error(`${file}: expected { file, tests[], aliases[] }`);
  return raw as AliasDeclaration;
}

/** Values at a params path: "customer.singular", "services[].name", "workflows[].states[].label". */
export function valuesAt(obj: unknown, path: string): string[] {
  let cur: unknown[] = [obj];
  for (const part of path.split(".")) {
    const many = part.endsWith("[]");
    const key = many ? part.slice(0, -2) : part;
    cur = cur.flatMap((o) => {
      const v = o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined;
      return many ? (Array.isArray(v) ? v : []) : [v];
    });
  }
  return cur
    .filter((v) => typeof v === "string" || typeof v === "number")
    .map((v) => String(v).trim())
    .filter(Boolean);
}

/** The declaration resolved against the params this app ships; null when the app has no such params file. */
export function resolveAliases(
  component: string,
  decl: AliasDeclaration,
  outDir: string,
): ResolvedAliases | null {
  const file = join(outDir, decl.file);
  if (!existsSync(file)) return null;
  const params = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const aliases = decl.aliases
    .map((a) => ({
      term: a.term,
      means: [
        ...new Set(
          (Array.isArray(a.from) ? a.from : [a.from])
            .flatMap((p) => valuesAt(params, p))
            .map((v) => v.toLowerCase()),
        ),
      ].filter((m) => m !== a.term.toLowerCase()),
      ...(a.asserted ? { asserted: a.asserted } : {}),
    }))
    .filter((a) => a.means.length > 0);
  return { component, tests: decl.tests, aliases };
}

/** Resolved aliases of every selected component that declares them (written to .turbineh/aliases.json). */
export function componentAliases(
  componentsDir: string,
  componentIds: string[],
  outDir: string,
): ResolvedAliases[] {
  return componentIds.flatMap((id) => {
    const decl = readAliasDeclaration(join(componentsDir, id));
    const r = decl ? resolveAliases(id, decl, outDir) : null;
    return r ? [r] : [];
  });
}

export function writeAliases(outDir: string, resolved: ResolvedAliases[]): void {
  const p = join(outDir, JSON_PATH);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(resolved, null, 2)}\n`);
}

/** Aliases that apply to one shipped test file (from .turbineh/aliases.json, or the given list). */
export function aliasesFor(
  file: string,
  resolved: ResolvedAliases[] | string,
): ProofAlias[] | undefined {
  let list: ResolvedAliases[] = [];
  if (typeof resolved === "string") {
    const p = join(resolved, JSON_PATH);
    if (existsSync(p)) list = JSON.parse(readFileSync(p, "utf8")) as ResolvedAliases[];
  } else list = resolved;
  const found = list.filter((r) => r.tests.includes(file)).flatMap((r) => r.aliases);
  return found.length ? found : undefined;
}

/**
 * Actor aliases of a recipe (ADR-0048): the words requests use for the role the recipe's own tests act as, declared
 * by the recipe from its role model (`aliases.yaml` › `actors`, each with why it holds). Example: in the storefront the
 * E2E owner is the shop's administrator (verified ADMIN_EMAILS staff, the only role with the admin area), so a
 * criterion about "an administrator" is the owner's. Never inferred from free text.
 */
export interface ActorAlias {
  term: string;
  means: string[];
  why: string;
}

export function readRecipeActors(recipeDir: string): ActorAlias[] {
  const file = join(recipeDir, "aliases.yaml");
  if (!existsSync(file)) return [];
  const raw = parse(readFileSync(file, "utf8")) as { actors?: Partial<ActorAlias>[] } | null;
  return (raw?.actors ?? []).map((a) => {
    if (
      typeof a.term !== "string" ||
      !Array.isArray(a.means) ||
      typeof a.why !== "string" ||
      !a.why.trim()
    )
      throw new Error(`${file}: each actor needs term, means[] and why`);
    return { term: a.term, means: a.means.map(String), why: a.why };
  });
}

/**
 * Actor aliases of this app: the recipe chain's declared ones plus the request's role matrix (ADR-0044) — the stored
 * "owner" role named the way the request names it ("Manager"). Applied to the recipe's and the generated tests (not to
 * components', which declare their own).
 */
export function actorAliases(
  recipeDirs: string[],
  matrixLabels: { owner?: string | undefined; admin?: string | undefined } = {},
): ProofAlias[] {
  const out = new Map<string, Set<string>>();
  const add = (term: string, means: string[]) => {
    const set = out.get(term) ?? new Set<string>();
    for (const m of means) if (m.trim() && m.toLowerCase() !== term) set.add(m.toLowerCase());
    out.set(term, set);
  };
  for (const d of recipeDirs)
    for (const a of readRecipeActors(d)) add(a.term.toLowerCase(), a.means);
  if (matrixLabels.owner) add("owner", [matrixLabels.owner]);
  if (matrixLabels.admin) add("admin", [matrixLabels.admin]);
  return [...out]
    .filter(([, m]) => m.size > 0)
    .map(([term, means]) => ({ term, means: [...means] }));
}

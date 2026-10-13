/**
 * Requirements of required components (ADR-0048): a component the build requires may itself require another one
 * (ui.kanban → domain.workflow). The requirement is required too, and gets the request's parameters when the fidelity
 * output has them (a workflow from the board's columns stated in the request); otherwise it keeps its shipped
 * defaults and the package says so under AGENTS.md "What is left".
 */
import { join } from "node:path";
import { readParamsDecl, validateParams } from "@turbineh/catalog";
import {
  PATTERN_CAPABILITIES,
  type DomainSelection,
  type PatternId,
  type WiredPattern,
} from "@turbineh/compiler";

export interface CatalogEntry {
  id: string;
  status: string;
  provides: string[];
  requires?: string[];
}

const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "s_$1")
    .slice(0, 40) || "item";
const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const FINAL = /^(done|closed|completed?|finished|sold|archived|resolved|delivered)$/i;

/**
 * A workflow (domain.workflow params) from a board the request describes: its entity and columns, in order. Moves go
 * forward and back between neighbouring columns for any member; a final-looking last column ("done") ends it.
 */
export function workflowFromBoard(board: Record<string, unknown>): Record<string, unknown> | null {
  const columns = Array.isArray(board.columns)
    ? (board.columns as unknown[]).filter(
        (c): c is string => typeof c === "string" && c.trim() !== "",
      )
    : [];
  const keys = [...new Set(columns.map(snake))];
  if (keys.length < 2) return null;
  const entity = typeof board.entity === "string" && board.entity ? board.entity : "Item";
  const label = cap(words(entity).toLowerCase());
  const states = keys.map((key, i) => ({
    key,
    label: cap(words(key)),
    limitHours: null,
    final: i === keys.length - 1 && FINAL.test(key),
  }));
  const transitions = keys.slice(0, -1).flatMap((from, i) => {
    const to = keys[i + 1] as string;
    const back = states[i + 1]?.final
      ? []
      : [{ from: [to], to: from, label: `Back to ${cap(words(from))}`, roles: ["*"] }];
    return [{ from: [from], to, label: `Move to ${cap(words(to))}`, roles: ["*"] }, ...back];
  });
  return {
    workflows: [
      {
        key: snake(entity),
        label,
        plural: `${label}s`.replace(/ys$/, "ies").replace(/ss$/, "sses"),
        initial: keys[0],
        dueDate: board.highlightOverdue === true,
        createRoles: ["*"],
        ...(typeof board.field === "string" && board.field ? { stateNoun: board.field } : {}),
        states,
        transitions,
      },
    ],
  };
}

/** Params for a requirement from the request's patterns, when they say enough. */
function paramsFromPatterns(id: string, patterns: readonly WiredPattern[]) {
  if (id === "domain.workflow.turbineh") {
    const board = patterns.find((p) => p.id === "kanban");
    return board ? workflowFromBoard(board.params) : null;
  }
  return null;
}

/**
 * Adds to `required` (capability → component id) every requirement of a required component, transitively. Returns the
 * domain selections that carry request params for them, and the patterns to report when they keep their defaults.
 */
export function requireRequirements(input: {
  required: Record<string, string>;
  catalog: readonly CatalogEntry[];
  componentsDir: string;
  recipe: string;
  patterns: readonly WiredPattern[];
  /** Components that already have params from the request. */
  parameterised: ReadonlySet<string>;
}): { domains: DomainSelection[]; defaults: WiredPattern[] } {
  const domains: DomainSelection[] = [];
  const defaults: WiredPattern[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const id of Object.values(input.required)) {
      for (const r of input.catalog.find((x) => x.id === id)?.requires ?? []) {
        const c = input.catalog.find((x) => x.id === r && x.status === "approved");
        if (!c || Object.values(input.required).includes(r)) continue;
        const capability = c.provides[0] ?? r;
        input.required[capability] = r;
        changed = true;
        if (input.parameterised.has(r)) continue;
        const dir = join(input.componentsDir, r);
        const decl = readParamsDecl(dir);
        if (!decl) continue;
        const params = paramsFromPatterns(r, input.patterns);
        if (params && validateParams(dir, params).length === 0) {
          domains.push({
            id: r.split(".")[1] ?? r,
            capability,
            component: r,
            recipes: [input.recipe],
            paramsFile: decl.file,
            params,
            providedEntities: decl.entities ?? [],
            assumptions: [
              `${r} is required by ${id}; its states come from the board the request describes.`,
            ],
          });
        } else {
          const pattern = (Object.entries(PATTERN_CAPABILITIES).find(([, caps]) =>
            caps.some((x) => c.provides.includes(x)),
          )?.[0] ?? "workflow") as PatternId;
          defaults.push({
            id: pattern,
            status: "missing",
            component: r,
            reason:
              pattern === "workflow"
                ? `workflow states not specified; using defaults (${r} is required by ${id})`
                : `${r} is required by ${id}; its settings are not specified, using defaults`,
            capabilities: [capability],
            params: {},
            where: [decl.file],
            how: `Write the request's states, transitions and roles in ${decl.file} (validated at start-up); ${id} follows them.`,
          });
        }
      }
    }
  }
  return { domains, defaults };
}

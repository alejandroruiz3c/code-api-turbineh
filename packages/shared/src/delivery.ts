/**
 * The delivery manifest (ADR-0064): the one source of truth of what a flow decides and delivers. The plan, the result,
 * "Next steps", DEPLOY.md, AGENTS.md, turbineh.json, the web UI and the CLI are all rendered from it, and
 * `checkConsistency` compares every one of those surfaces with it — so two surfaces can never disagree silently.
 *
 * Every capability in it records WHY it is there (`justifiedBy`: a criterion of the request, a requirement stated in
 * the request, a transversal requirement every app has, the covered use case, or another component that needs it).
 * Nothing is selected for its own sake: a capability nothing justifies is left out (`notSelected`), and an approved
 * promise the delivered package does not keep is a broken promise — never "verified".
 *
 * Pure (no I/O): the worker builds and reconciles it, the web and the CLI only read it.
 */

export const DELIVERY_SCHEMA = "turbineh.delivery/v1" as const;
export const DELIVERY_FILE = ".turbineh/delivery.json";

/** Requirements every app has, whatever the request says (declared per recipe in recipe.yaml `transversal`). */
export type TransversalRequirement = "auth" | "security" | "persistence" | "interface";

export const TRANSVERSAL_LABELS: Record<TransversalRequirement, string> = {
  auth: "sign-in, workspaces and roles (every app)",
  security: "security pack (every app)",
  persistence: "stored data (every app)",
  interface: "screens for the requested data (every app)",
};

export interface Justification {
  /**
   * criterion: an acceptance criterion of the request (ref = its text); requirement: a sentence of the request or a
   * non-functional requirement it states (ref = that text); transversal: a requirement every app has (ref =
   * TransversalRequirement); use_case: the covered use case the request was matched to (ref = recipe id); required_by:
   * another selected component needs it (ref = that component id).
   */
  kind: "criterion" | "requirement" | "transversal" | "use_case" | "required_by";
  ref: string;
}

/** How a capability is delivered. */
export type DeliveryWay =
  /** A verified catalogue component. */
  | "component"
  /** Implemented by the use case's template itself. */
  | "recipe"
  /** No verified component: TurbineH writes it and verifies it with the rest (not catalogue-verified). */
  | "written"
  /** Not included in this build (the reason says why). Never a promise. */
  | "not_included";

export interface ManifestEntry {
  capability: string;
  /** Plain-language name, the one every surface shows. */
  label: string;
  way: DeliveryWay;
  /** Component id when `way` is "component". */
  component: string | null;
  /** Why it is in the build (at least one, except for `not_included`). */
  justifiedBy: Justification[];
  /** Before generation "planned"; after it, whether the delivered package has it. */
  status: "planned" | "delivered" | "not_delivered";
  /** Why it is not included or was not delivered. */
  reason?: string;
}

export interface EnvSetting {
  name: string;
  about: string;
}

export interface Footprint {
  /** Source lines (ts, tsx, mjs, css) of the delivered app. */
  lines: number;
  /** Lines of files no criterion or transversal requirement links to. */
  unlinkedLines: number;
  /** unlinkedLines / lines. */
  share: number;
  /** Components the manifest cannot justify (should always be empty). */
  unlinkedComponents: string[];
  /** Up to 20 unlinked files, largest first. */
  unlinkedFiles: { path: string; lines: number; owner: string }[];
  /** Recipe or component modules removed because nothing in the request asked for them (tree-shaking). */
  removedModules: { module: string; files: number; lines: number }[];
}

export interface DeliveryManifest {
  schema: typeof DELIVERY_SCHEMA;
  recipe: string;
  /** True when the person approved this manifest as a plan before generation: its promises are binding. */
  approved: boolean;
  entries: ManifestEntry[];
  /** The request's acceptance criteria, in order, exactly as compiled. */
  criteria: string[];
  /**
   * After generation: the criteria no passing test of the package proves (the same list as turbineh.json,
   * ACCEPTANCE.md and the result's "what is left"). Absent before generation.
   */
  criteriaOpen?: string[];
  /** Settings of the app from its single env schema (src/env.ts + the declared component settings). */
  env: { required: EnvSetting[]; optional: EnvSetting[] };
  /** Capabilities considered but left out because no requirement of the request justifies them. */
  notSelected: { capability: string; label: string; reason: string }[];
  /** Promises of the approved plan the delivered package does not keep. Non-empty ⇒ never "verified". */
  brokenPromises: { capability: string; label: string; promised: string; reason: string }[];
  footprint?: Footprint;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the manifest (every surface uses these, never its own logic)
// ---------------------------------------------------------------------------------------------------------------

/** Component ids the manifest decides (one decision each), in order. */
export const decidedComponents = (m: DeliveryManifest): string[] =>
  unique(m.entries.flatMap((e) => (e.way === "component" && e.component ? [e.component] : [])));

/** Component ids in the delivered package (after reconciliation; before it, the decided ones). */
export const deliveredComponents = (m: DeliveryManifest): string[] =>
  unique(
    m.entries.flatMap((e) =>
      e.way === "component" && e.component && e.status !== "not_delivered" ? [e.component] : [],
    ),
  );

/** Capabilities the package does not include: never decided as included, or not delivered. */
export const notIncluded = (m: DeliveryManifest): ManifestEntry[] =>
  m.entries.filter((e) => e.way === "not_included" || e.status === "not_delivered");

/** Capabilities the package includes (decided, and delivered once reconciled). */
export const included = (m: DeliveryManifest): ManifestEntry[] =>
  m.entries.filter((e) => e.way !== "not_included" && e.status !== "not_delivered");

/** What the plan promises for an entry, in the words every surface uses. */
export function promiseOf(e: Pick<ManifestEntry, "way" | "component" | "label">): string {
  switch (e.way) {
    case "component":
      return `verified component ${e.component}`;
    case "recipe":
      return "implemented by the use case's template";
    case "written":
      return "no verified component yet — TurbineH writes it and verifies it with the rest (not catalogue-verified)";
    default:
      return "not included";
  }
}

/** One justification in plain words ("criterion «…»", "transversal: security pack (every app)"…). */
export function justificationText(j: Justification): string {
  switch (j.kind) {
    case "criterion":
      return `criterion «${j.ref}»`;
    case "requirement":
      return `requirement «${j.ref}»`;
    case "transversal":
      return `transversal: ${TRANSVERSAL_LABELS[j.ref as TransversalRequirement] ?? j.ref}`;
    case "use_case":
      return `the ${j.ref} use case`;
    case "required_by":
      return `needed by ${j.ref}`;
  }
}

/** "Why" of a decision: what it is and which requirement justifies it. */
export const whyOf = (e: ManifestEntry): string =>
  e.justifiedBy.length
    ? `Justified by ${e.justifiedBy.map(justificationText).join("; ")}.`
    : "Nothing in the request justifies it.";

/** True when a justification links to the request (criterion or stated requirement) or a transversal requirement. */
export const linksToRequest = (j: Justification): boolean => j.kind !== "required_by";

// ---------------------------------------------------------------------------------------------------------------
// Single env schema
// ---------------------------------------------------------------------------------------------------------------

/**
 * The app's settings from its single env schema: `src/env.ts` (Zod: required unless `.optional()` / `.default(`;
 * a setting a cross-setting rule requires — `path: ["X"]` in a refinement — is required too), then every setting the
 * app's `.env.example` declares beyond it (component settings). A setting whose `.env.example` description starts
 * with "Required" is required (a component declares what its feature cannot work without, e.g. the staff list of a
 * booking calendar); every other one is optional. Descriptions come from the `.env.example` comments (the last
 * declaration of a setting wins, as in dotenv).
 */
export function appSettings(input: { envTs: string; envExample: string }): DeliveryManifest["env"] {
  const comments = new Map<string, string>();
  const order: string[] = [];
  let block = "";
  let afterSetting = false;
  for (const raw of input.envExample.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      const text = line.replace(/^#\s*/, "");
      block = block && !afterSetting ? `${block} ${text}` : text;
      afterSetting = false;
      continue;
    }
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m?.[1]) {
      if (!comments.has(m[1])) order.push(m[1]);
      // The last declaration wins (as in dotenv): a component that appends a setting again describes it for this app.
      if (block || !comments.has(m[1])) comments.set(m[1], block);
      // A comment block describes the setting right below it (as DEPLOY.md always read it).
      block = "";
      afterSetting = true;
      continue;
    }
    if (line === "") {
      block = "";
      afterSetting = false;
    }
  }
  // The first comment of a file is its header ("Copy to .env.local…"): never a description.
  const about = (name: string) =>
    (comments.get(name) ?? "").replace(
      /^Copy to \.env\.local[^.]*\.\s*Never commit real values\.\s*/i,
      "",
    );
  const required: EnvSetting[] = [];
  const optional: EnvSetting[] = [];
  const seen = new Set<string>();
  const refined = new Set(
    [...input.envTs.matchAll(/path:\s*\[\s*"([A-Z][A-Z0-9_]*)"\s*\]/g)].map((m) => m[1] as string),
  );
  const keys = [...input.envTs.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)];
  keys.forEach((k, i) => {
    const name = k[1] as string;
    if (name === "NODE_ENV") return;
    const chunk = input.envTs.slice(k.index, keys[i + 1]?.index ?? input.envTs.length);
    const isOptional =
      /\.optional\(\)|\.default\(/.test(chunk) &&
      !refined.has(name) &&
      !/^required\b/i.test(about(name));
    (isOptional ? optional : required).push({ name, about: about(name) });
    seen.add(name);
  });
  for (const name of order.filter((v) => !seen.has(v))) {
    const text = about(name);
    (/^required\b/i.test(text) ? required : optional).push({ name, about: text });
    seen.add(name);
  }
  return { required, optional };
}

// ---------------------------------------------------------------------------------------------------------------
// Reconciliation: what was planned (and approved) vs what the delivered package has
// ---------------------------------------------------------------------------------------------------------------

export interface DeliveredFacts {
  /** Component ids present in the delivered package. */
  components: readonly string[];
  /** Capabilities TurbineH wrote and kept (Backup Coder modules that stayed after the gate). */
  written: readonly string[];
  /** Capabilities removed before delivery or never delivered, with the reason. */
  removed: Readonly<Record<string, string>>;
  /** Settings of the delivered app (its env schema). */
  env: DeliveryManifest["env"];
  /** Labels for components found in the package without an entry. */
  label?: (capability: string) => string;
  /** Capability of a component id (for components found in the package without an entry). */
  capabilityOf?: (componentId: string) => string;
}

/**
 * The manifest after generation: each entry delivered or not (with the reason), and — when the manifest was approved as
 * a plan — every promise that was not kept listed as a broken promise.
 */
export function reconcileManifest(
  planned: DeliveryManifest,
  delivered: DeliveredFacts,
): DeliveryManifest {
  const present = new Set(delivered.components);
  const written = new Set(delivered.written);
  const entries: ManifestEntry[] = planned.entries.map((e) => {
    const removed = delivered.removed[e.capability];
    const kept =
      e.way === "component"
        ? present.has(e.component ?? "") && removed === undefined
        : e.way === "written"
          ? written.has(e.capability)
          : e.way === "recipe"
            ? removed === undefined
            : false;
    if (e.way === "not_included") return { ...e, status: "not_delivered" as const };
    if (kept) {
      const delivered: ManifestEntry = { ...e, status: "delivered" };
      delete delivered.reason;
      return delivered;
    }
    return {
      ...e,
      status: "not_delivered" as const,
      reason:
        removed ??
        (e.way === "written"
          ? "TurbineH could not write code for it that passes the checks"
          : "It is not in the delivered package"),
    };
  });
  // A component in the package that no entry decided: listed honestly, with no justification (a contradiction).
  for (const id of delivered.components) {
    if (entries.some((e) => e.component === id)) continue;
    const capability = delivered.capabilityOf?.(id) ?? id;
    entries.push({
      capability,
      label: delivered.label?.(capability) ?? capability,
      way: "component",
      component: id,
      justifiedBy: [],
      status: "delivered",
    });
  }
  const brokenPromises = planned.approved
    ? entries
        .filter((e) => e.way !== "not_included" && e.status === "not_delivered")
        .map((e) => ({
          capability: e.capability,
          label: e.label,
          promised: promiseOf(planned.entries.find((p) => p.capability === e.capability) ?? e),
          reason: e.reason ?? "It is not in the delivered package",
        }))
    : [];
  return { ...planned, entries, env: delivered.env, brokenPromises };
}

// ---------------------------------------------------------------------------------------------------------------
// Consistency between surfaces
// ---------------------------------------------------------------------------------------------------------------

/** What one surface (plan, result, Next steps, DEPLOY.md, AGENTS.md, turbineh.json, UI) says. Absent = not stated. */
export interface SurfaceFacts {
  surface: string;
  /** Components it says are decided (plan) or used (result). */
  components?: readonly string[];
  criteria?: readonly string[];
  /** Criteria it says are still open (no passing test proves them). */
  openCriteria?: readonly string[];
  envRequired?: readonly string[];
  envOptional?: readonly string[];
  /** Capabilities it says are not included. */
  notIncluded?: readonly string[];
  /** Capabilities it says are included. */
  included?: readonly string[];
  /** Capabilities it reports as broken promises. */
  brokenPromises?: readonly string[];
  /** Whether it presents the package as verified. */
  verified?: boolean;
}

export interface Contradiction {
  surface: string;
  field: string;
  detail: string;
}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const same = (a: readonly string[], b: readonly string[]) => {
  const x = unique(a).sort();
  const y = unique(b).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const diff = (expected: readonly string[], found: readonly string[]) => {
  const missing = unique(expected).filter((v) => !found.includes(v));
  const extra = unique(found).filter((v) => !expected.includes(v));
  return [
    missing.length ? `missing ${missing.join(", ")}` : "",
    extra.length ? `unexpected ${extra.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
};

/**
 * Contradictions between the manifest and the surfaces rendered from it (empty = consistent). Each surface is
 * compared with the manifest, so any two surfaces that disagree make at least one of them disagree with it. Also checks
 * the manifest itself: every included capability is justified, nothing is both included and not included, and a
 * package with a broken promise is never presented as verified.
 */
export function checkConsistency(
  m: DeliveryManifest,
  surfaces: readonly SurfaceFacts[],
  opts: { delivered?: boolean } = {},
): Contradiction[] {
  const out: Contradiction[] = [];
  const delivered = opts.delivered ?? m.entries.some((e) => e.status !== "planned");
  for (const e of m.entries) {
    if (e.way !== "not_included" && e.justifiedBy.length === 0)
      out.push({
        surface: "manifest",
        field: "justification",
        detail: `${e.component ?? e.capability} is in the build but nothing in the request or the transversal requirements justifies it`,
      });
  }
  const caps = m.entries.map((e) => e.capability);
  for (const c of unique(caps.filter((c, i) => caps.indexOf(c) !== i)))
    out.push({ surface: "manifest", field: "entries", detail: `${c} has more than one entry` });
  const components = delivered ? deliveredComponents(m) : decidedComponents(m);
  const excluded = notIncluded(m).map((e) => e.capability);
  const kept = included(m).map((e) => e.capability);
  const broken = m.brokenPromises.map((b) => b.capability);
  const required = m.env.required.map((e) => e.name);
  const optional = m.env.optional.map((e) => e.name);
  for (const s of surfaces) {
    const check = (
      field: string,
      expected: readonly string[],
      found: readonly string[] | undefined,
    ) => {
      if (found === undefined || same(expected, found)) return;
      out.push({ surface: s.surface, field, detail: diff(expected, found) });
    };
    check("components", components, s.components);
    if (
      s.criteria !== undefined &&
      !(s.criteria.length === m.criteria.length && s.criteria.every((c, i) => c === m.criteria[i]))
    )
      out.push({
        surface: s.surface,
        field: "criteria",
        detail: diff(m.criteria, s.criteria) || "order differs",
      });
    if (m.criteriaOpen) check("openCriteria", m.criteriaOpen, s.openCriteria);
    check("env.required", required, s.envRequired);
    check("env.optional", optional, s.envOptional);
    check("notIncluded", excluded, s.notIncluded);
    check("brokenPromises", broken, s.brokenPromises);
    for (const c of s.included ?? [])
      if (excluded.includes(c))
        out.push({
          surface: s.surface,
          field: "included",
          detail: `${c} is said to be included but it is not`,
        });
    for (const c of s.notIncluded ?? [])
      if (kept.includes(c))
        out.push({
          surface: s.surface,
          field: "notIncluded",
          detail: `${c} is said to be not included but it is`,
        });
    if (s.verified === true && m.brokenPromises.length > 0)
      out.push({
        surface: s.surface,
        field: "verified",
        detail: `presented as verified with ${m.brokenPromises.length} broken promise(s)`,
      });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Surface readers: what each rendered surface states, parsed back from its text (for the consistency check)
// ---------------------------------------------------------------------------------------------------------------

/** Capability ids whose label (or id) appears in a text. */
export function capabilitiesNamed(m: DeliveryManifest, text: string): string[] {
  return m.entries
    .filter(
      (e) =>
        text.includes(e.label) ||
        new RegExp(`\\b${e.capability.replace(/[.]/g, "\\.")}\\b`).test(text),
    )
    .map((e) => e.capability);
}

/** Capability ids written in parentheses after their label: "recurring subscription plans (payments.subscriptions)". */
export const capabilityIdsIn = (text: string): string[] =>
  unique(
    [...text.matchAll(/\(([a-z][a-z0-9-]*\.[a-z0-9][a-z0-9.-]*)\)/g)].map((m) => m[1] as string),
  );

const NOT_INCLUDED_STEP = /^Not included in this version: /;
const BROKEN_STEP = /^Not delivered although the plan you approved promised it: /;
const ENV_STEP = /^Before deploying, set the required settings: /;

/** "Next steps" (TURBINEH_REPORT.md, result screen): what they say is not included, broken and required. */
export function nextStepsFacts(steps: readonly string[]): SurfaceFacts {
  const not = steps.find((s) => NOT_INCLUDED_STEP.test(s));
  const broken = steps.find((s) => BROKEN_STEP.test(s));
  const env = steps.find((s) => ENV_STEP.test(s));
  const brokenIds = broken ? capabilityIdsIn(broken) : [];
  return {
    surface: "next steps",
    // A broken promise is not included either: the step that names it is enough.
    notIncluded: unique([...(not ? capabilityIdsIn(not) : []), ...brokenIds]),
    brokenPromises: brokenIds,
    envRequired: env ? [...env.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((x) => x[1] as string) : [],
  };
}

/** DEPLOY.md: the Required and Optional settings tables. */
export function deployFacts(markdown: string): SurfaceFacts {
  const table = (head: string) => {
    const at = markdown.indexOf(`| ${head} | What it is |`);
    if (at < 0) return [];
    const rows: string[] = [];
    for (const line of markdown.slice(at).split("\n").slice(2)) {
      const m = /^\| `([A-Z][A-Z0-9_]*)` \|/.exec(line);
      if (!m?.[1]) break;
      rows.push(m[1]);
    }
    return rows;
  };
  // AI connection settings are presented as two equal options in their own section (F-09): its "Settings" row.
  const ai = /^\| Settings \|(.*)$/m.exec(markdown.slice(Math.max(0, markdown.indexOf("· AI: choose"))))?.[1] ?? "";
  const aiNames = markdown.includes("· AI: choose")
    ? [...ai.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((x) => x[1] as string)
    : [];
  return {
    surface: "DEPLOY.md",
    envRequired: table("Required"),
    envOptional: [...new Set([...table("Optional"), ...aiNames])],
  };
}

/** AGENTS.md: environment, what is not included, broken promises and the criteria table. */
export function agentsFacts(markdown: string): SurfaceFacts {
  const line = (head: string) =>
    [
      ...(new RegExp(`^${head}: (.*)$`, "m").exec(markdown)?.[1] ?? "").matchAll(
        /(?:^|, )`([A-Z][A-Z0-9_]*)`/g,
      ),
    ].map((x) => x[1] as string);
  // The capability id is the first parenthesised id of each item (the reason may name others).
  const first = (re: RegExp) =>
    [...markdown.matchAll(re)]
      .map((x) => capabilityIdsIn(x[1] ?? "")[0])
      .filter((c): c is string => Boolean(c));
  const notIncluded = first(/^- \[gap\] Not included: (.+?) — where:/gm);
  const broken = first(/^- \[promise\] Not delivered although approved: (.+?) — where:/gm);
  return {
    surface: "AGENTS.md",
    envRequired: line("Required"),
    envOptional: line("Optional"),
    notIncluded: unique([...notIncluded, ...broken]),
    brokenPromises: unique(broken),
    verified: /^Recipe `[^`]+`: .*\*\*Verified\*\*/m.test(markdown),
  };
}

/** turbineh.json (the package guide): criteria, gaps, env, components and status. */
export function guideFacts(guide: {
  criteria?: { text: string; status?: string }[];
  gaps?: { capability: string }[];
  env?: { required: { name: string }[]; optional: { name: string }[] };
  delivery?: DeliveryManifest;
  status?: string;
  brokenPromises?: { capability: string }[];
}): SurfaceFacts {
  return {
    surface: "turbineh.json",
    ...(guide.criteria
      ? {
          criteria: guide.criteria.map((c) => c.text),
          openCriteria: guide.criteria.filter((c) => c.status === "open").map((c) => c.text),
        }
      : {}),
    ...(guide.gaps ? { notIncluded: guide.gaps.map((g) => g.capability) } : {}),
    ...(guide.env
      ? {
          envRequired: guide.env.required.map((e) => e.name),
          envOptional: guide.env.optional.map((e) => e.name),
        }
      : {}),
    ...(guide.delivery ? { components: deliveredComponents(guide.delivery) } : {}),
    ...(guide.brokenPromises
      ? { brokenPromises: guide.brokenPromises.map((b) => b.capability) }
      : {}),
    ...(guide.status ? { verified: guide.status === "verified" } : {}),
  };
}

/** A plan (web, API, CLI and MCP render the same object): decisions, components, criteria, settings. */
export function planFacts(plan: {
  components: { id: string }[];
  decisions: { topic: string; choice: string; way?: DeliveryWay }[];
  criteria?: { criterion: string }[];
  config: { kind: string; name: string; required?: boolean }[];
}): SurfaceFacts[] {
  const env = plan.config.filter((c) => c.kind === "env");
  return [
    {
      surface: "plan",
      components: plan.components.map((c) => c.id),
      ...(plan.criteria ? { criteria: plan.criteria.map((c) => c.criterion) } : {}),
      envRequired: env.filter((c) => c.required === true).map((c) => c.name),
      envOptional: env.filter((c) => c.required !== true).map((c) => c.name),
      notIncluded: plan.decisions.filter((d) => d.way === "not_included").map((d) => d.topic),
    },
    {
      surface: "plan decisions",
      components: plan.decisions
        .filter((d) => d.way === "component" || d.way === undefined)
        .map((d) => d.choice),
    },
  ];
}

/** A flow's result (API, web and CLI): components used, criteria, settings to provide and the state. */
export function resultFacts(result: {
  components: readonly string[];
  criteria?: readonly string[];
  /** Criteria the result lists as left (open). */
  openCriteria?: readonly string[];
  needs?: { kind: string; name: string; required?: boolean }[];
  verified?: boolean;
}): SurfaceFacts {
  const env = (result.needs ?? []).filter((n) => n.kind === "env");
  return {
    surface: "result",
    components: result.components,
    ...(result.criteria ? { criteria: result.criteria } : {}),
    ...(result.openCriteria ? { openCriteria: result.openCriteria } : {}),
    ...(result.needs
      ? {
          envRequired: env.filter((n) => n.required === true).map((n) => n.name),
          envOptional: env.filter((n) => n.required !== true).map((n) => n.name),
        }
      : {}),
    ...(result.verified !== undefined ? { verified: result.verified } : {}),
  };
}

/** Settings as plan / result requirements (required first), from the manifest's env schema. */
export function envRequirements(env: DeliveryManifest["env"]): {
  kind: "env";
  name: string;
  why: string;
  satisfied: false;
  required: boolean;
}[] {
  const row = (required: boolean) => (e: EnvSetting) => ({
    kind: "env" as const,
    name: e.name,
    why: e.about || (required ? "Required setting of the app" : "Optional setting of the app"),
    satisfied: false as const,
    required,
  });
  return [...env.required.map(row(true)), ...env.optional.map(row(false))];
}

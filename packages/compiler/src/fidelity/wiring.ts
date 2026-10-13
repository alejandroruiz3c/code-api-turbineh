import type { BuildSpec } from "../build-spec.js";
import type { DomainSelection } from "../domains.js";
import type { Constraints } from "./constraints.js";
import type { EntityModel } from "./entity-kinds.js";
import { PATTERN_CAPABILITIES, type PatternId, type PatternMatch } from "./patterns.js";
import { ACTIONS, type Action, type OrgRole, type PermissionMatrix } from "./permissions.js";
import { nameWords, plural, singular } from "./text.js";

/**
 * Wiring of the spec-fidelity output into a build (ADR-0043), by code: which stored role keys the app uses, the role
 * matrix the app's `can()` reads, the parameters of each domain component (shaped to its params.schema.json and
 * validated against it) and where an agent implements a pattern no catalog component provides yet.
 */

/** Actions of the app's role matrix: the fidelity actions plus the scope bypass read by src/server/record-access.ts. */
export type Permission = Action | "see_all_scopes";

export interface RoleRights {
  label: string;
  can: Permission[];
  scope: { kind: "all" | "own" | "membership"; of: string | null };
}

export interface AppRoleMatrix {
  /** True when the roles are the request's own keys (domain.membership-access stores them); false = owner/admin/member. */
  ownKeys: boolean;
  /** Stored role key → rights. */
  roles: Record<string, RoleRights>;
  /** Spec role id → stored role keys. */
  keysOf: Record<string, string[]>;
  defaultRole: string;
  /** Resource (entity slug) → action → stored role keys allowed. */
  resources: Record<string, Partial<Record<Permission, string[]>>>;
  signUpEmailDomains: string[];
}

const keyOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "r_$1")
    .slice(0, 24) || "member";

/**
 * The role matrix as the app stores it. Without domain.membership-access the workspace keeps better-auth's three roles
 * (owner, admin, member) with the rights of the spec role each maps to; with it, the request's roles become the stored
 * keys (the top role is stored as "owner", which the component requires).
 */
export function appRoleMatrix(m: PermissionMatrix, ownKeys: boolean): AppRoleMatrix {
  const withScope = (actions: readonly Action[], scope: RoleRights["scope"]): Permission[] => [
    ...ACTIONS.filter((a) => actions.includes(a)),
    ...(scope.kind === "all" ? (["see_all_scopes"] as const) : []),
  ];
  const roles: Record<string, RoleRights> = {};
  const keysOf: Record<string, string[]> = {};
  if (!ownKeys) {
    for (const o of ["owner", "admin", "member"] as const) {
      const r = m.byOrgRole[o];
      roles[o] = { label: r.label, can: withScope(r.actions, r.scope), scope: r.scope };
    }
    for (const r of m.roles) keysOf[r.id] = [...r.orgRoles];
  } else {
    for (const r of m.roles) {
      const key = r.orgRoles.includes("owner") ? "owner" : keyOf(r.id);
      const actions = r.orgRoles.includes("owner") ? [...ACTIONS] : r.actions;
      roles[key] = { label: r.label, can: withScope(actions, r.scope), scope: r.scope };
      keysOf[r.id] = [key];
    }
  }
  const storedFor = (orgRoles: readonly OrgRole[]): string[] =>
    ownKeys
      ? [
          ...new Set(
            m.roles
              .filter((r) => r.orgRoles.some((o) => orgRoles.includes(o)))
              .flatMap((r) => keysOf[r.id] ?? []),
          ),
        ]
      : [...orgRoles];
  const resources: AppRoleMatrix["resources"] = {};
  for (const [res, rules] of Object.entries(m.resources)) {
    resources[res] = Object.fromEntries(
      Object.entries(rules).map(([a, org]) => [a, storedFor(org ?? [])]),
    );
  }
  const member = m.roles.filter((r) => r.orgRoles.includes("member")).at(-1);
  const defaultRole = ownKeys
    ? member
      ? (keysOf[member.id]?.[0] ?? "member")
      : "member"
    : "member";
  return {
    ownKeys,
    roles,
    keysOf,
    defaultRole,
    resources,
    signUpEmailDomains: [...m.signUpEmailDomains],
  };
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const humanize = (s: string) => title(s.replace(/[_-]+/g, " "));

/** domain.membership-access params (src/membership/params.json) from the role matrix. */
function membershipParams(m: PermissionMatrix): Record<string, unknown> {
  const app = appRoleMatrix(m, true);
  const core = new Set<Permission>([
    "read",
    "create",
    "update",
    "delete",
    "manage_members",
    "view_audit",
    "see_all_scopes",
  ]);
  const roles = Object.entries(app.roles).map(([key, r]) => ({
    key,
    label: r.label.slice(0, 40),
    can: r.can.filter((a) => core.has(a)),
  }));
  const invitable = [...new Set(m.invitations.roles.flatMap((id) => app.keysOf[id] ?? []))].filter(
    (k) => k !== "owner",
  );
  const scoped = m.roles.find((r) => r.scope.kind !== "all" && r.scope.of);
  const of = scoped?.scope.of ?? null;
  return {
    roles,
    defaultRole: app.defaultRole,
    inviteRoles: invitable.length
      ? invitable
      : roles
          .map((r) => r.key)
          .filter((k) => k !== "owner")
          .slice(0, 8),
    invitationDays: 7,
    scope: of
      ? {
          kind: keyOf(singular(of)),
          label: humanize(singular(of)).slice(0, 40),
          plural: humanize(plural(singular(of))).slice(0, 40),
        }
      : null,
  };
}

/** Button text of a transition: "Approve", "Reject", "Mark glazed". */
function transitionLabel(to: string): string {
  const verbs: Record<string, string> = {
    approved: "Approve",
    rejected: "Reject",
    returned: "Check in",
    cancelled: "Cancel",
    canceled: "Cancel",
    closed: "Close",
    archived: "Archive",
    published: "Publish",
    done: "Complete",
    completed: "Complete",
  };
  return (verbs[to.toLowerCase()] ?? `Mark ${to.toLowerCase()}`).slice(0, 40);
}

/** domain.workflow params (src/workflow/params.json): one workflow per detected status workflow. */
function workflowParams(
  matches: readonly PatternMatch[],
  spec: Pick<BuildSpec, "entities">,
  m: PermissionMatrix,
  ownKeys: boolean,
): Record<string, unknown> {
  const app = appRoleMatrix(m, ownKeys);
  const updaters = Object.entries(app.roles)
    .filter(([, r]) => r.can.includes("update"))
    .map(([k]) => k);
  const creators = Object.entries(app.roles)
    .filter(([, r]) => r.can.includes("create"))
    .map(([k]) => k);
  const workflows = matches.map((p) => {
    const entity = String(p.params.entity);
    const states = (p.params.states as string[]).map((s) => ({
      key: keyOf(s),
      label: humanize(s),
    }));
    const transitions = (
      p.params.transitions as { from: string; to: string; roles: string[] }[]
    ).map((t) => {
      const keys = [...new Set(t.roles.flatMap((r) => app.keysOf[r] ?? []))];
      return {
        from: [keyOf(t.from)],
        to: keyOf(t.to),
        label: transitionLabel(t.to),
        roles: (keys.length ? keys : updaters.length ? updaters : ["owner"]).slice(0, 10),
      };
    });
    const leaving = new Set(transitions.flatMap((t) => t.from));
    const fields = spec.entities.find((e) => e.name === entity)?.fields ?? [];
    const due = fields.some(
      (f) =>
        (f.type === "date" || f.type === "datetime") && /^(due|end|until|return)/i.test(f.name),
    );
    const w = nameWords(entity);
    return {
      key: keyOf(w.join("_")).slice(0, 40),
      label: humanize(w.join(" ")).slice(0, 40),
      plural: humanize([...w.slice(0, -1), plural(w.at(-1) ?? "")].join(" ")).slice(0, 40),
      initial: keyOf(String(p.params.initial)),
      dueDate: due,
      createRoles: creators.length === Object.keys(app.roles).length ? ["*"] : creators,
      states: states.map((s) => ({
        key: s.key,
        label: s.label.slice(0, 40),
        limitHours: null,
        final: !leaving.has(s.key),
      })),
      transitions,
    };
  });
  return { workflows };
}

export interface PatternParamsContext {
  spec: Pick<BuildSpec, "entities">;
  permissions: PermissionMatrix;
  constraints: Constraints;
  /** True when domain.membership-access is in the build (role keys are the request's). */
  membership: boolean;
  /** Every match of the same pattern (workflows are one component with several definitions). */
  sameKind: readonly PatternMatch[];
  /** The component's shipped default params (files/<params file>), merged under the generated ones when needed. */
  defaults: Record<string, unknown> | null;
}

/**
 * Parameters for the component implementing a pattern, shaped to the component's params schema. Known components get
 * an adapter; any other component (a new one in the catalog) receives the pattern's own parameters, then — if they do
 * not satisfy its schema — those parameters over its shipped defaults. The caller validates; invalid = not selected.
 */
export function componentParamCandidates(
  p: PatternMatch,
  ctx: PatternParamsContext,
): Record<string, unknown>[] {
  switch (p.id) {
    case "membership-access":
      return [membershipParams(ctx.permissions)];
    case "workflow":
      return [workflowParams(ctx.sameKind, ctx.spec, ctx.permissions, ctx.membership)];
    case "audit-log":
      return [
        {
          ...(ctx.defaults ?? {}),
          ...(ctx.constraints.pageSize
            ? { pageSize: Math.min(200, Math.max(10, ctx.constraints.pageSize)) }
            : {}),
        },
      ];
    default:
      return [p.params, ...(ctx.defaults ? [{ ...ctx.defaults, ...p.params }] : [])];
  }
}

/** What the selection needs to know about a catalog component (read from its manifest and files). */
export interface ComponentCard {
  id: string;
  status: string;
  provides: string[];
  /** `params.file` of the manifest (where the assembler writes the params), or null. */
  paramsFile: string | null;
  /** True when the component declares a params schema. */
  hasSchema: boolean;
  /** `params.entities`: entities of a request the component implements (no generic CRUD for them). */
  entities: string[];
  /** contract.inputs (legacy: a `src/…/params.json` path there is where params go when no schema is declared). */
  inputs?: string[];
  /** Recipes the component is declared for (use cases, guide compatibility); empty = any. */
  recipes?: string[];
}

export interface WiredPattern {
  id: PatternId;
  status: "selected" | "missing";
  component: string | null;
  /** Why it is missing (no component, or params that do not satisfy its schema). */
  reason: string;
  capabilities: string[];
  params: Record<string, unknown>;
  /** Where an agent implements it when missing (and its criteria stay open). */
  where: string[];
  how: string;
}

export interface WiredSelection {
  selected: DomainSelection[];
  patterns: WiredPattern[];
}

/** Where a pattern belongs when no catalog component provides it yet (for AGENTS.md and the fidelity report). */
export const PATTERN_GUIDE: Record<PatternId, { where: string[]; how: string }> = {
  workflow: {
    where: ["src/entities/<entity>/actions.ts", "src/server/permissions.ts"],
    how: "Model the statuses as an enum field (options in src/lib/spec-constraints.ts), allow each change only to the roles that may `approve`, and record every change append-only.",
  },
  "membership-access": {
    where: ["src/server/permissions.ts", "src/server/record-access.ts"],
    how: "Map the request's roles in the role matrix and file records under a scope; list with visibleScopes(ctx) and check single records with canSeeScope(ctx, scopeId).",
  },
  "audit-log": {
    where: ["src/lib/audit.ts"],
    how: 'Replace the no-op audit() with an append-only table and an owner-only page (can(role, "view_audit")).',
  },
  "private-uploads": {
    where: ["src/app/api/files/", "src/server/record-access.ts", "src/lib/spec-constraints.ts"],
    how: "Store files outside public/ (or a private bucket), enforce SPEC_CONSTRAINTS.uploads (size, types) on the server and serve downloads only through an authorised route.",
  },
  "jobs.scheduled": {
    where: ["scripts/jobs/", "package.json (scripts)"],
    how: "Add a script per job (cron and time zone in src/lib/spec-constraints.ts) that emails through src/lib/email.ts, which logs when no provider is configured.",
  },
  "site.public-pages": {
    where: ["src/app/(site)/", "src/app/sitemap.ts"],
    how: "Public pages read published records with no sign-in; add metadata, sitemap and robots entries.",
  },
  "growth.waitlist": {
    where: ["src/app/actions.ts (publicAction)", "src/app/dashboard/waitlist/"],
    how: "Public sign-up through publicAction() with double opt-in, position and referral boost; owners export and remove entries.",
  },
  "data.analytics-import": {
    where: ["src/app/dashboard/analytics/", "src/lib/csv.ts"],
    how: "Validate every CSV row before inserting (all or nothing, a report of row, field and reason), then aggregate per period with filters and CSV export.",
  },
  kanban: {
    where: ["src/app/dashboard/<entity>/board/page.tsx"],
    how: "A board with one column per status (src/lib/spec-constraints.ts); moving a card changes the status through the same server action and role check.",
  },
  bookings: {
    where: ["src/bookings/"],
    how: "Bookings need the domain.bookings component (slots, notice, double-booking guard).",
  },
};

const approved = (c: ComponentCard) => c.status === "approved";

/** The approved component implementing a pattern: one that provides one of its capabilities, or is named after it. */
export function componentFor(
  id: PatternId,
  catalog: readonly ComponentCard[],
): ComponentCard | null {
  for (const cap of PATTERN_CAPABILITIES[id]) {
    const c = catalog.find((x) => approved(x) && x.provides.includes(cap));
    if (c) return c;
  }
  const names = PATTERN_CAPABILITIES[id];
  return (
    catalog.find((x) => approved(x) && names.some((n) => x.id === n || x.id.startsWith(`${n}.`))) ??
    null
  );
}

/**
 * Selects, by code, the catalog component of every detected pattern and writes its params: the component must be
 * approved, provide one of the pattern's capabilities and accept the generated params (its params.schema.json). A new
 * component appearing in the catalog is picked up the same way. Everything else is reported as missing, with where an
 * agent implements it.
 */
export function wirePatterns(
  patterns: readonly PatternMatch[],
  catalog: readonly ComponentCard[],
  ctx: {
    recipe: string;
    /** The recipe and the recipes it extends (a component declared for any of them fits). */
    recipeChain?: string[];
    spec: Pick<BuildSpec, "entities">;
    permissions: PermissionMatrix;
    constraints: Constraints;
    /** JSON Schema validation of params (errors, [] when valid). */
    validate: (componentId: string, params: unknown) => string[];
    /** The component's shipped default params, or null. */
    defaults: (componentId: string) => Record<string, unknown> | null;
  },
): WiredSelection {
  const out: WiredSelection = { selected: [], patterns: [] };
  const seen = new Set<PatternId>();
  // Role keys depend on whether membership-access is in the build: decide it first.
  const order = [...patterns].sort(
    (a, b) => Number(b.id === "membership-access") - Number(a.id === "membership-access"),
  );
  let membership = false;
  for (const p of order) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const sameKind = patterns.filter((x) => x.id === p.id);
    const guide = PATTERN_GUIDE[p.id];
    const base = {
      id: p.id,
      capabilities: PATTERN_CAPABILITIES[p.id],
      where: guide.where,
      how: guide.how,
    };
    const c = componentFor(p.id, catalog);
    const chain = ctx.recipeChain ?? [ctx.recipe];
    if (c && c.recipes?.length && !c.recipes.some((r) => chain.includes(r))) {
      out.patterns.push({
        ...base,
        status: "missing",
        component: c.id,
        reason: `${c.id} is not declared for recipe ${ctx.recipe} (declared: ${c.recipes.join(", ")})`,
        params: p.params,
      });
      continue;
    }
    if (!c) {
      out.patterns.push({
        ...base,
        status: "missing",
        component: null,
        reason: "no approved catalog component provides it yet",
        params: p.params,
      });
      continue;
    }
    const candidates = componentParamCandidates(p, {
      spec: ctx.spec,
      permissions: ctx.permissions,
      constraints: ctx.constraints,
      membership,
      sameKind,
      defaults: c.hasSchema ? ctx.defaults(c.id) : null,
    });
    let chosen: Record<string, unknown> | null = null;
    let errors: string[] = [];
    if (!c.hasSchema) {
      // Legacy domain components (no params schema): the compiler's own validated contract (e.g. BookingParams).
      chosen = candidates[0] ?? null;
    } else {
      for (const params of candidates) {
        const e = ctx.validate(c.id, params);
        if (e.length === 0) {
          chosen = params;
          break;
        }
        errors = e;
      }
    }
    if (!chosen) {
      out.patterns.push({
        ...base,
        status: "missing",
        component: c.id,
        reason: `params do not satisfy ${c.id}'s params.schema.json: ${errors.slice(0, 3).join("; ")}`,
        params: p.params,
      });
      continue;
    }
    if (p.id === "membership-access") membership = true;
    const paramsFile =
      c.paramsFile ??
      (c.inputs ?? []).map((i) => /\b(src\/[\w./-]+params\.json)\b/.exec(i)?.[1]).find(Boolean) ??
      `src/${p.id.replace(/\./g, "-")}/params.json`;
    out.selected.push({
      id: p.id,
      capability:
        c.provides.find((x) => PATTERN_CAPABILITIES[p.id].includes(x)) ?? c.provides[0] ?? p.id,
      component: c.id,
      recipes: [ctx.recipe],
      paramsFile,
      params: chosen,
      providedEntities: [
        ...new Set([...sameKind.flatMap((x) => x.providedEntities), ...c.entities]),
      ],
      assumptions: sameKind.flatMap((x) => x.assumptions),
    });
    out.patterns.push({
      ...base,
      status: "selected",
      component: c.id,
      reason: "",
      params: chosen,
    });
  }
  return out;
}

/** Capabilities the request implies by code (added to the spec's): "export … as CSV" → data.csv-export. */
export function impliedCapabilities(prompt: string): string[] {
  const text = prompt.replace(/\s+/g, " ");
  return /\bexport\w*\b[^.;]{0,60}\bcsv\b|\bcsv\b[^.;]{0,30}\bexport/i.test(text)
    ? ["data.csv-export"]
    : [];
}

/** Entities no generic code is generated for: tag entities (a field of their parent) and what selected components implement. */
export function coveredEntities(models: readonly EntityModel[], wired: WiredSelection): string[] {
  return [
    ...new Set([
      ...wired.selected.flatMap((s) => s.providedEntities),
      ...models.filter((m) => m.shape === "tags").map((m) => m.name),
    ]),
  ];
}

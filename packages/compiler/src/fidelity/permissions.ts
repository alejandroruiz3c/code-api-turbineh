import { listItems, nounPattern, plural, sentences, singular } from "./text.js";

/**
 * Roles and permissions from the request (ADR-0042 §2), by code. The request names its roles ("owner, editor,
 * viewer", "managers", "staff and clients", "shop managers") and its rules ("viewers cannot edit", "a manager approves",
 * "a client only ever sees their own company", "company emails only (@pixelyard.test)"). They become a permission
 * matrix that the app's `can(role, action, resource?)` reads (`src/server/permissions.ts`).
 *
 * Authentication stores three workspace roles (better-auth organizations: owner, admin, member). The request's roles
 * are mapped onto them by rank (the highest is the workspace owner, the lowest is an invited member), so sign-up,
 * invitations and every template keep working; labels and rights come from the request.
 */
export type OrgRole = "owner" | "admin" | "member";
export const ORG_ROLES: readonly OrgRole[] = ["owner", "admin", "member"];
export const ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "approve",
  "export",
  "configure",
  "manage_members",
  "view_audit",
] as const;
export type Action = (typeof ACTIONS)[number];

export interface RoleScope {
  /** all: the whole workspace; own: records of their own <of>; membership: <of> records they belong to. */
  kind: "all" | "own" | "membership";
  of: string | null;
}

export interface SpecRole {
  /** snake_case id as the request names it ("shop_manager"). */
  id: string;
  label: string;
  orgRoles: OrgRole[];
  actions: Action[];
  scope: RoleScope;
}

export interface PermissionRule {
  /** What the rule does, in plain words. */
  text: string;
  /** The sentence of the request it comes from. */
  source: string;
}

export interface PermissionMatrix {
  /** True when the request names roles; false = the documented default policy. */
  stated: boolean;
  roles: SpecRole[];
  byOrgRole: Record<OrgRole, { role: string; label: string; actions: Action[]; scope: RoleScope }>;
  /** Per-resource overrides: resource (kebab, plural) → action → org roles allowed. */
  resources: Record<string, Partial<Record<Action, OrgRole[]>>>;
  invitations: { enabled: boolean; roles: string[] };
  /** Sign-up restricted to these email domains (staff allow-list still applies). Empty = no restriction. */
  signUpEmailDomains: string[];
  rules: PermissionRule[];
  assumptions: string[];
}

interface RoleNoun {
  id: string;
  /** Regex source (singular or plural). */
  pattern: string;
  rank: number;
  /** Public actors only become roles when the request gives them accounts. */
  external?: boolean;
}

const ROLE_NOUNS: RoleNoun[] = [
  { id: "owner", pattern: nounPattern(["owner"]), rank: 6 },
  { id: "admin", pattern: String.raw`\badmin(?:istrator)?s?\b`, rank: 5 },
  // "shop manager", "store manager", "project manager": a manager of one thing (scoped), ranked like a member.
  {
    id: "scoped_manager",
    pattern: String.raw`\b(?:shop|store|branch|site|location|team|account|office|restaurant|clinic)\s+managers?\b`,
    rank: 2,
  },
  { id: "manager", pattern: nounPattern(["manager"]), rank: 4 },
  { id: "editor", pattern: nounPattern(["editor"]), rank: 3 },
  { id: "staff", pattern: String.raw`\bstaff(?:\s+members?)?\b`, rank: 3 },
  { id: "member", pattern: nounPattern(["member"]), rank: 2 },
  { id: "teammate", pattern: nounPattern(["teammate"]), rank: 2 },
  { id: "employee", pattern: nounPattern(["employee"]), rank: 2 },
  { id: "client", pattern: nounPattern(["client"]), rank: 1, external: true },
  { id: "customer", pattern: nounPattern(["customer"]), rank: 1, external: true },
  { id: "viewer", pattern: nounPattern(["viewer"]), rank: 1 },
];

const DEFAULT_ACTIONS: Record<string, Action[]> = {
  viewer: ["read"],
  editor: ["read", "create", "update", "delete", "export"],
};
const ALL: Action[] = [...ACTIONS];
/** Template default (saas-crud): members read and create; owners and admins do everything. */
const MEMBER_DEFAULT: Action[] = ["read", "create", "export"];

/** Words before a role noun that make it an object ("see all clients", "invite each client", "by that client"). */
const OBJECT_MARKERS = new Set([
  "all",
  "each",
  "every",
  "their",
  "other",
  "to",
  "by",
  "for",
  "with",
  "that",
  "invite",
  "invites",
  "create",
  "creates",
  "see",
  "sees",
  "notify",
  "email",
  "emails",
  "assign",
]);
/** Words after a role noun that make it a modifier ("client accounts", "client portal", "staff emails"). */
const NOUN_AFTER = new Set([
  "account",
  "accounts",
  "portal",
  "portals",
  "company",
  "companies",
  "email",
  "emails",
  "list",
  "data",
  "page",
  "pages",
  "documents",
]);

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Roles named in an explicit list: "with roles (owner, editor, viewer…)", "roles: manager and member". */
function listedRoles(prompt: string): string[] | null {
  const m = /\broles?\b[^(:.]{0,30}[(:]\s*([^).]+)/i.exec(prompt);
  if (!m) return null;
  const items = listItems((m[1] ?? "").split(/:/)[0] ?? "")
    .map((s) =>
      s
        .toLowerCase()
        .replace(/[^a-z ]/g, "")
        .trim(),
    )
    .filter((s) =>
      ROLE_NOUNS.some(
        (r) =>
          new RegExp(`^${r.pattern.replace(/^\\b|\\b$/g, "")}$`, "i").test(s) ||
          new RegExp(r.pattern, "i").test(s),
      ),
    );
  return items.length >= 1 ? items.map((s) => singular(s.split(" ").pop() ?? s)) : null;
}

/** Whether an external actor (client, customer) has an account in the app. */
function hasAccounts(noun: RoleNoun, prompt: string): boolean {
  const p = noun.pattern;
  return new RegExp(
    `${p}[^.;]{0,40}\\b(accounts?|sign[s]? in|log[s]? in|signs? up|invite[sd]?|only (ever )?sees?|upload|see (their|a list))|(invite|create)[^.;]{0,30}${p}`,
    "i",
  ).test(prompt);
}

/** The label the request uses for a role noun ("shop manager", "staff"). */
function labelFor(noun: RoleNoun, prompt: string): string {
  const m = new RegExp(noun.pattern, "i").exec(prompt);
  const raw = (m?.[0] ?? noun.id).toLowerCase().replace(/\s+members?$/, "");
  return titleCase(singular(raw.split(/\s+/).map(singular).join(" ")));
}

/** Org roles each spec role maps to, by rank. */
function mapToOrgRoles(roles: { id: string; rank: number }[]): Record<string, OrgRole[]> {
  const sorted = [...roles].sort((a, b) => b.rank - a.rank);
  const out: Record<string, OrgRole[]> = {};
  const [a, b, ...rest] = sorted;
  if (!a) return out;
  if (!b) {
    out[a.id] = ["owner", "admin", "member"];
    return out;
  }
  if (rest.length === 0) {
    out[a.id] = ["owner", "admin"];
    out[b.id] = ["member"];
    return out;
  }
  out[a.id] = ["owner"];
  out[b.id] = ["admin"];
  for (const r of rest) out[r.id] = ["member"];
  return out;
}

/** Extracts the permission matrix (deterministic). `specRoles` are the roles the compiler model listed (fallback). */
export function extractPermissions(
  prompt: string,
  specRoles: readonly string[] = [],
): PermissionMatrix {
  const text = prompt.replace(/\s+/g, " ");
  const rules: PermissionRule[] = [];
  const assumptions: string[] = [];

  // 1 · Which roles sign in.
  const listed = listedRoles(text);
  let found = ROLE_NOUNS.filter((r) => {
    if (listed)
      return listed.some(
        (l) => new RegExp(r.pattern, "i").test(l) && !(r.id === "manager" && /\s/.test(l)),
      );
    if (!new RegExp(r.pattern, "i").test(text)) return false;
    return !r.external || hasAccounts(r, text);
  });
  // "shop managers" also matches "managers": when the request names a scoped manager, plain "managers" are that role.
  if (found.some((r) => r.id === "scoped_manager")) found = found.filter((r) => r.id !== "manager");
  // "staff members" are staff; "members" alone are a role only when staff is not how the request names them.
  if (found.some((r) => r.id === "staff") && found.some((r) => r.id === "member")) {
    const rest = text.replace(/\bstaff\s+members?\b/gi, "");
    if (!new RegExp(nounPattern(["member"]), "i").test(rest))
      found = found.filter((r) => r.id !== "member");
  }
  // Teammates are colleagues of the listed roles, not a role of their own, when a list exists.
  if (found.length > 1) found = found.filter((r) => r.id !== "teammate" || found.length === 1);

  const stated = found.length > 0;
  if (!stated) {
    const fallback = specRoles.filter((r) => /^[a-z][a-z0-9_]*$/.test(r));
    assumptions.push(
      "The request names no roles: owners and admins do everything; members read and create (template policy).",
    );
    return defaultMatrix(fallback, assumptions);
  }

  const roles = found.map((r) => ({
    noun: r,
    id: r.id === "scoped_manager" ? labelFor(r, text).toLowerCase().replace(/\s+/g, "_") : r.id,
    label: labelFor(r, text),
    rank: r.rank,
  }));
  const orgOf = mapToOrgRoles(roles);
  const top = [...roles].sort((a, b) => b.rank - a.rank)[0];
  const actions: Record<string, Set<Action>> = {};
  const scope: Record<string, RoleScope> = {};
  for (const r of roles) {
    const isTop = r === top;
    actions[r.id] = new Set(
      isTop
        ? ALL
        : (DEFAULT_ACTIONS[r.noun.id] ?? (orgOf[r.id]?.includes("admin") ? ALL : MEMBER_DEFAULT)),
    );
    scope[r.id] = { kind: "all", of: null };
  }
  if (roles.length >= 3) {
    // The second role (admin) edits but does not manage members or see the audit log unless the request says so.
    const second = roles.find((r) => orgOf[r.id]?.includes("admin") && r !== top);
    if (second && !DEFAULT_ACTIONS[second.noun.id]) {
      actions[second.id] = new Set<Action>([
        "read",
        "create",
        "update",
        "delete",
        "export",
        "approve",
      ]);
    }
  }

  const roleIn = (s: string) =>
    roles.filter(
      (r) =>
        new RegExp(r.noun.pattern, "i").test(s) || new RegExp(nounPattern([r.id]), "i").test(s),
    );
  const resources: PermissionMatrix["resources"] = {};
  const grantOnly = (action: Action, who: typeof roles, source: string, resource?: string) => {
    const rank = Math.min(...who.map((w) => w.rank));
    const allowed = roles.filter((r) => r.rank >= rank);
    if (resource) {
      const org = [...new Set(allowed.flatMap((r) => orgOf[r.id] ?? []))];
      resources[resource] = { ...(resources[resource] ?? {}), [action]: org };
    } else {
      for (const r of roles) {
        if (allowed.includes(r)) actions[r.id]?.add(action);
        else actions[r.id]?.delete(action);
      }
    }
    rules.push({
      text: `${action}${resource ? ` ${resource}` : ""}: ${allowed.map((r) => r.label).join(", ")} only`,
      source,
    });
  };

  // 2 · Rules, sentence by sentence. The actor of a verb is the role named closest before it in the clause
  // ("Staff create client accounts and invite each client": Staff invites, the client is the object).
  const mentionsOf = (s: string) =>
    roles
      .flatMap((r) =>
        [...s.matchAll(new RegExp(r.noun.pattern, "gi"))].map((m) => ({
          r,
          at: m.index ?? 0,
          end: (m.index ?? 0) + m[0].length,
        })),
      )
      .sort((x, y) => x.at - y.at);
  const actorOf = (s: string, verb: RegExp): (typeof roles)[number][] => {
    const v = verb.exec(s);
    if (!v) return [];
    const before = mentionsOf(s).filter((m) => {
      if (m.end > (v.index ?? 0)) return false;
      // Objects, not actors: "see all clients", "invite each client", "client accounts", "by that client".
      const prev = /([a-z]+)[\s,]*$/i.exec(s.slice(0, m.at))?.[1]?.toLowerCase() ?? "";
      const next = /^\s*([a-z]+)/i.exec(s.slice(m.end))?.[1]?.toLowerCase() ?? "";
      if (OBJECT_MARKERS.has(prev)) return false;
      return !NOUN_AFTER.has(next);
    });
    const last = before.at(-1);
    return last ? [last.r] : [];
  };
  for (const s of sentences(text)) {
    for (const r of roleIn(s)) {
      if (
        new RegExp(
          `${r.noun.pattern}\\s+(?:(?:can|may)\\s+)?(?:only\\s+|never\\s+)?(?:cannot (?:edit|change|modify|write)|can only (?:view|read|see)|(?:are|is) read[- ]only|read[- ]only)`,
          "i",
        ).test(s)
      ) {
        actions[r.id] = new Set(["read"]);
        rules.push({ text: `${r.label}: read-only`, source: s });
      }
    }
    const approver =
      actorOf(s, /\b(approve|approves|reject|rejects)\b/i).length > 0
        ? actorOf(s, /\b(approve|approves|reject|rejects)\b/i)
        : actorOf(
            s,
            /\b(change|changes|update|updates|set|sets|move|moves)\s+(the\s+)?(status|statuses|stage|stages)\b/i,
          );
    if (approver.length > 0) grantOnly("approve", approver, s);
    const exporter = actorOf(s, /\bexports?\b/i);
    if (exporter.length > 0 && !/\bevery (chart|list)|\ball (users|members)\b/i.test(s)) {
      const lowest = Math.min(...roles.map((r) => r.rank));
      if (exporter.some((r) => r.rank > lowest)) grantOnly("export", exporter, s);
    }
    const inviter = actorOf(
      s,
      /\b(invite|invites|assign people|assigns people|assign members|add members)\b/i,
    );
    if (inviter.length > 0) grantOnly("manage_members", inviter, s);
    const createVerb = /\b(?:create|creates|add|adds)\s+(?:new\s+)?([a-z]+)/i;
    const creator = actorOf(s, createVerb);
    const createdNoun = (createVerb.exec(s)?.[1] ?? "").toLowerCase();
    if (
      creator.length > 0 &&
      createdNoun &&
      !/^(a|an|the|their|accounts?|account|client|clients|a)$/.test(createdNoun) &&
      roles.length > 1
    ) {
      const lowest = Math.min(...roles.map((r) => r.rank));
      if (creator.every((r) => r.rank > lowest))
        grantOnly("create", creator, s, plural(singular(createdNoun)));
    }
    const who = roleIn(s);
    // "audit log visible to owners", "visible only to managers"
    if (
      /\baudit|\bchange (log|history)|\bactivity log/i.test(s) &&
      /\bvisible to|\bonly\b.*\bsee|\bseen by/i.test(s)
    ) {
      const viewers = roleIn(s.slice(s.search(/visible to|seen by|only/i)));
      if (viewers.length > 0) grantOnly("view_audit", viewers, s);
    }
    // Scope: "a client only ever sees their own company", "members see only the projects they belong to".
    for (const r of who) {
      const own = new RegExp(
        `${r.noun.pattern}[^.;]{0,30}\\bonly(?: ever)? sees? (?:their|its|his|her) own ([a-z]+)|${r.noun.pattern}[^.;]{0,30}\\bsees? only (?:their|its) ([a-z]+)`,
        "i",
      ).exec(s);
      const member = new RegExp(
        `${r.noun.pattern}[^.;]{0,30}\\bsees? only the ([a-z]+) they belong to|${r.noun.pattern}[^.;]{0,30}\\bonly sees? the ([a-z]+) (?:they|that they) (?:belong to|are (?:members of|assigned to))`,
        "i",
      ).exec(s);
      if (member) {
        scope[r.id] = {
          kind: "membership",
          of: singular((member[1] ?? member[2] ?? "").toLowerCase()),
        };
        rules.push({
          text: `${r.label}: only the ${member[1] ?? member[2]} they belong to`,
          source: s,
        });
      } else if (own) {
        scope[r.id] = { kind: "own", of: singular((own[1] ?? own[2] ?? "").toLowerCase()) };
        rules.push({
          text: `${r.label}: only their own ${singular((own[1] ?? own[2] ?? "").toLowerCase())}`,
          source: s,
        });
      }
    }
  }

  // 3 · Invitations and sign-up restrictions.
  const invite = /\binvit\w*/i.exec(text);
  const inviteRoles = /\binvit\w*[^.;]{0,60}\broles?\b/i.test(text)
    ? roles.map((r) => r.id)
    : roles.filter((r) => orgOf[r.id]?.includes("member")).map((r) => r.id);
  const domains = [
    ...text.matchAll(
      /(?:only|exclusively|restricted to)[^.;]{0,40}\(?\s*@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\s*\)?|@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\)?\s*(?:emails?|addresses?)?\s*only\b/gi,
    ),
  ]
    .map((m) => (m[1] ?? m[2] ?? "").toLowerCase())
    .filter(Boolean);
  if (domains.length > 0)
    rules.push({
      text: `sign-up: only ${domains.map((d) => `@${d}`).join(", ")} emails`,
      source: sentences(text).find((s) => s.includes(`@${domains[0]}`)) ?? "",
    });

  const toRole = (r: (typeof roles)[number]): SpecRole => ({
    id: r.id,
    label: r.label,
    orgRoles: orgOf[r.id] ?? [],
    actions: ACTIONS.filter((a) => actions[r.id]?.has(a)),
    scope: scope[r.id] ?? { kind: "all", of: null },
  });
  const specRolesOut = roles.map(toRole);
  const byOrgRole = Object.fromEntries(
    ORG_ROLES.map((o) => {
      const r =
        specRolesOut.find((x) => x.orgRoles.includes(o)) ?? specRolesOut[specRolesOut.length - 1];
      return [
        o,
        {
          role: r?.id ?? o,
          label: r?.label ?? titleCase(o),
          actions: r?.actions ?? [],
          scope: r?.scope ?? { kind: "all", of: null },
        },
      ];
    }),
  ) as PermissionMatrix["byOrgRole"];
  // The workspace owner can always manage the workspace (members, settings): never lock the owner out.
  byOrgRole.owner.actions = [...ALL];
  if (roles.length >= 3)
    assumptions.push(
      `Roles mapped by rank: ${specRolesOut.map((r) => `${r.label} → ${r.orgRoles.join("/")}`).join(", ")}.`,
    );
  return {
    stated: true,
    roles: specRolesOut,
    byOrgRole,
    resources,
    invitations: { enabled: Boolean(invite), roles: inviteRoles },
    signUpEmailDomains: [...new Set(domains)],
    rules,
    assumptions,
  };
}

function defaultMatrix(specRoles: readonly string[], assumptions: string[]): PermissionMatrix {
  const scopeAll: RoleScope = { kind: "all", of: null };
  return {
    stated: false,
    roles: [
      { id: "owner", label: "Owner", orgRoles: ["owner"], actions: [...ALL], scope: scopeAll },
      { id: "admin", label: "Admin", orgRoles: ["admin"], actions: [...ALL], scope: scopeAll },
      {
        id: "member",
        label: "Member",
        orgRoles: ["member"],
        actions: [...MEMBER_DEFAULT],
        scope: scopeAll,
      },
    ],
    byOrgRole: {
      owner: { role: "owner", label: "Owner", actions: [...ALL], scope: scopeAll },
      admin: { role: "admin", label: "Admin", actions: [...ALL], scope: scopeAll },
      member: { role: "member", label: "Member", actions: [...MEMBER_DEFAULT], scope: scopeAll },
    },
    resources: {},
    invitations: { enabled: false, roles: specRoles.length ? [...specRoles] : [] },
    signUpEmailDomains: [],
    rules: [],
    assumptions,
  };
}

/** `can` as the generated app evaluates it (same semantics; used by tests and the report). */
export function canDo(
  m: PermissionMatrix,
  role: OrgRole,
  action: Action,
  resource?: string,
): boolean {
  const override = resource ? m.resources[resource]?.[action] : undefined;
  if (override) return override.includes(role);
  return m.byOrgRole[role].actions.includes(action);
}

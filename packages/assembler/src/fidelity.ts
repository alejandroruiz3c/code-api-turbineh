import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appRoleMatrix,
  criterionTouches,
  type AppRoleMatrix,
  type Constraints,
  type Fidelity,
  type Permission,
  type WiredPattern,
} from "@turbineh/compiler";
import type { CoverageRule } from "./acceptance.js";
import { GENERATED, type GeneratedFile } from "./entities.js";

/**
 * The request's roles, rules and constraints as app code (ADR-0043): `src/server/permissions.ts` (the role matrix every
 * `can()` reads, per-resource rules and the sign-up email-domain rule), `src/lib/spec-constraints.ts` (time zone,
 * currency, limits, statuses, sort, page size…) and the tests that prove them in this app. Deterministic.
 */
export interface FidelityAssembly {
  fidelity: Fidelity;
  /** Every detected pattern: selected (component + params) or missing (where to implement it). */
  patterns: WiredPattern[];
}

const ALL_ACTIONS: Permission[] = [
  "read",
  "create",
  "update",
  "delete",
  "approve",
  "export",
  "configure",
  "manage_members",
  "view_audit",
];
const CORE = [
  "read",
  "create",
  "update",
  "delete",
  "manage_members",
  "view_audit",
  "see_all_scopes",
];

const ts = (v: unknown) => JSON.stringify(v, null, 2);

/** src/server/permissions.ts from the request's role matrix. */
export function permissionsFile(f: Fidelity, m: AppRoleMatrix): string {
  const rules = f.permissions.rules.map(
    (r) =>
      ` *  - ${r.text}${r.source ? ` — "${r.source.slice(0, 140).replace(/\*\//g, "")}"` : ""}`,
  );
  const assumptions = f.permissions.assumptions.map((a) => ` *  - default: ${a}`);
  return `${GENERATED}
${m.ownKeys ? `import { can as roleCan, type Action } from "@/server/role-policy";\n` : ""}
/**
 * Role matrix from the request (ADR-0043): what each workspace role may do, per action and per resource, and who may
 * sign up. ${m.ownKeys ? "Roles are the request's own keys (domain.membership-access stores them): read, create, update, delete, manage_members, view_audit and see_all_scopes come from src/membership/params.json through src/server/role-policy.ts; approve, export and configure from this matrix." : "Stored roles are owner, admin and member; their labels and rights are the request's roles."}
 * Everything calls \`can()\` from src/server/authz.ts, which asks \`allows()\` here.
${[...rules, ...assumptions].join("\n") || " *  - (the request states no rules: template policy)"}
 */
export type Permission =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "export"
  | "configure"
  | "manage_members"
  | "view_audit"
  | "see_all_scopes";

export interface RolePermissions {
  label: string;
  can: readonly Permission[];
  /** all: the whole workspace; own / membership: only records of their own <of> (src/server/record-access.ts). */
  scope: { kind: "all" | "own" | "membership"; of: string | null };
}

/** Stored role key → what it may do. */
export const ROLE_MATRIX: Record<string, RolePermissions> = ${ts(m.roles)};

/** Per-resource rules (resource = the entity's URL slug): action → roles allowed. */
export const RESOURCE_RULES: Record<string, Partial<Record<Permission, readonly string[]>>> = ${ts(m.resources)};

/** Sign-up restricted to these email domains ([] = no restriction; staff in ADMIN_EMAILS may always sign up). */
export const SIGN_UP_EMAIL_DOMAINS: readonly string[] = ${ts(m.signUpEmailDomains)};
${m.ownKeys ? `\nconst CORE = new Set<Permission>(${JSON.stringify(CORE)});\n` : ""}
/** Whether \`role\` may do \`action\` (on \`resource\`, when a rule names it). Unknown roles may do nothing. */
export function allows(role: string, action: Permission, resource?: string): boolean {
  const rule = resource ? RESOURCE_RULES[resource]?.[action] : undefined;
  if (rule) return rule.includes(role);
${m.ownKeys ? "  if (CORE.has(action)) return roleCan(role, action as Action);\n" : ""}  return ROLE_MATRIX[role]?.can.includes(action) ?? false;
}

/** Whether an email's domain may sign up under SIGN_UP_EMAIL_DOMAINS. */
export function emailDomainAllowed(
  email: string,
  domains: readonly string[] = SIGN_UP_EMAIL_DOMAINS,
): boolean {
  if (domains.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return domains.some((d) => domain === d.toLowerCase());
}
`;
}

const VERB: Partial<Record<Permission, string>> = {
  create: "create",
  update: "edit",
  delete: "delete",
  approve: "approve or reject (change the status)",
  export: "export (download CSV)",
  configure: "change settings",
  manage_members: "invite people and manage members",
  view_audit: "see the audit log",
};

const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

interface UnitTest {
  title: string;
  body: string[];
}

/** One unit test per rule of the request, plus the whole matrix, over the app's real can() and sign-up policy. */
export function permissionTests(f: Fidelity, m: AppRoleMatrix): UnitTest[] {
  const roles = Object.entries(m.roles);
  const labelOf = (k: string) => m.roles[k]?.label ?? k;
  const tests: UnitTest[] = [
    {
      title:
        "each role can do exactly what the request's role matrix lists (roles, permissions), nothing else",
      body: [
        `const actions = ${JSON.stringify(ALL_ACTIONS)} as const;`,
        "for (const [role, rights] of Object.entries(ROLE_MATRIX))",
        "  for (const action of actions)",
        "    expect(can(role, action), `${role} ${action}`).toBe(rights.can.includes(action));",
      ],
    },
  ];
  // Read-only roles.
  for (const [k, r] of roles) {
    const ro = r.can.filter((a) => a !== "see_all_scopes");
    if (ro.length === 1 && ro[0] === "read")
      tests.push({
        title: `${r.label} is read-only: a ${r.label.toLowerCase()} can view but cannot create, edit or delete`,
        body: [
          `expect(can(${JSON.stringify(k)}, "read")).toBe(true);`,
          ...["create", "update", "delete"].map(
            (a) => `expect(can(${JSON.stringify(k)}, "${a}")).toBe(false);`,
          ),
        ],
      });
  }
  // Actions only some roles have (who approves, exports, manages members, sees the audit log…).
  for (const action of [
    "approve",
    "export",
    "manage_members",
    "view_audit",
    "create",
    "update",
    "delete",
  ] as Permission[]) {
    const yes = roles.filter(([, r]) => r.can.includes(action)).map(([k]) => k);
    const no = roles.filter(([, r]) => !r.can.includes(action)).map(([k]) => k);
    if (yes.length === 0 || no.length === 0) continue;
    // Labels shared by several stored roles (Manager → owner and admin) are named once.
    const yesLabels = [...new Set(yes.map(labelOf))];
    const noLabels = [...new Set(no.map(labelOf))].filter((l) => !yesLabels.includes(l));
    if (noLabels.length === 0) continue;
    tests.push({
      title: `only ${list(yesLabels)} can ${VERB[action] ?? action}; ${list(noLabels)} cannot`,
      body: [
        ...yes.map((k) => `expect(can(${JSON.stringify(k)}, "${action}")).toBe(true);`),
        ...no.map((k) => `expect(can(${JSON.stringify(k)}, "${action}")).toBe(false);`),
      ],
    });
  }
  // Per-resource rules ("managers create projects").
  for (const [res, rules] of Object.entries(m.resources)) {
    for (const [action, allowed] of Object.entries(rules) as [Permission, string[]][]) {
      const others = roles.map(([k]) => k).filter((k) => !allowed.includes(k));
      tests.push({
        title: `only ${list([...new Set(allowed.map(labelOf))])} can ${VERB[action] ?? action} ${res.replace(/-/g, " ")}`,
        body: [
          ...allowed.map(
            (k) =>
              `expect(can(${JSON.stringify(k)}, "${action}", ${JSON.stringify(res)})).toBe(true);`,
          ),
          ...others.map(
            (k) =>
              `expect(can(${JSON.stringify(k)}, "${action}", ${JSON.stringify(res)})).toBe(false);`,
          ),
        ],
      });
    }
  }
  // Per-record scopes ("a client only ever sees their own company").
  for (const [k, r] of roles) {
    if (r.scope.kind === "all" || !r.scope.of) continue;
    const what =
      r.scope.kind === "own" ? `their own ${r.scope.of}` : `the ${r.scope.of}s they belong to`;
    tests.push({
      title: `a ${r.label.toLowerCase()} sees only ${what}, not every ${r.scope.of}`,
      body: [
        `expect(ROLE_MATRIX[${JSON.stringify(k)}]?.scope).toEqual(${JSON.stringify(r.scope)});`,
        `expect(can(${JSON.stringify(k)}, "see_all_scopes")).toBe(false);`,
      ],
    });
  }
  // Sign-up email domains.
  if (m.signUpEmailDomains.length > 0) {
    const d = m.signUpEmailDomains[0] ?? "";
    tests.push({
      title: `sign-up accepts only @${list(m.signUpEmailDomains)} emails and rejects any other email domain`,
      body: [
        `expect(maySignUp("ana@${d}", "open", "")).toBe(true);`,
        `expect(maySignUp("Ana@${d.toUpperCase()}", "open", "")).toBe(true);`,
        `expect(maySignUp("eve@example.com", "open", "")).toBe(false);`,
        `expect(maySignUp("eve@${d}.evil.io", "open", "")).toBe(false);`,
      ],
    });
  }
  void f;
  return tests;
}

export function permissionsTestFile(tests: UnitTest[], hasSignUp: boolean): string {
  return `${GENERATED}
import { describe, expect, it, vi } from "vitest";
import { can } from "@/server/authz";
import { ROLE_MATRIX } from "@/server/permissions";
${hasSignUp ? 'import { maySignUp } from "@/lib/staff";\n' : ""}
vi.mock("@/lib/auth", () => ({ auth: { api: {} } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(\`redirect:\${to}\`);
  },
}));
vi.mock("@/env", () => ({ env: { ADMIN_EMAILS: "" } }));

/** The request's roles and rules (src/server/permissions.ts), checked through the app's own can(). */
describe("roles and rules from the request", () => {
${tests
  .map(
    (t) => `  it(${JSON.stringify(t.title)}, () => {
${t.body.map((l) => `    ${l}`).join("\n")}
  });`,
  )
  .join("\n\n")}
});
`;
}

/** E2E proof of the sign-up email-domain rule through the real sign-up form and server. */
export function signUpDomainsE2E(domains: string[]): string {
  const d = list(domains.map((x) => `@${x}`));
  return `${GENERATED}
import { expect, test } from "@playwright/test";
import { PASSWORD } from "./helpers";

test("attempts to sign up with a non-${d} email are rejected by the server (no registration)", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name", { exact: true }).fill("Outside Visitor");
  await page.getByLabel("Email").fill(\`visitor-\${Date.now()}@example.com\`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Workspace name").fill("Not allowed");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/Sign-up is limited to/)).toBeVisible();
  await expect(page).toHaveURL(/\\/sign-up/);
});
`;
}

/** src/lib/spec-constraints.ts from the request. */
export function specConstraintsFile(c: Constraints): string {
  const statuses = Object.fromEntries(c.statusLists.map((l) => [l.field, l.values]));
  const value = {
    timeZone: c.timeZone.value,
    currency: c.currency,
    pageSize: c.pageSize ?? 20,
    uploads: c.uploads
      ? {
          maxBytes: c.uploads.maxBytes ?? 10 * 1024 * 1024,
          types: c.uploads.types.length
            ? c.uploads.types
            : ["application/pdf", "image/jpeg", "image/png"],
          private: c.uploads.private,
        }
      : null,
    noticeHours: c.notice?.hours ?? null,
    openingHours: c.openingHours,
    statuses,
    sort: c.sort,
    schedules: c.schedules,
    emailDomains: c.emailDomains,
    numbers: Object.fromEntries(c.numbers.map((n) => [n.what, n.value])),
  };
  const assumptions = [...c.assumptions, ...(c.pageSize ? [] : ["Page size not stated: 20."])];
  return `${GENERATED}
/**
 * Constraints stated in the request (ADR-0043): time zone, currency, limits, notice, opening hours, statuses, sort
 * order and page size, extracted by code. Anything the request did not say is a documented default (ASSUMPTIONS).
 * Lists, forms, validation and components read these values instead of hard-coding them.
 */
export interface SpecConstraints {
  timeZone: string;
  currency: string | null;
  pageSize: number;
  uploads: { maxBytes: number; types: readonly string[]; private: boolean } | null;
  noticeHours: number | null;
  openingHours: readonly { weekday: number; open: string; close: string }[];
  statuses: Readonly<Record<string, readonly string[]>>;
  sort: readonly { field: string; direction: "asc" | "desc" }[];
  schedules: readonly { what: string; cron: string; timeZone: string }[];
  emailDomains: readonly string[];
  numbers: Readonly<Record<string, number>>;
}

export const SPEC_CONSTRAINTS: SpecConstraints = ${ts(value)};

/** Defaults used because the request did not say. */
export const ASSUMPTIONS: readonly string[] = ${ts(assumptions)};
`;
}

export function specConstraintsTest(c: Constraints): string {
  const statusLines = c.statusLists.map(
    (l) =>
      `    expect(SPEC_CONSTRAINTS.statuses[${JSON.stringify(l.field)}]).toEqual(${JSON.stringify(l.values)});`,
  );
  return `${GENERATED}
import { describe, expect, it } from "vitest";
import { PAGE_SIZE } from "@/lib/pagination";
import { SPEC_CONSTRAINTS } from "@/lib/spec-constraints";

describe("constraints from the request", () => {
  it("uses the request's time zone (${c.timeZone.value}), page size and statuses", () => {
    expect(SPEC_CONSTRAINTS.timeZone).toBe(${JSON.stringify(c.timeZone.value)});
    // A real IANA zone: formatting a date in it does not throw.
    expect(() => new Intl.DateTimeFormat("en-GB", { timeZone: SPEC_CONSTRAINTS.timeZone })).not.toThrow();
    expect(PAGE_SIZE).toBe(SPEC_CONSTRAINTS.pageSize);
    expect(PAGE_SIZE).toBeGreaterThan(0);
${statusLines.join("\n")}
  });
});
`;
}

/** Every generated fidelity file. */
export function fidelityFiles(
  a: FidelityAssembly,
  m: AppRoleMatrix,
): { files: GeneratedFile[]; unit: UnitTest[] } {
  const unit = permissionTests(a.fidelity, m);
  const files: GeneratedFile[] = [
    { path: "src/server/permissions.ts", content: permissionsFile(a.fidelity, m) },
    { path: "src/lib/spec-constraints.ts", content: specConstraintsFile(a.fidelity.constraints) },
    {
      path: "tests/unit/permissions.test.ts",
      content: permissionsTestFile(unit, m.signUpEmailDomains.length > 0),
    },
    {
      path: "tests/unit/spec-constraints.test.ts",
      content: specConstraintsTest(a.fidelity.constraints),
    },
    ...(m.signUpEmailDomains.length > 0
      ? [
          {
            path: "tests/e2e/sign-up-domains.spec.ts",
            content: signUpDomainsE2E(m.signUpEmailDomains),
          },
        ]
      : []),
  ];
  return { files, unit };
}

/** The role matrix as stored in this app (request's keys when domain.membership-access is selected). */
export function storedMatrix(a: FidelityAssembly): AppRoleMatrix {
  const membership = a.patterns.some(
    (p) => p.id === "membership-access" && p.status === "selected",
  );
  return appRoleMatrix(a.fidelity.permissions, membership);
}

/**
 * Coverage rules for the generated permission tests (unit and the sign-up E2E): precision first, each needs the
 * full proof check (title and assertions exercise the criterion's subject, action, actor and negation).
 */
export function fidelityCoverage(outDir: string, unit: UnitTest[]): CoverageRule[] {
  const rules: CoverageRule[] = unit.map((t) => ({
    test: `tests/unit/permissions.test.ts › ${t.title}`,
    covers: ["."],
    from: "generated",
    proof: { title: t.title, assertions: t.body },
  }));
  const e2e = join(outDir, "tests/e2e/sign-up-domains.spec.ts");
  if (existsSync(e2e)) {
    const src = readFileSync(e2e, "utf8");
    const title = /test\("([^"]+)"/.exec(src)?.[1];
    if (title)
      rules.push({
        test: `tests/e2e/sign-up-domains.spec.ts › ${title}`,
        covers: ["."],
        from: "generated",
        proof: { title, assertions: src.split("\n").filter((l) => /expect\(|fill\(/.test(l)) },
      });
  }
  return rules;
}

/** Criteria a missing pattern touches: a hand-written rule alone cannot mark them met (precision first). */
export function strictCriteria(a: FidelityAssembly | undefined): (criterion: string) => boolean {
  if (!a) return () => false;
  const missing = a.fidelity.patterns.filter((p) =>
    a.patterns.some((w) => w.id === p.id && w.status === "missing"),
  );
  return (criterion) => missing.some((p) => criterionTouches(criterion, p));
}

import { appRoleMatrix, extractPermissions, type BuildSpec } from "@turbineh/compiler";
import { describe, expect, it } from "vitest";
import { FIELD_LIMITS, generateEntity, zodField } from "./entities.js";
import { permissionTests } from "./fidelity.js";

type Entity = BuildSpec["entities"][number];

const teacher: Entity = {
  name: "Teacher",
  fields: [{ name: "fullName", type: "string", required: true }],
} as Entity;
const request: Entity = {
  name: "Request",
  fields: [
    { name: "title", type: "string", required: true },
    { name: "accessToken", type: "string", required: true },
    { name: "apiKey", type: "string", required: false },
    { name: "workspaceId", type: "string", required: false },
    { name: "status", type: "enum", required: true, options: ["Open", "Approved", "Rejected"] },
    { name: "approvedAt", type: "datetime", required: false },
    { name: "approvedBy", type: "string", required: false },
    { name: "amount", type: "decimal", required: true },
    { name: "quota", type: "integer", required: false },
    { name: "balance", type: "decimal", required: false },
    { name: "startsAt", type: "datetime", required: true },
    { name: "teacher", type: "string", required: true },
  ],
} as Entity;

const files = generateEntity(request, { csvExport: true, csvImport: true }, [request, teacher]);
const file = (p: string) => files.find((f) => f.path === p)?.content ?? "";
const table = file("src/db/tables/requests.ts");
const schema = file("src/entities/requests/schema.ts");
const actions = file("src/entities/requests/actions.ts");
const page = file("src/app/dashboard/requests/page.tsx");
const edit = file("src/app/dashboard/requests/[id]/edit/page.tsx");
const exportRoute = file("src/app/dashboard/requests/export/route.ts");
const e2e = file("tests/e2e/requests.spec.ts");
const rules = file("src/entities/requests/rules.ts");

describe("generated apps never store or show secrets (F01)", () => {
  it("no column, form field, list cell, CSV column or E2E value for a token or API key", () => {
    for (const src of [table, schema, actions, page, edit, exportRoute, e2e]) {
      expect(src).not.toMatch(/accessToken|access_token|apiKey|api_key/);
    }
  });
});

describe("workflow state and tenant ids are never typed in a form (F06, F10)", () => {
  it("status and its lifecycle stamps are not inputs; a role-gated transition changes them", () => {
    const input = /create\w+Schema = z\.object\(\{([\s\S]*?)\n\}\);/.exec(schema)?.[1] ?? "";
    expect(input).not.toMatch(/\bstatus:|approvedAt:|approvedBy:|workspaceId:/);
    expect(table).not.toContain("workspace_id");
    expect(table).toContain('status: varchar("status", { length: 64 }).notNull().default("Open")');
    expect(actions).toContain("export async function changeRequestStatus(");
    expect(actions).toContain('if (!can(ctx.role, "approve", "requests"))');
    expect(actions).toMatch(
      /to === "Approved" \? \{ approvedAt: new Date\(\), approvedAtTimeZone: "UTC", approvedBy: ctx\.email \}/,
    );
    expect(page).not.toMatch(/name="status"/);
    expect(edit).toContain("changeRequestStatus");
    expect(edit).toContain("canChangeStatus");
  });
});

describe("a status without listed values is still changed only by its transition", () => {
  it("free-text status: not an input, changed by a role-gated action with a bounded text", () => {
    const loan = {
      name: "Loan",
      fields: [
        { name: "title", type: "string", required: true },
        { name: "status", type: "enum", required: true },
      ],
    } as Entity;
    const out = generateEntity(loan, { csvExport: false, csvImport: false }, [loan]);
    const s = out.find((f) => f.path === "src/entities/loans/schema.ts")?.content ?? "";
    const a = out.find((f) => f.path === "src/entities/loans/actions.ts")?.content ?? "";
    const ed =
      out.find((f) => f.path === "src/app/dashboard/loans/[id]/edit/page.tsx")?.content ?? "";
    expect(/Schema = z\.object\(\{([\s\S]*?)\n\}\);/.exec(s)?.[1] ?? "").not.toMatch(/\bstatus:/);
    expect(a).toContain("export async function changeLoanStatus(");
    expect(a).toContain(
      `z.string().trim().min(1).max(${FIELD_LIMITS.enum}).parse(formData.get("status"))`,
    );
    expect(ed).toContain('name="status" type="text"');
  });
});

describe("references are tenant-scoped foreign keys resolved by the server (F10)", () => {
  it("the table has a composite (organization, id) foreign key and the server resolves the typed value", () => {
    expect(table).toContain('teacherRecordId: uuid("teacher_record_id")');
    expect(table).toContain("columns: [t.organizationId, t.teacherRecordId]");
    expect(table).toContain("foreignColumns: [teachers.organizationId, teachers.id]");
    expect(table).toContain('unique("requests_organization_id_id_key").on(t.organizationId, t.id)');
    expect(actions).toContain("async function teacherRecordId(organizationId: string");
    expect(actions).toContain("eq(teachers.organizationId, organizationId)");
    expect(actions).toContain("Choose an existing teacher");
  });
});

describe("one source of limits, non-negative numbers and enums (F11)", () => {
  it("the schema and the column use the same lengths and ranges; the database checks values", () => {
    expect(
      zodField({ name: "code", type: "enum", required: true } as Entity["fields"][number]),
    ).toContain(`max(${FIELD_LIMITS.enum})`);
    expect(
      zodField({ name: "ref", type: "reference", required: true } as Entity["fields"][number]),
    ).toContain(`max(${FIELD_LIMITS.reference})`);
    expect(schema).toContain("amount: z.coerce.number().finite().min(0)");
    expect(schema).toContain("quota: z.coerce.number().int().min(0)");
    expect(schema).toContain("balance: z.coerce.number().finite().min(-9999999999.99)");
    expect(table).toContain("requests_amount_non_negative");
    expect(table).toContain("requests_quota_non_negative");
    expect(table).not.toContain("requests_balance_non_negative");
    expect(table).toContain("in ('Open', 'Approved', 'Rejected')");
  });
});

describe("dates and times are stored in UTC with their IANA zone (F12)", () => {
  it("adds the zone column, sends the browser zone and converts on the server", () => {
    expect(table).toContain(
      'startsAtTimeZone: varchar("starts_at_time_zone", { length: 64 }).notNull().default("UTC")',
    );
    expect(schema).toContain("startsAtTimeZone: timeZone,");
    expect(schema).toContain("startsAt: zonedToUtc(input.startsAt, input.startsAtTimeZone)");
    expect(page).toContain('<TimeZoneField name="startsAtTimeZone" />');
    expect(edit).toContain("toDateTimeInput(row.startsAt, row.startsAtTimeZone)");
  });
});

describe("a change and its audit entry are one transaction (F14)", () => {
  it("every mutation writes its audit entry with the transaction", () => {
    expect(actions).not.toMatch(/await db\.insert\(|await db\.update\(|await db\s*\n\s*\.delete\(/);
    expect((actions.match(/await audit\(\{[^\n]*\}, tx\);/g) ?? []).length).toBeGreaterThanOrEqual(
      5,
    );
    expect(actions).not.toMatch(/await audit\(\{[^\n]*\}\);/);
  });
});

describe("rate limits are awaited and exports never silently truncated (F15, F21)", () => {
  it("awaits every limiter and refuses oversize exports explicitly", () => {
    expect(actions).not.toMatch(/!rateLimit\(/);
    expect(actions).toContain("if (!(await rateLimit(`create:requests:");
    expect(exportRoute).toContain(".limit(EXPORT_MAX_ROWS + 1)");
    expect(exportRoute).toContain("return exportTooLarge();");
    expect(exportRoute).not.toContain("10_000");
  });
});

describe("rules of the request never vanish (F06)", () => {
  it("the rules stub points to the ledger instead of claiming none were requested", () => {
    expect(rules).not.toContain("none were requested");
    expect(rules).toContain('TURBINEH_REPORT.md under "Business rules"');
  });
});

describe("permission tests use fixed expectations (F17)", () => {
  it("never compares can() with the ROLE_MATRIX it reads; members get fixed negatives", () => {
    const perms = extractPermissions(
      "A tool for admins to manage the inventory and export reports.",
    );
    const m = appRoleMatrix(perms, false);
    const tests = permissionTests(
      {
        permissions: perms,
        entities: [],
        constraints: {} as never,
        patterns: [],
        decider: { asked: 0, latencyMs: 0 },
      } as never,
      m,
    );
    const body = tests.map((t) => t.body.join("\n")).join("\n");
    expect(body).not.toContain("rights.can.includes");
    expect(body).toContain('"member":{"read":true,"create":true,"update":false');
    const negatives = tests.find((t) => t.title.startsWith("a member cannot approve"));
    expect(negatives?.body).toEqual([
      'expect(can("member", "approve")).toBe(false);',
      'expect(can("member", "export")).toBe(false);',
      'expect(can("member", "configure")).toBe(false);',
      'expect(can("member", "manage_members")).toBe(false);',
      'expect(can("member", "view_audit")).toBe(false);',
    ]);
  });
});

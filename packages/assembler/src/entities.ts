import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildSpec } from "@turbineh/compiler";
import { camel, entityNames, label, snake, words } from "./naming.js";

/** Header on every generated (non-catalog) file, so reused vs generated is measured honestly. */
export const GENERATED = "// turbineh:generated";

type Entity = BuildSpec["entities"][number];
type Field = Entity["fields"][number];

/** Entities the auth component already provides; never generated again. */
const AUTH_PROVIDED = new Set([
  "user",
  "users",
  "organization",
  "organizations",
  "member",
  "members",
  "session",
  "account",
  "invitation",
  "verification",
  "workspace",
  "tenant",
]);
/** Columns the generator owns; model-proposed duplicates are dropped. */
const RESERVED_FIELDS = new Set([
  "id",
  "organizationId",
  "createdAt",
  "updatedAt",
  "password",
  "passwordHash",
  "orgId",
  "tenantId",
]);

/**
 * Tables already defined in the app by the recipe (`src/db/recipe-tables.ts`) or by native components
 * (`src/db/component-*.ts`): a generated entity with the same table would collide (e.g. a "Subscription" entity
 * next to payments.subscriptions), so those entities are covered by what is already there.
 */
export function providedTables(appDir: string): string[] {
  const dbDir = join(appDir, "src/db");
  if (!existsSync(dbDir)) return [];
  return readdirSync(dbDir)
    .filter((f) => f === "recipe-tables.ts" || /^component-[a-z0-9-]+\.ts$/.test(f))
    .flatMap((f) => [
      ...readFileSync(join(dbDir, f), "utf8").matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g),
    ])
    .map((m) => m[1] ?? "")
    .filter(Boolean);
}

export function entitiesToGenerate(spec: BuildSpec, providedByRecipe: string[] = []): Entity[] {
  const seen = new Set<string>(providedByRecipe.map((p) => entityNames(p).table));
  return spec.entities.filter((e) => {
    const n = entityNames(e.name);
    if (AUTH_PROVIDED.has(n.table) || AUTH_PROVIDED.has(e.name.toLowerCase()) || seen.has(n.table))
      return false;
    seen.add(n.table);
    return true;
  });
}

export function fieldsOf(e: Entity): Field[] {
  const seen = new Set<string>();
  return e.fields.filter((f) => {
    const key = camel(f.name);
    if (RESERVED_FIELDS.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function column(f: Field): string {
  const c = snake(f.name);
  const base = {
    string: `varchar("${c}", { length: 255 })`,
    email: `varchar("${c}", { length: 320 })`,
    text: `text("${c}")`,
    enum: `varchar("${c}", { length: 64 })`,
    file: `text("${c}")`,
    reference: `varchar("${c}", { length: 64 })`,
    integer: `integer("${c}")`,
    decimal: `numeric("${c}", { precision: 12, scale: 2 })`,
    boolean: `boolean("${c}")`,
    date: `date("${c}")`,
    datetime: `timestamp("${c}", { withTimezone: true })`,
    tags: `text("${c}").array()`,
  }[f.type];
  if (f.type === "tags") return `${base}.notNull().default([])`;
  const req = f.required && f.type !== "boolean" ? ".notNull()" : "";
  const def = f.type === "boolean" ? ".notNull().default(false)" : "";
  return `${base}${req}${def}`;
}

export function zodField(f: Field): string {
  const opt = (s: string) => (f.required ? s : `${s}.optional()`);
  const str = (max: number) =>
    f.required
      ? `z.string().trim().min(1).max(${max})`
      : `z.string().trim().max(${max}).transform((v) => v || undefined).optional()`;
  if (f.type === "enum" && f.options?.length) {
    const e = `z.enum(${JSON.stringify(f.options)})`;
    return f.required ? e : `z.union([${e}, z.literal("").transform(() => undefined)]).optional()`;
  }
  switch (f.type) {
    case "tags":
      // Comma- or semicolon-separated, normalised (lowercase, unique, at most 20).
      return `z.string().trim().max(500).default("").transform((v) => [...new Set(v.split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20).map((t) => t.slice(0, 40)))`;
    case "string":
    case "enum":
    case "reference":
      return str(255);
    case "file":
      return f.required
        ? `z.url()`
        : `z.union([z.url(), z.literal("").transform(() => undefined)]).optional()`;
    case "text":
      return str(5000);
    case "email":
      return f.required
        ? `z.email()`
        : `z.union([z.email(), z.literal("").transform(() => undefined)]).optional()`;
    case "integer":
      return opt(`z.coerce.number().int().min(-2147483648).max(2147483647)`);
    case "decimal":
      return opt(`z.coerce.number().finite()`);
    case "boolean":
      return `z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean())`;
    case "date":
      return f.required
        ? `z.iso.date()`
        : `z.union([z.iso.date(), z.literal("").transform(() => undefined)]).optional()`;
    case "datetime":
      return f.required
        ? `z.coerce.date()`
        : `z.union([z.coerce.date(), z.literal("").transform(() => undefined)]).optional()`;
  }
}

export function inputType(f: Field): string {
  return {
    string: "text",
    enum: "text",
    reference: "text",
    file: "url",
    text: "text",
    email: "email",
    integer: "number",
    decimal: "number",
    boolean: "checkbox",
    date: "date",
    datetime: "datetime-local",
    tags: "text",
  }[f.type];
}

/** An enum field with the values the request lists (rendered as a select). */
export const hasOptions = (f: Field): f is Field & { options: string[] } =>
  f.type === "enum" && Array.isArray(f.options) && f.options.length > 0;

/** A text field that holds an email address (the compiler sometimes types it as plain text). */
const emailLike = (f: Field) =>
  f.type === "email" || (f.type === "string" && /e-?mail/i.test(f.name));

/** Sample values used by the generated E2E test (deterministic). */
export function sampleValue(f: Field, entityLabel: string, nth = 0): string {
  if (emailLike(f)) return "e2e@example.com";
  if (hasOptions(f)) return f.options[0] ?? "";
  switch (f.type) {
    case "tags":
      return "interview, research";
    case "email":
      return "e2e@example.com";
    case "integer":
      return "7";
    case "decimal":
      return "12.5";
    case "date":
      return `2026-10-${String(13 + nth).padStart(2, "0")}`;
    case "datetime":
      return `2026-10-${String(13 + nth).padStart(2, "0")}T10:30`;
    case "file":
      return "https://example.com/file.pdf";
    case "boolean":
      return "on";
    default:
      return `${entityLabel} ${label(f.name)} sample`;
  }
}

/** Position of a date/datetime field among the entity's fields of that kind (later fields get later sample dates). */
export function nthOfType(fields: Field[], f: Field): number {
  if (f.type !== "date" && f.type !== "datetime") return 0;
  return fields.filter((x) => x.type === f.type).indexOf(f);
}

/**
 * The imported sample differs from the created one in every text-like field, so uniqueness or "one per person"
 * business rules do not reject the app's own end-to-end fixtures.
 */
export function importedSample(f: Field, value: string, suffix: string): string {
  if (emailLike(f)) return value.replace("@", `+${suffix}@`);
  if (hasOptions(f)) return value;
  // Tags in a CSV cell are separated by semicolons (commas separate cells).
  if (f.type === "tags") return value.replace(/,\s*/g, ";");
  // A reference keeps pointing to the same record (rules may require that it exists).
  if (["string", "text", "enum"].includes(f.type)) return `${value} ${suffix}`;
  return value;
}

/** First plain text field: what people type to identify a record (and what a reference to it holds). */
export function displayField(e: Entity): Field | undefined {
  return fieldsOf(e).find(
    (f) => ["string", "text", "enum"].includes(f.type) && words(f.name).at(-1) !== "id",
  );
}

/**
 * Entity a reference field points to: a `reference` field, or a text field, named after another generated entity
 * ("teacher", "teacherId", "room_id" → Teacher, Room) that has a display field. The compiler often types a link as
 * plain text, so the name decides. Deterministic; null when nothing matches.
 */
export function referenceTarget(f: Field, self: Entity, all: Entity[]): Entity | null {
  if (!["reference", "string"].includes(f.type)) return null;
  const w = words(f.name);
  const key = (w.at(-1) === "id" ? w.slice(0, -1) : w).join(" ");
  if (!key) return null;
  const target = all.find((e) => {
    if (e.name === self.name) return false;
    const n = words(e.name).join(" ");
    return n === key || `${n}s` === key || `${n}es` === key;
  });
  return target && displayField(target) ? target : null;
}

/**
 * Values with which an entity's end-to-end test creates a record of a referenced entity first (same samples as that
 * entity's own test, made distinct per referencing entity so uniqueness rules on it accept both).
 */
export function seedSample(
  target: Entity,
  forEntity: Entity,
  all: Entity[],
  variant = "",
): Record<string, string> {
  const fields = fieldsOf(target);
  const display = displayField(target);
  const suffix = `for-${entityNames(forEntity.name).slug}${variant ? `-${variant}` : ""}`;
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (!f.required && f !== display) continue;
    const v = sampleFor(target, f, all);
    out[camel(f.name)] =
      f.type === "boolean"
        ? "on"
        : referenceTarget(f, target, all)
          ? v
          : importedSample(f, v, suffix);
  }
  return out;
}

/**
 * Sample of a field; a reference to another generated entity holds that entity's seeded display value. The
 * "imported" variant points to a second seeded record, so "one per person" rules accept the created and the imported
 * samples together.
 */
export function sampleFor(e: Entity, f: Field, all: Entity[], variant = ""): string {
  const fields = fieldsOf(e);
  const target = referenceTarget(f, e, all);
  if (target) {
    const display = displayField(target);
    if (display) {
      const seed = seedSample(
        target,
        e,
        all.filter((x) => x.name !== e.name),
        variant,
      );
      const value = seed[camel(display.name)];
      if (value) return value;
    }
  }
  return sampleValue(f, entityNames(e.name).labelSingular, nthOfType(fields, f));
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * How an entity is generated, from its kind (ADR-0042 §1): `crud` (business), `settings` (configuration: owners and
 * admins set values under /dashboard/settings, upsert by the first field, no delete).
 */
export interface EntityOptions {
  variant?: "crud" | "settings";
  /** Append-only histories of this entity: written on every change of the tracked field, shown as a timeline. */
  events?: EventLink[];
  /** Child lists (comments, messages, phases…) added and listed on this entity's edit page. */
  children?: ChildLink[];
  /** Default order of the list: one of the entity's date fields, as the request states it. */
  sort?: { field: string; direction: "asc" | "desc" } | null;
  /** Role-matrix resource of this entity (src/server/permissions.ts RESOURCE_RULES); default: its URL slug. */
  resource?: string;
  /**
   * The entity's status is a workflow of domain.workflow.turbineh: each new record starts a workflow item (initial
   * state, history, role-gated transitions) linked by subjectId; the list shows the state and links to it.
   */
  workflow?: { key: string; dueField: string | null } | null;
  /**
   * Per-record scope (domain.membership-access.turbineh): the field holding the scope id (company, project, shop).
   * Lists show only visible scopes; single records are checked with canSeeScope (src/server/record-access.ts).
   */
  scope?: { field: string; label: string } | null;
  /** The app has the audit log page (domain.audit-log.turbineh): the edit test checks the change is recorded there. */
  auditLog?: boolean;
  /** The request's name for the owner role (e.g. "Manager"): generated E2E titles name the actor that way. */
  ownerLabel?: string;
}

/** An event entity attached to its parent. Field names are camelCase names of the event entity. */
export interface EventLink {
  event: Entity;
  /** Event field holding the parent id. */
  parentField: string;
  /** Parent field whose changes are recorded (status, stage…); null = timeline only. */
  tracked: string | null;
  map: { from?: string; to?: string; actor?: string; at?: string };
}

/** A child entity managed on its parent's page. */
export interface ChildLink {
  child: Entity;
  /** Child field holding the parent id. */
  parentField: string;
  /** What the E2E test types into the child's form on the parent page (label, sample, select or checkbox). */
  fills?: { label: string; value: string; select: boolean; check: boolean }[];
}

/** Optional features switched on by components selected for the build. */
export interface EntityFeatures {
  csvExport: boolean;
  csvImport: boolean;
}

/** `await recordX({...})` for an event link: parent id, previous and new value of the tracked field, actor, time. */
function eventCall(l: EventLink, id: string, from: string, to: string): string {
  const en = entityNames(l.event.name);
  const at = fieldsOf(l.event).find((f) => camel(f.name) === l.map.at);
  const parts = ["organizationId: ctx.organizationId", `${l.parentField}: ${id}`];
  if (l.map.from) parts.push(`${l.map.from}: ${from}`);
  if (l.map.to) parts.push(`${l.map.to}: ${to}`);
  if (l.map.actor) parts.push(`${l.map.actor}: ctx.email`);
  if (l.map.at)
    parts.push(
      `${l.map.at}: ${at?.type === "date" ? "new Date().toISOString().slice(0, 10)" : "new Date()"}`,
    );
  return `await record${en.pascal}({ ${parts.join(", ")} });`;
}

/**
 * All files for one entity: table, form schema, server actions (create, update, delete, optional CSV import), list
 * and edit pages, optional CSV export route and E2E tests. `all` are the entities generated in the same app (reference
 * fields to them get coherent samples and seeded records in the E2E test).
 */
export function generateEntity(
  e: Entity,
  features: EntityFeatures = { csvExport: false, csvImport: false },
  all: Entity[] = [e],
  opts: EntityOptions = {},
): GeneratedFile[] {
  const n = entityNames(e.name);
  const fields = fieldsOf(e);
  const settings = opts.variant === "settings";
  // Who the generated E2E tests act as: the owner, named as the request names that role ("manager (owner)").
  const actor =
    opts.ownerLabel && opts.ownerLabel.toLowerCase() !== "owner"
      ? `${opts.ownerLabel.toLowerCase()} (owner)`
      : "owner";
  const base = settings ? `/dashboard/settings/${n.slug}` : `/dashboard/${n.slug}`;
  // The role matrix: can(role, action, resource) (src/server/permissions.ts). Settings need "configure".
  const resource = JSON.stringify(opts.resource ?? n.slug);
  const act = (a: "create" | "update" | "delete") =>
    settings ? `"configure", ${resource}` : `"${a}", ${resource}`;
  const workflow = settings ? null : (opts.workflow ?? null);
  const scope = opts.scope ?? null;
  const scopeKey = scope ? camel(scope.field) : null;
  // Title of the workflow item: what identifies the record (its first text field and first date), else its label.
  const titleParts = [
    fieldsOf(e).find((f) => ["string", "text"].includes(f.type) && !/id$/i.test(f.name)),
    fieldsOf(e).find((f) => f.type === "date" || f.type === "datetime"),
  ].filter((f): f is Field => Boolean(f));
  const workflowTitle = titleParts.length
    ? `[${titleParts.map((f) => `input.${camel(f.name)}`).join(", ")}].filter((v) => v !== undefined && v !== null && String(v).trim() !== "").map(String).join(" · ") || ${JSON.stringify(n.labelSingular)}`
    : JSON.stringify(n.labelSingular);
  const events = opts.events ?? [];
  const children = opts.children ?? [];
  const tagField = fields.find((f) => f.type === "tags");
  // Settings are keyed by their first required text field (e.g. the stage a limit applies to).
  const settingKey = fields.find(
    (f) => f.required && ["string", "enum", "reference", "email"].includes(f.type),
  );
  const sortField = opts.sort
    ? (fields.find(
        (f) =>
          (f.type === "date" || f.type === "datetime") &&
          words(f.name)
            .join(" ")
            .includes(opts.sort?.field ?? "\u0000"),
      ) ??
      (/date|time/.test(opts.sort.field)
        ? fields.find((f) => f.type === "date" || f.type === "datetime")
        : undefined))
    : undefined;
  const pgImports = new Set(["pgTable", "uuid", "varchar", "timestamp"]);
  for (const f of fields) {
    const fn = column(f).split("(")[0] ?? "";
    pgImports.add(fn);
  }

  const table = `${GENERATED}
import { ${[...pgImports].sort().join(", ")} } from "drizzle-orm/pg-core";

export const ${n.variable} = pgTable("${n.table}", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: varchar("organization_id", { length: 64 }).notNull(),
${fields.map((f) => `  ${camel(f.name)}: ${column(f)},`).join("\n")}
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
`;

  const toRow = fields
    .map((f) => {
      const k = camel(f.name);
      if (f.type === "boolean") return `    ${k}: input.${k},`;
      if (f.type === "decimal")
        return f.required
          ? `    ${k}: String(input.${k}),`
          : `    ${k}: input.${k} === undefined ? null : String(input.${k}),`;
      return f.required ? `    ${k}: input.${k},` : `    ${k}: input.${k} ?? null,`;
    })
    .join("\n");

  const schema = `${GENERATED}
import { z } from "zod";
import type { ${n.variable} } from "@/db/tables/${n.slug}";
import type { EntityRules } from "@/lib/rules";
import type { ${n.pascal}Related } from "./related";

/** Input validation for ${n.labelPlural} (Security Pack: every boundary is validated). */
export const create${n.pascal}Schema = z.object({
${fields.map((f) => `  ${camel(f.name)}: ${zodField(f)},`).join("\n")}
});

export type Create${n.pascal}Input = z.infer<typeof create${n.pascal}Schema>;
export type ${n.pascal}Row = typeof ${n.variable}.$inferSelect;
export type ${n.pascal}Rules = EntityRules<Create${n.pascal}Input, ${n.pascal}Row, ${n.pascal}Related>;

/** Column values of a validated input (the workspace, id and creation date are added by the server). */
export function to${n.pascal}Values(input: Create${n.pascal}Input) {
  return {
${toRow}
  };
}
`;

  const rules = `${GENERATED}
import type { ${n.pascal}Rules } from "./schema";

/**
 * Business rules for ${n.labelPlural.toLowerCase()}: none were requested for this app. When the request contains rules,
 * the Backup Coder (trigger T3) writes them here with their own unit tests.
 */
export const check${n.pascal}Rules: ${n.pascal}Rules = () => Promise.resolve(null);
`;

  const related = `${GENERATED}
import { bindRelated } from "@/lib/rules";

/**
 * Related records the business rules of ${n.labelPlural.toLowerCase()} may read (read-only, same workspace, bounded): none
 * for this app. When a rule needs another entity, TurbineH writes its loader here (code, never a model).
 */
export const related${n.pascal}Loaders = {};

export const related${n.pascal} = (organizationId: string) => bindRelated(related${n.pascal}Loaders, organizationId);
export type ${n.pascal}Related = ReturnType<typeof related${n.pascal}>;
`;

  const actions = `${GENERATED}
"use server";
import { and, desc, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
import { audit } from "@/lib/audit";
${features.csvImport ? `import { CSV_LIMITS, parseCsv } from "@/lib/csv";\n` : ""}import { UserFacingError } from "@/security/errors";
import { RULES_SCAN_LIMIT } from "@/lib/rules";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
${scope ? `import { canSeeScope } from "@/server/record-access";\n` : ""}${workflow ? `import { createItem } from "@/workflow/service";\n` : ""}${events
    .filter((l) => l.tracked)
    .map((l) => {
      const en = entityNames(l.event.name);
      return `import { record${en.pascal} } from "@/entities/${en.slug}/record";\n`;
    })
    .join("")}import { related${n.pascal} } from "./related";
import { check${n.pascal}Rules } from "./rules";
import { create${n.pascal}Schema, to${n.pascal}Values, type ${n.pascal}Row } from "./schema";

/** Records the business rules may inspect: same workspace only, newest first, bounded; never the record being changed. */
function existing${n.pascal}(organizationId: string, exceptId?: string): Promise<${n.pascal}Row[]> {
  return db
    .select()
    .from(${n.variable})
    .where(
      and(
        eq(${n.variable}.organizationId, organizationId),
        exceptId ? ne(${n.variable}.id, exceptId) : undefined,
      ),
    )
    .orderBy(desc(${n.variable}.createdAt))
    .limit(RULES_SCAN_LIMIT);
}

export async function create${n.pascal}(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, ${act("create")})) throw new UserFacingError("You are not allowed to create ${n.labelPlural.toLowerCase()}.");
  if (!rateLimit(\`create:${n.table}:\${ctx.userId}\`)) throw new UserFacingError("Too many requests. Try again later.");
  const input = create${n.pascal}Schema.parse(Object.fromEntries(formData));
  const violation = await check${n.pascal}Rules(input, {
    operation: "create",
    previous: null,
    existing: () => existing${n.pascal}(ctx.organizationId),
    related: related${n.pascal}(ctx.organizationId),
  });
  if (violation) throw new UserFacingError(violation);
${
  scope
    ? `  if (!(await canSeeScope(ctx, input.${scopeKey} ?? null))) throw new UserFacingError("Choose one of your ${scope.label.toLowerCase()} options.");\n`
    : ""
}${
    settings && settingKey
      ? `  // A setting is one row per ${label(settingKey.name).toLowerCase()}: saving an existing one updates it (no duplicates, no delete).
  const [same] = await db
    .select({ id: ${n.variable}.id })
    .from(${n.variable})
    .where(and(eq(${n.variable}.organizationId, ctx.organizationId), eq(${n.variable}.${camel(settingKey.name)}, to${n.pascal}Values(input).${camel(settingKey.name)})))
    .limit(1);
  if (same) {
    await db.update(${n.variable}).set(to${n.pascal}Values(input)).where(eq(${n.variable}.id, same.id));
    await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, actorEmail: ctx.email, action: "${n.slug}.updated", subjectType: "${n.labelSingular}", subjectId: same.id, after: to${n.pascal}Values(input) });
    revalidatePath("${base}");
    return;
  }
`
      : ""
  }  const values = { organizationId: ctx.organizationId, ...to${n.pascal}Values(input) };
  const [created] = await db.insert(${n.variable}).values(values).returning({ id: ${n.variable}.id });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, actorEmail: ctx.email, action: "${n.slug}.created", subjectType: "${n.labelSingular}", subjectId: created?.id ?? null, after: values });
${
  workflow
    ? `  // Its status lives in the workflow (domain.workflow.turbineh): initial state, history and role-gated changes.
  if (created)
    await createItem(ctx, {
      workflow: ${JSON.stringify(workflow.key)},
      title: ${workflowTitle},
      subjectId: created.id,${scope ? `\n      scopeId: input.${scopeKey} ?? null,` : ""}${workflow.dueField ? `\n      dueAt: input.${camel(workflow.dueField)} ? new Date(input.${camel(workflow.dueField)}) : null,` : ""}
    });
`
    : ""
}${
    events.some((l) => l.tracked)
      ? `  if (created) {
${events
  .filter((l) => l.tracked)
  .map((l) => `    ${eventCall(l, "created.id", "null", `String(input.${l.tracked} ?? "")`)}`)
  .join("\n")}
  }
`
      : ""
  }  revalidatePath("${base}");
}

/** Changes one record of the active workspace; business rules run again with the previous values. */
export async function update${n.pascal}(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, ${act("update")})) throw new UserFacingError("You are not allowed to change ${n.labelPlural.toLowerCase()}.");
  if (!rateLimit(\`update:${n.table}:\${ctx.userId}\`)) throw new UserFacingError("Too many requests. Try again later.");
  const id = z.uuid().parse(formData.get("id"));
  const [previous] = await db
    .select()
    .from(${n.variable})
    .where(and(eq(${n.variable}.id, id), eq(${n.variable}.organizationId, ctx.organizationId)))
    .limit(1);
  if (!previous${scope ? ` || !(await canSeeScope(ctx, previous.${scopeKey} ?? null))` : ""}) throw new UserFacingError("This ${n.labelSingular.toLowerCase()} no longer exists.");
  const input = create${n.pascal}Schema.parse(Object.fromEntries(formData));${
    scope
      ? `\n  if (!(await canSeeScope(ctx, input.${scopeKey} ?? null))) throw new UserFacingError("Choose one of your ${scope.label.toLowerCase()} options.");`
      : ""
  }
  const violation = await check${n.pascal}Rules(input, {
    operation: "update",
    previous,
    existing: () => existing${n.pascal}(ctx.organizationId, id),
    related: related${n.pascal}(ctx.organizationId),
  });
  if (violation) throw new UserFacingError(violation);
  const values = to${n.pascal}Values(input);
  await db
    .update(${n.variable})
    .set(values)
    .where(and(eq(${n.variable}.id, id), eq(${n.variable}.organizationId, ctx.organizationId)));
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, actorEmail: ctx.email, action: "${n.slug}.updated", subjectType: "${n.labelSingular}", subjectId: id, before: previous, after: { ...previous, ...values } });
${events
  .filter((l) => l.tracked)
  .map(
    (
      l,
    ) => `  // Every change of ${label(l.tracked ?? "").toLowerCase()} is recorded (append-only history, ${entityNames(l.event.name).labelPlural}).
  if (String(previous.${l.tracked} ?? "") !== String(input.${l.tracked} ?? "")) {
    ${eventCall(l, "id", `previous.${l.tracked} ?? null`, `String(input.${l.tracked} ?? "")`)}
  }
`,
  )
  .join("")}  revalidatePath("${base}");
  redirect("${base}");
}

export async function delete${n.pascal}(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, ${act("delete")})) throw new UserFacingError("You are not allowed to delete ${n.labelPlural.toLowerCase()}.");
  const id = String(formData.get("id") ?? "");
${
  scope
    ? `  const [target] = await db.select().from(${n.variable}).where(and(eq(${n.variable}.id, id), eq(${n.variable}.organizationId, ctx.organizationId))).limit(1);
  if (!target || !(await canSeeScope(ctx, target.${scopeKey} ?? null))) throw new UserFacingError("This ${n.labelSingular.toLowerCase()} no longer exists.");
`
    : ""
}  const removed = await db
    .delete(${n.variable})
    .where(and(eq(${n.variable}.id, id), eq(${n.variable}.organizationId, ctx.organizationId)))
    .returning();
  for (const before of removed)
    await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, actorEmail: ctx.email, action: "${n.slug}.deleted", subjectType: "${n.labelSingular}", subjectId: before.id, before });
  revalidatePath("${base}");
}
${
  features.csvImport
    ? `
/** CSV import (component data.csv-import.turbineh): bounded size and rows, every row validated. */
export async function import${n.pascal}Csv(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, ${act("create")})) throw new UserFacingError("You are not allowed to import ${n.labelPlural.toLowerCase()}.");
  if (!rateLimit(\`import:${n.table}:\${ctx.userId}\`, 5)) throw new UserFacingError("Too many imports. Try again later.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserFacingError("Choose a CSV file.");
  if (file.size > CSV_LIMITS.maxBytes) throw new UserFacingError("The CSV file is too large.");
  const rows = parseCsv(await file.text());
  const valid = rows.map((r) => create${n.pascal}Schema.safeParse(r)).filter((r) => r.success).map((r) => r.data);
  // Business rules apply to imports too: each row is checked against the workspace and the rows accepted before it.
  let known: ${n.pascal}Row[] | null = null;
  const existing = async () => (known ??= await existing${n.pascal}(ctx.organizationId));
  const related = related${n.pascal}(ctx.organizationId);
  const accepted = [];
  for (const input of valid) {
    if (await check${n.pascal}Rules(input, { operation: "create", previous: null, existing, related })) continue;
    const values = { organizationId: ctx.organizationId, ...to${n.pascal}Values(input) };
    accepted.push(values);
    (await existing()).unshift({ id: crypto.randomUUID(), createdAt: new Date(), ...values });
  }
  if (accepted.length > 0) {
    await db.insert(${n.variable}).values(accepted);
    await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, actorEmail: ctx.email, action: "${n.slug}.imported", subjectType: "${n.labelSingular}", summary: \`\${accepted.length} imported from CSV, \${rows.length - accepted.length} rejected\` });
  }
  revalidatePath("${base}");
  redirect(\`${base}?imported=\${accepted.length}&rejected=\${rows.length - accepted.length}\`);
}
`
    : ""
}`;

  const scopeField = scope ? fields.find((f) => camel(f.name) === scopeKey) : undefined;
  const scopeSelect = (id: string, current: string) => `          <div>
            <Label htmlFor="${id}">${scope?.label ?? ""}</Label>
            <select id="${id}" name="${scopeKey}" className="w-full rounded-md border border-field px-3 py-2 text-sm focus:outline-brand" defaultValue={${current}}>
              <option value="">—</option>
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>`;
  const formFields = fields
    .map((f) => {
      const id = `${n.slug}-${snake(f.name)}`;
      if (f === scopeField) return scopeSelect(id, `""`);
      if (f.type === "boolean") {
        return `          <div className="flex items-center gap-2">
            <input id="${id}" name="${camel(f.name)}" type="checkbox" />
            <Label htmlFor="${id}">${label(f.name)}</Label>
          </div>`;
      }
      if (hasOptions(f)) {
        return `          <div>
            <Label htmlFor="${id}">${label(f.name)}</Label>
            <select id="${id}" name="${camel(f.name)}" className="w-full rounded-md border border-field px-3 py-2 text-sm focus:outline-brand"${f.required ? " required" : ""}>
${f.required ? "" : `              <option value="">—</option>\n`}${f.options.map((o) => `              <option value=${JSON.stringify(o)}>${o}</option>`).join("\n")}
            </select>
          </div>`;
      }
      const step = f.type === "decimal" ? ` step="0.01"` : "";
      const hint =
        f.type === "tags" ? ` placeholder="Comma-separated, e.g. pricing, onboarding"` : "";
      return `          <div>
            <Label htmlFor="${id}">${label(f.name)}</Label>
            <Input id="${id}" name="${camel(f.name)}" type="${inputType(f)}"${step}${hint}${f.required ? " required" : ""} />
          </div>`;
    })
    .join("\n");

  const firstText = fields.find((f) => ["string", "text", "enum", "reference"].includes(f.type));
  const search = firstText ? camel(firstText.name) : null;
  const columns = fields.map((f) => camel(f.name));

  // One list query (filters, scope, order) shared by the list page and the CSV export, so the export contains exactly
  // the filtered list.
  const defaultSort = opts.sort?.direction === "asc" ? "oldest" : "newest";
  const query = `${GENERATED}
import { and, ${tagField ? "arrayContains, " : ""}${sortField ? "asc, " : ""}desc, eq${search ? ", ilike" : ""}${scope ? ", inArray, isNull" : ""}, type SQL } from "drizzle-orm";
import { ${n.variable} } from "@/db/schema";
import { parseQuery } from "@/lib/pagination";
${scope ? `import { visibleScopes, type ScopeContext } from "@/server/record-access";\n` : ""}
type Raw = Record<string, string | string[] | undefined>;

/** Filters of the ${n.labelPlural.toLowerCase()} list, from the query string (bounded, trimmed). */
export interface ${n.pascal}ListParams {
  q: string;
${tagField ? "  tag: string;\n" : ""}${sortField ? `  sort: "newest" | "oldest" | "added";\n` : ""}}

export function ${camel(n.pascal)}ListParams(raw: Raw): ${n.pascal}ListParams {
  return {
    q: parseQuery(raw.q),
${tagField ? "    tag: parseQuery(raw.tag).toLowerCase(),\n" : ""}${sortField ? `    sort: raw.sort === "oldest" || raw.sort === "newest" || raw.sort === "added" ? raw.sort : "${defaultSort}",\n` : ""}  };
}

/** The same filters as a query string ("" when none), for pagination and export links. */
export function ${camel(n.pascal)}ListQuery(p: ${n.pascal}ListParams): string {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
${tagField ? `  if (p.tag) qs.set("tag", p.tag);\n` : ""}${sortField ? `  qs.set("sort", p.sort);\n` : ""}  return qs.toString();
}

/** Workspace${scope ? ", visible scopes" : ""} and filters (where) and the list order. */
export async function ${camel(n.pascal)}ListWhere(
  ctx: { organizationId: string${scope ? "; userId: string; role: string" : ""} },
  p: ${n.pascal}ListParams,
): Promise<{ where: SQL | undefined; order: SQL }> {
${scope ? `  const scopes = await visibleScopes(ctx as ScopeContext);\n` : ""}  return {
    where: and(
      eq(${n.variable}.organizationId, ctx.organizationId),
      ${search ? `p.q ? ilike(${n.variable}.${search}, \`%\${p.q.replace(/[%_\\\\]/g, "\\\\$&")}%\`) : undefined` : "undefined"},${tagField ? `\n      p.tag ? arrayContains(${n.variable}.${camel(tagField.name)}, [p.tag]) : undefined,` : ""}${scope ? `\n      scopes === "all" ? undefined : scopes.length ? inArray(${n.variable}.${scopeKey}, scopes) : isNull(${n.variable}.id),` : ""}
    ),
    order: ${
      sortField
        ? `p.sort === "added" ? desc(${n.variable}.createdAt) : p.sort === "oldest" ? asc(${n.variable}.${camel(sortField.name)}) : desc(${n.variable}.${camel(sortField.name)})`
        : `desc(${n.variable}.createdAt)`
    },
  };
}
`;

  const listParams = `${camel(n.pascal)}ListParams`;
  const listQuery = `${camel(n.pascal)}ListQuery`;
  const listWhere = `${camel(n.pascal)}ListWhere`;
  const stateColumn = workflow ? `"Status", ` : "";
  const page = `${GENERATED}
import { ${workflow ? "and, count, eq, inArray" : "count"} } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { ${n.variable}${workflow ? ", workflowItems" : ""} } from "@/db/schema";
import { create${n.pascal}, delete${n.pascal}${features.csvImport ? `, import${n.pascal}Csv` : ""} } from "@/entities/${n.slug}/actions";
import { ${listParams}, ${listQuery}, ${listWhere} } from "@/entities/${n.slug}/query";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { can, requireMember } from "@/server/authz";
${scope ? `import { scopeOptions } from "@/server/record-access";\n` : ""}${workflow ? `import { workflowOf } from "@/workflow/config";\nimport { stateLabel } from "@/workflow/engine";\n` : ""}
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ${n.pascal}Page({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMember();
  const params = await searchParams;
  const { page, offset, limit } = parsePage(params.page);
  const filters = ${listParams}(params);
${search ? "  const { q } = filters;\n" : ""}${tagField ? `  const { tag } = filters;\n` : ""}${
    sortField
      ? `  // Sort order from the request: ${label(sortField.name).toLowerCase()}, ${defaultSort} first by default.\n  const { sort } = filters;\n`
      : ""
  }  const { where, order } = await ${listWhere}(ctx, filters);
  const [rows, [{ total } = { total: 0 }]${scope ? ", scopes" : ""}] = await Promise.all([
    db.select().from(${n.variable}).where(where).orderBy(order).limit(limit).offset(offset),
    db.select({ total: count() }).from(${n.variable}).where(where),${scope ? "\n    scopeOptions(ctx)," : ""}
  ]);
${
  workflow
    ? `  // Current state of each record's workflow item (domain.workflow.turbineh).
  const wf = workflowOf(${JSON.stringify(workflow.key)});
  const items = rows.length
    ? await db
        .select({ id: workflowItems.id, subjectId: workflowItems.subjectId, state: workflowItems.state })
        .from(workflowItems)
        .where(and(eq(workflowItems.organizationId, ctx.organizationId), eq(workflowItems.workflow, ${JSON.stringify(workflow.key)}), inArray(workflowItems.subjectId, rows.map((r) => r.id))))
    : [];
  const itemOf = (id: string) => items.find((i) => i.subjectId === id);
`
    : ""
}${features.csvExport ? `  const canExport = can(ctx.role, "export", ${resource});\n` : ""}
  const exportQuery = ${listQuery}(filters);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canDelete = ${settings ? "false" : `can(ctx.role, ${act("delete")})`};
  const canUpdate = can(ctx.role, ${act("update")});
  const canCreate = can(ctx.role, ${act("create")});
  const link = (p: number) => \`${base}?page=\${p}\${exportQuery ? \`&\${exportQuery}\` : ""}\`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">${n.labelPlural}</h1>
        ${features.csvExport ? `{canExport ? <a className="text-sm underline" href={\`${base}/export\${exportQuery ? \`?\${exportQuery}\` : ""}\`}>Export CSV</a> : null}` : ""}
      </div>
      {canCreate ? (
      <Card title="${settings ? `Set ${n.labelSingular.toLowerCase()}` : `New ${n.labelSingular.toLowerCase()}`}">
        <form action={create${n.pascal}} className="grid grid-cols-1 gap-4 md:grid-cols-2">
${formFields}
          <div className="md:col-span-2">
            <Button type="submit">Create ${n.labelSingular.toLowerCase()}</Button>
          </div>
        </form>
      </Card>
      ) : null}
${
  features.csvImport
    ? `      <Card title="Import ${n.labelPlural.toLowerCase()} from CSV">
        <form action={import${n.pascal}Csv} className="flex items-end gap-3">
          <div>
            <Label htmlFor="${n.slug}-csv">CSV file (columns: ${columns.join(", ")})</Label>
            <input id="${n.slug}-csv" name="file" type="file" accept=".csv,text/csv" required />
          </div>
          <Button type="submit">Import CSV</Button>
        </form>
        {params.imported ? (
          <p className="mt-2 text-sm text-muted" role="status">
            Imported {String(params.imported)} rows, rejected {String(params.rejected ?? 0)}.
          </p>
        ) : null}
      </Card>
`
    : ""
}      <Card title="All ${n.labelPlural.toLowerCase()}">
        ${
          search
            ? `<form className="mb-4 flex gap-2" role="search">
          <Input aria-label="Search ${n.labelPlural.toLowerCase()}" name="q" defaultValue={q} placeholder="Search by ${label(firstText?.name ?? "")}" />${
            tagField
              ? `
          <Input aria-label="Filter by tag" name="tag" defaultValue={tag} placeholder="Tag" />`
              : ""
          }${
            sortField
              ? `
          <select aria-label="Sort" name="sort" defaultValue={sort} className="rounded-md border border-field px-3 py-2 text-sm">
            <option value="newest">${label(sortField.name)}: newest first</option>
            <option value="oldest">${label(sortField.name)}: oldest first</option>
            <option value="added">Recently added</option>
          </select>`
              : ""
          }
          <Button type="submit">Search</Button>
        </form>`
            : ""
        }
        <Table head={[${fields.map((f) => `"${f === scopeField ? (scope?.label ?? label(f.name)) : label(f.name)}"`).join(", ")}${fields.length ? ", " : ""}${stateColumn}""]}>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line">
${fields.map((f) => `              <td className="px-3 py-2">{${f === scopeField ? `scopes.find((s) => s.id === row.${camel(f.name)})?.name ?? ""` : f.type === "boolean" ? `row.${camel(f.name)} ? "Yes" : "No"` : f.type === "tags" ? `(row.${camel(f.name)} ?? []).join(", ")` : `String(row.${camel(f.name)} ?? "")`}}</td>`).join("\n")}${
    workflow
      ? `
              <td className="px-3 py-2">
                {(() => {
                  const item = itemOf(row.id);
                  if (!item) return "—";
                  return (
                    <Link className="underline" data-testid="record-state" href={\`/dashboard/workflow/${workflow.key}/\${item.id}\`}>
                      {wf ? stateLabel(wf, item.state) : item.state}
                    </Link>
                  );
                })()}
              </td>`
      : ""
  }
              <td className="flex items-center justify-end gap-3 px-3 py-2">
                {canUpdate ? (
                  <Link className="text-sm underline" href={\`${base}/\${row.id}/edit\`}>
                    Edit
                  </Link>
                ) : null}
                {canDelete ? (
                  <form action={delete${n.pascal}}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="text-sm text-danger" type="submit">
                      Delete
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
        <nav aria-label="Pagination" className="mt-4 flex items-center gap-3 text-sm">
          {page > 1 ? <Link href={link(page - 1)}>Previous</Link> : null}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages ? <Link href={link(page + 1)}>Next</Link> : null}
        </nav>
      </Card>
    </div>
  );
}
`;

  const hasDateTime = fields.some((f) => f.type === "datetime");
  const editFields = fields
    .map((f) => {
      const id = `${n.slug}-edit-${snake(f.name)}`;
      const k = `row.${camel(f.name)}`;
      if (f === scopeField) return scopeSelect(id, `${k} ?? ""`);
      if (f.type === "boolean") {
        return `          <div className="flex items-center gap-2">
            <input id="${id}" name="${camel(f.name)}" type="checkbox" defaultChecked={${k}} />
            <Label htmlFor="${id}">${label(f.name)}</Label>
          </div>`;
      }
      if (hasOptions(f)) {
        return `          <div>
            <Label htmlFor="${id}">${label(f.name)}</Label>
            <select id="${id}" name="${camel(f.name)}" className="w-full rounded-md border border-field px-3 py-2 text-sm focus:outline-brand" defaultValue={${k} ?? ""}${f.required ? " required" : ""}>
${f.required ? "" : `              <option value="">—</option>\n`}${f.options.map((o) => `              <option value=${JSON.stringify(o)}>${o}</option>`).join("\n")}
            </select>
          </div>`;
      }
      const value =
        f.type === "datetime"
          ? `asDateTime(${k})`
          : f.type === "tags"
            ? `(${k} ?? []).join(", ")`
            : f.required
              ? k
              : `${k} ?? ""`;
      const step = f.type === "decimal" ? ` step="0.01"` : "";
      return `          <div>
            <Label htmlFor="${id}">${label(f.name)}</Label>
            <Input id="${id}" name="${camel(f.name)}" type="${inputType(f)}"${step}${f.required ? " required" : ""} defaultValue={${value}} />
          </div>`;
    })
    .join("\n");

  const editPage = `${GENERATED}
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { ${n.variable}${workflow ? ", workflowItems" : ""} } from "@/db/schema";
import { update${n.pascal} } from "@/entities/${n.slug}/actions";
${[
  ...events.map((l) => {
    const en = entityNames(l.event.name);
    return `import { ${en.pascal}Timeline } from "@/entities/${en.slug}/timeline";\n`;
  }),
  ...children.map((l) => {
    const cn = entityNames(l.child.name);
    return `import { ${cn.pascal}Section } from "@/entities/${cn.slug}/section";\n`;
  }),
].join("")}import { can, requireMember } from "@/server/authz";
${scope ? `import { canSeeScope, scopeOptions } from "@/server/record-access";\n` : ""}${workflow ? `import { workflowOf } from "@/workflow/config";\nimport { stateLabel } from "@/workflow/engine";\n` : ""}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
${
  hasDateTime
    ? `/** A stored date and time as the value of a datetime-local input (server time zone). */
const asDateTime = (d: Date | null) =>
  d ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
`
    : ""
}
/** Edit one ${n.labelSingular.toLowerCase()} of the active workspace (owners and admins). */
export default async function Edit${n.pascal}Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMember();
  if (!can(ctx.role, ${act("update")})) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [row] = await db
    .select()
    .from(${n.variable})
    .where(and(eq(${n.variable}.id, id), eq(${n.variable}.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) notFound();
${
  scope
    ? `  if (!(await canSeeScope(ctx, row.${scopeKey} ?? null))) notFound();
  const scopes = await scopeOptions(ctx);
`
    : ""
}${
    workflow
      ? `  const [item] = await db
    .select({ id: workflowItems.id, state: workflowItems.state })
    .from(workflowItems)
    .where(and(eq(workflowItems.organizationId, ctx.organizationId), eq(workflowItems.workflow, ${JSON.stringify(workflow.key)}), eq(workflowItems.subjectId, row.id)))
    .limit(1);
  const wf = workflowOf(${JSON.stringify(workflow.key)});
`
      : ""
  }  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit ${n.labelSingular.toLowerCase()}</h1>
        <Link className="text-sm underline" href="${base}">
          Back to ${n.labelPlural.toLowerCase()}
        </Link>
      </div>
      <Card title="${n.labelSingular} details">
        <form action={update${n.pascal}} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={row.id} />
${editFields}
          <div className="md:col-span-2">
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      </Card>
${
  workflow
    ? `      {item ? (
        <Card title="Status">
          <p className="text-sm">
            <span data-testid="record-state">{wf ? stateLabel(wf, item.state) : item.state}</span> ·{" "}
            <Link className="underline" href={\`/dashboard/workflow/${workflow.key}/\${item.id}\`}>
              Change status and see its history
            </Link>
          </p>
        </Card>
      ) : null}
`
    : ""
}${[
    ...children.map(
      (l) => `      <${entityNames(l.child.name).pascal}Section parentId={row.id} />\n`,
    ),
    ...events.map(
      (l) => `      <${entityNames(l.event.name).pascal}Timeline parentId={row.id} />\n`,
    ),
  ].join("")}    </div>
  );
}
`;

  const exportRoute = `${GENERATED}
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
import { ${listParams}, ${listWhere} } from "@/entities/${n.slug}/query";
import { toCsv } from "@/lib/csv";
import { can, requireMember } from "@/server/authz";

/**
 * CSV export (component data.csv-export.turbineh): exactly the list as filtered on screen (same query string), in the
 * active workspace, for roles that may export.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await requireMember();
  if (!can(ctx.role, "export", ${resource})) return new Response("Forbidden", { status: 403 });
  const { where, order } = await ${listWhere}(
    ctx,
    ${listParams}(Object.fromEntries(new URL(request.url).searchParams)),
  );
  const rows = await db.select().from(${n.variable}).where(where).orderBy(order).limit(10_000);
  return new Response(toCsv(rows, ${JSON.stringify(columns)}), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="${n.slug}.csv"',
      "Cache-Control": "no-store",
    },
  });
}
`;

  const sample = (f: Field) => sampleFor(e, f, all);
  // Records the reference fields point to are created first, so the form's values name real records.
  const seeds = (variant = "") =>
    fields.flatMap((f) => {
      const target = referenceTarget(f, e, all);
      const display = target ? displayField(target) : undefined;
      if (!target || !display) return [];
      const t = entityNames(target.name);
      const seed = seedSample(target, e, all, variant);
      const steps = fieldsOf(target)
        .filter((x) => seed[camel(x.name)] !== undefined)
        .map((x) =>
          x.type === "boolean"
            ? `  await page.getByLabel("${label(x.name)}", { exact: true }).check();`
            : hasOptions(x)
              ? `  await page.getByLabel("${label(x.name)}", { exact: true }).selectOption("${seed[camel(x.name)]}");`
              : `  await page.getByLabel("${label(x.name)}", { exact: true }).fill("${seed[camel(x.name)]}");`,
        );
      return [
        `  await page.goto("/dashboard/${t.slug}");
${steps.join("\n")}
  await page.getByRole("button", { name: "Create ${t.labelSingular.toLowerCase()}" }).click();
  await page.getByRole("cell", { name: "${seed[camel(display.name)]}" }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);`,
      ];
    });
  const editable = fields.find(
    (f) =>
      ["string", "text", "enum"].includes(f.type) && !hasOptions(f) && !referenceTarget(f, e, all),
  );
  const fill = (f: Field, value: string) =>
    f.type === "boolean"
      ? `  await page.getByLabel("${label(f.name)}", { exact: true }).check();`
      : hasOptions(f)
        ? `  await page.getByLabel("${label(f.name)}", { exact: true }).selectOption("${value}");`
        : `  await page.getByLabel("${label(f.name)}", { exact: true }).fill("${value}");`;
  const fills = fields
    // The field the edit test changes is filled too, even when optional, so the edit test finds the record.
    .filter((f) => f.required || f === firstText || f === editable)
    .map((f) => fill(f, sample(f)))
    .join("\n");
  // Values unique to one test, so filters and sort orders are checked on records only that test created.
  const uniqueFills = (marker: string, extra: Record<string, string>) =>
    fields
      .filter((f) => f.required || f === firstText || extra[camel(f.name)] !== undefined)
      .map((f) =>
        fill(
          f,
          extra[camel(f.name)] ??
            (f === firstText &&
            !hasOptions(f) &&
            f.type !== "reference" &&
            !referenceTarget(f, e, all)
              ? `${sample(f)} ${marker}`
              : sample(f)),
        ),
      )
      .join("\n");
  const markerText = (marker: string) =>
    firstText && !hasOptions(firstText) && !referenceTarget(firstText, e, all)
      ? `${sample(firstText)} ${marker}`
      : null;
  const expectation = firstText
    ? `  await expect(page.getByRole("cell", { name: "${sample(firstText)}" }).first()).toBeVisible();`
    : `  await expect(page.getByRole("row").nth(1)).toBeVisible();`;

  const csvSample = (suffix: string) =>
    `${columns.join(",")}\\n${fields
      .map((f) => {
        if (f.type === "boolean") return "true";
        if (referenceTarget(f, e, all)) return sampleFor(e, f, all, suffix);
        return importedSample(f, sample(f), suffix);
      })
      .join(",")}\\n`;

  // Opens the edit page of the record a test just created (exact cell of its unique marker).
  const openEdit = (marker: string) => `  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "${marker}", exact: true }) })
    .first()
    .getByRole("link", { name: "Edit" })
    .click();
  await expect(page.getByRole("heading", { name: "Edit ${n.labelSingular.toLowerCase()}" })).toBeVisible();`;
  const createWith = (
    marker: string,
    extra: Record<string, string> = {},
  ) => `${seeds().length ? `${seeds().join("\n")}\n` : ""}  await page.goto("${base}");
${uniqueFills(marker, extra)}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
  await expect(page.getByRole("cell", { name: "${markerText(marker)}", exact: true }).first()).toBeVisible();`;
  const childTests = settings
    ? []
    : children.flatMap((l) => {
        const cn = entityNames(l.child.name);
        const marker = `with-${cn.slug}`;
        const fills = l.fills ?? [];
        const shown = fills.find((f) => !f.select && !f.check);
        if (!markerText(marker) || !shown) return [];
        const steps = fills
          .map((f) =>
            f.check
              ? `  await section.getByLabel("${f.label}", { exact: true }).check();`
              : f.select
                ? `  await section.getByLabel("${f.label}", { exact: true }).selectOption("${f.value}");`
                : `  await section.getByLabel("${f.label}", { exact: true }).fill("${f.value}");`,
          )
          .join("\n");
        return [
          `
test("${actor} adds a ${cn.labelSingular.toLowerCase()} to a ${n.labelSingular.toLowerCase()} and sees it on that ${n.labelSingular.toLowerCase()}'s page", async ({ page }) => {
${createWith(marker)}
${openEdit(markerText(marker) ?? "")}
  const section = page.getByTestId("${cn.slug}-section");
${steps}
  await section.getByRole("button", { name: "Add ${cn.labelSingular.toLowerCase()}" }).click();
  await expect(section.getByText("${shown.value}").first()).toBeVisible();
});
`,
        ];
      });
  const eventTests = settings
    ? []
    : events.flatMap((l) => {
        const tracked = fields.find((f) => camel(f.name) === l.tracked);
        if (!tracked || !hasOptions(tracked) || tracked.options.length < 2) return [];
        const en = entityNames(l.event.name);
        const marker = `history-${en.slug}`;
        const [first = "", second = ""] = tracked.options;
        if (!markerText(marker)) return [];
        return [
          `
test("every ${label(tracked.name).toLowerCase()} change of a ${n.labelSingular.toLowerCase()} is recorded in its history with who and when", async ({ page }) => {
${createWith(marker, { [camel(tracked.name)]: first })}
${openEdit(markerText(marker) ?? "")}
  await page.getByLabel("${label(tracked.name)}", { exact: true }).selectOption("${second}");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/${base.replace(/\//g, "\\/")}$/);
${openEdit(markerText(marker) ?? "")}
  const timeline = page.getByTestId("timeline");
  await expect(timeline.locator("li").last()).toContainText("${second}");${l.map.from ? `\n  await expect(timeline.locator("li").last()).toContainText("${first} → ${second}");` : ""}${l.map.actor ? `\n  await expect(timeline.locator("li").last()).toContainText(OWNER_EMAIL);` : ""}
});

test("${en.labelPlural.toLowerCase()} cannot be changed or deleted, not even directly in the database", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("insert into ${en.table} (organization_id, ${[
      l.parentField,
      l.map.to,
      l.map.at,
    ]
      .filter(Boolean)
      .map((k) => snake(k ?? ""))
      .join(
        ", ",
      )}) values ('e2e-history', 'e2e-parent'${l.map.to ? ", 'e2e'" : ""}${l.map.at ? ", now()" : ""})");
    await expect(client.query("update ${en.table} set organization_id = 'tampered' where organization_id = 'e2e-history'")).rejects.toThrow(/append-only/);
    await expect(client.query("delete from ${en.table} where organization_id = 'e2e-history'")).rejects.toThrow(/append-only/);
  } finally {
    await client.end();
  }
});
`,
        ];
      });

  const e2e = `${GENERATED}
import { expect, test } from "@playwright/test";
${eventTests.length ? `import pg from "pg";\n${events.some((l) => l.map.actor) ? `import { OWNER_EMAIL } from "./helpers";\n` : ""}` : ""}
test("${actor} creates a ${n.labelSingular.toLowerCase()} and sees it in the list", async ({ page }) => {
${seeds().length ? `${seeds().join("\n")}\n` : ""}  await page.goto("${base}");
${fills}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
${expectation}
});
${
  editable
    ? `
test("${actor} edits a ${n.labelSingular.toLowerCase()} and sees the change${opts.auditLog ? "; the change is recorded in the audit log" : ""}", async ({ page }) => {
  await page.goto("${base}");
  // The record this test created (exact cell), not a record another entity's test seeded with a similar name.
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "${sample(editable)}", exact: true }) })
    .first()
    .getByRole("link", { name: "Edit" })
    .click();
  // The list page has a create form with the same labels: wait for the edit page before filling.
  await expect(page.getByRole("heading", { name: "Edit ${n.labelSingular.toLowerCase()}" })).toBeVisible();
  await page.getByLabel("${label(editable.name)}", { exact: true }).fill("${sample(editable)} edited");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("cell", { name: "${sample(editable)} edited" }).first()).toBeVisible();${
    opts.auditLog
      ? `
  await page.goto("/dashboard/audit");
  await expect(
    page.getByTestId("audit-row").filter({ hasText: "${n.slug}.updated" }).first(),
    "the change to the ${n.labelSingular.toLowerCase()} is recorded in the audit log, visible to the owner",
  ).toBeVisible();`
      : ""
  }
});
`
    : ""
}${
    features.csvExport
      ? `
test("${actor} triggers a download of all ${n.labelPlural.toLowerCase()} records in CSV format (export as CSV with a header row)", async ({ page }) => {
  const res = await page.request.get("${base}/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect((await res.text()).split("\\r\\n")[0]).toBe("${columns.join(",")}");
});
${
  search && markerText("exported") && !settings
    ? `
test("${actor} searches ${n.labelPlural.toLowerCase()} by text: the list updates to show only the matching ${n.labelPlural.toLowerCase()}, and the CSV export holds only those filtered results", async ({ page }) => {
${seeds().length ? `${seeds().join("\n")}\n` : ""}  await page.goto("${base}");
${uniqueFills("exported", {})}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
  await expect(page.getByRole("cell", { name: "${markerText("exported")}", exact: true }).first()).toBeVisible();
  await page.goto(\`${base}?q=\${encodeURIComponent("${markerText("exported")}")}\`);
  await expect(page.getByRole("cell", { name: "${markerText("exported")}", exact: true }).first(), "the search shows the matching ${n.labelSingular.toLowerCase()}").toBeVisible();
  await page.goto(\`${base}?q=\${encodeURIComponent("no-such-text-e2e")}\`);
  await expect(page.getByRole("cell", { name: "${markerText("exported")}", exact: true }), "a search that matches nothing hides it").toHaveCount(0);
  const res = await page.request.get(\`${base}/export?q=\${encodeURIComponent("${markerText("exported")}")}\`);
  expect(res.status()).toBe(200);
  const rows = (await res.text()).split("\\r\\n").slice(1).filter(Boolean);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.includes("${markerText("exported")}"))).toBe(true);
});
`
    : ""
}`
      : ""
  }${
    features.csvImport
      ? `
test("${n.labelPlural.toLowerCase()} import from CSV", async ({ page }) => {
${seeds("imported").length ? `${seeds("imported").join("\n")}\n` : ""}  await page.goto("${base}");
  await page.getByLabel(/CSV file/).setInputFiles({ name: "import.csv", mimeType: "text/csv", buffer: Buffer.from("${csvSample("imported")}") });
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 1 rows");
});
`
      : ""
  }${
    tagField && markerText("tagged") && !settings
      ? `
test("${actor} filters ${n.labelPlural.toLowerCase()} by tag: when a tag filter is applied, the list updates to show only the ${n.labelPlural.toLowerCase()} with that tag", async ({ page }) => {
${seeds().length ? `${seeds().join("\n")}\n` : ""}  await page.goto("${base}");
${uniqueFills("tagged", { [camel(tagField.name)]: "e2e-filter, research" })}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
  await expect(page.getByRole("cell", { name: "${markerText("tagged")}", exact: true }).first(), "the ${n.labelSingular.toLowerCase()} is saved with the fields filled in above, tags included").toBeVisible();
  await page.goto("${base}?tag=e2e-filter");
  await expect(page.getByRole("cell", { name: "${markerText("tagged")}", exact: true }).first()).toBeVisible();
  await page.goto("${base}?tag=no-such-tag");
  await expect(page.getByRole("cell", { name: "${markerText("tagged")}", exact: true })).toHaveCount(0);
});
`
      : ""
  }${
    sortField && markerText("latest") && !settings
      ? `
test("${actor} sorts ${n.labelPlural.toLowerCase()} by ${label(sortField.name).toLowerCase()}: selecting a sort order reorders the list (newest or oldest first)", async ({ page }) => {
${seeds().length ? `${seeds().join("\n")}\n` : ""}  await page.goto("${base}");
${uniqueFills("latest", { [camel(sortField.name)]: sortField.type === "date" ? "2099-12-31" : "2099-12-31T10:00" })}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
  await expect(page.getByRole("cell", { name: "${markerText("latest")}", exact: true }).first()).toBeVisible();
  await page.goto("${base}");
${uniqueFills("earliest", { [camel(sortField.name)]: sortField.type === "date" ? "1999-01-01" : "1999-01-01T10:00" })}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
  await expect(page.getByRole("cell", { name: "${markerText("earliest")}", exact: true }).first()).toBeVisible();
  await page.goto("${base}?sort=newest");
  await expect(page.getByRole("row").nth(1)).toContainText("${markerText("latest")}");
  await page.goto("${base}?sort=oldest");
  await expect(page.getByRole("row").nth(1)).toContainText("${markerText("earliest")}");
});
`
      : ""
  }${childTests.join("")}${eventTests.join("")}`;

  return [
    { path: `src/db/tables/${n.slug}.ts`, content: table },
    { path: `src/entities/${n.slug}/schema.ts`, content: schema },
    { path: `src/entities/${n.slug}/actions.ts`, content: actions },
    { path: `src/entities/${n.slug}/rules.ts`, content: rules },
    { path: `src/entities/${n.slug}/related.ts`, content: related },
    { path: `src/entities/${n.slug}/query.ts`, content: query },
    { path: `src/app${base}/page.tsx`, content: page },
    // Under /<id>/edit (not /<id>): the CSV download link /export must not look like a page route.
    { path: `src/app${base}/[id]/edit/page.tsx`, content: editPage },
    ...(features.csvExport
      ? [{ path: `src/app${base}/export/route.ts`, content: exportRoute }]
      : []),
    { path: `tests/e2e/${n.slug}.spec.ts`, content: e2e },
  ];
}

/** Registry, schema barrel and shared E2E helper for the generated entities. */
export function generateIndexes(
  entities: Entity[],
  opts: {
    recipeTables?: boolean;
    componentTables?: string[];
    extraNav?: { label: string; href: string }[];
    /** Generated by kind (ADR-0044): only these table slugs exist and only these pages get a nav entry. */
    tables?: string[];
    nav?: { label: string; href: string }[];
  } = {},
): GeneratedFile[] {
  const names = entities.map((e) => entityNames(e.name));
  const slugs = opts.tables ?? names.map((n) => n.slug);
  const barrel = [
    ...(opts.recipeTables ? ['export * from "./recipe-tables";'] : []),
    ...(opts.componentTables ?? []).map((t) => `export * from "./${t}";`),
    ...slugs.map((slug) => `export * from "./tables/${slug}";`),
  ];
  const nav = [
    ...(opts.extraNav ?? []),
    ...(opts.nav ?? names.map((n) => ({ label: n.labelPlural, href: `/dashboard/${n.slug}` }))),
  ];
  return [
    {
      path: "src/db/schema.ts",
      content: `${GENERATED}\n${barrel.length ? barrel.join("\n") + "\n" : "export {};\n"}`,
    },
    {
      path: "src/entities/index.ts",
      content: `${GENERATED}\nexport const entityNav: { label: string; href: string }[] = [\n${nav
        .map((e) => `  { label: ${JSON.stringify(e.label)}, href: ${JSON.stringify(e.href)} },`)
        .join("\n")}\n];\n`,
    },
  ];
}

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

function column(f: Field): string {
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

function zodField(f: Field): string {
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

function inputType(f: Field): string {
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
  if (l.map.actor) parts.push(`${l.map.actor}: ctx.userId`);
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
  const base = settings ? `/dashboard/settings/${n.slug}` : `/dashboard/${n.slug}`;
  // The template's role policy: can(role, action). Settings are changed by those who may update records.
  const act = (a: "create" | "update" | "delete") => (settings ? `"update"` : `"${a}"`);
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
${events
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
  if (!previous) throw new UserFacingError("This ${n.labelSingular.toLowerCase()} no longer exists.");
  const input = create${n.pascal}Schema.parse(Object.fromEntries(formData));
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
  const removed = await db
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

  const formFields = fields
    .map((f) => {
      const id = `${n.slug}-${snake(f.name)}`;
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

  const page = `${GENERATED}
import { and, ${tagField ? "arrayContains, " : ""}${sortField ? "asc, " : ""}count, desc, eq${search ? ", ilike" : ""} } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
import { create${n.pascal}, delete${n.pascal}${features.csvImport ? `, import${n.pascal}Csv` : ""} } from "@/entities/${n.slug}/actions";
import { PAGE_SIZE, parsePage, parseQuery } from "@/lib/pagination";
import { can, requireMember } from "@/server/authz";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ${n.pascal}Page({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireMember();
  const params = await searchParams;
  const { page, offset, limit } = parsePage(params.page);
  const q = parseQuery(params.q);
${tagField ? `  const tag = parseQuery(params.tag).toLowerCase();\n` : ""}${
    sortField
      ? `  // Sort order from the request: ${label(sortField.name).toLowerCase()}, ${opts.sort?.direction === "asc" ? "oldest" : "newest"} first by default.
  const sort = params.sort === "oldest" || params.sort === "newest" || params.sort === "added" ? params.sort : "${opts.sort?.direction === "asc" ? "oldest" : "newest"}";
  const order = sort === "added" ? desc(${n.variable}.createdAt) : sort === "oldest" ? asc(${n.variable}.${camel(sortField.name)}) : desc(${n.variable}.${camel(sortField.name)});\n`
      : ""
  }  const where = and(
    eq(${n.variable}.organizationId, ctx.organizationId),
    ${search ? `q ? ilike(${n.variable}.${search}, \`%\${q.replace(/[%_\\\\]/g, "\\\\$&")}%\`) : undefined` : "undefined"},${tagField ? `\n    tag ? arrayContains(${n.variable}.${camel(tagField.name)}, [tag]) : undefined,` : ""}
  );
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.select().from(${n.variable}).where(where).orderBy(${sortField ? "order" : `desc(${n.variable}.createdAt)`}).limit(limit).offset(offset),
    db.select({ total: count() }).from(${n.variable}).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canDelete = ${settings ? "false" : `can(ctx.role, ${act("delete")})`};
  const canUpdate = can(ctx.role, ${act("update")});
  const canCreate = can(ctx.role, ${act("create")});
  const link = (p: number) => \`${base}?page=\${p}\${q ? \`&q=\${encodeURIComponent(q)}\` : ""}${tagField ? `\${tag ? \`&tag=\${encodeURIComponent(tag)}\` : ""}` : ""}${sortField ? `&sort=\${sort}` : ""}\`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">${n.labelPlural}</h1>
        ${features.csvExport ? `<a className="text-sm underline" href="${base}/export">Export CSV</a>` : ""}
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
        <Table head={[${fields.map((f) => `"${label(f.name)}"`).join(", ")}${fields.length ? ", " : ""}""]}>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line">
${fields.map((f) => `              <td className="px-3 py-2">{${f.type === "boolean" ? `row.${camel(f.name)} ? "Yes" : "No"` : f.type === "tags" ? `(row.${camel(f.name)} ?? []).join(", ")` : `String(row.${camel(f.name)} ?? "")`}}</td>`).join("\n")}
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
import { ${n.variable} } from "@/db/schema";
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
  return (
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
${[
  ...children.map(
    (l) => `      <${entityNames(l.child.name).pascal}Section parentId={row.id} />\n`,
  ),
  ...events.map((l) => `      <${entityNames(l.event.name).pascal}Timeline parentId={row.id} />\n`),
].join("")}    </div>
  );
}
`;

  const exportRoute = `${GENERATED}
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
import { toCsv } from "@/lib/csv";
import { requireMember } from "@/server/authz";

/** CSV export (component data.csv-export.turbineh), scoped to the active workspace. */
export async function GET(): Promise<Response> {
  const ctx = await requireMember();
  const rows = await db
    .select()
    .from(${n.variable})
    .where(eq(${n.variable}.organizationId, ctx.organizationId))
    .orderBy(desc(${n.variable}.createdAt))
    .limit(10_000);
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
    .filter((f) => f.required || f === firstText)
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

  const e2e = `${GENERATED}
import { expect, test } from "@playwright/test";

test("owner creates a ${n.labelSingular.toLowerCase()} and sees it in the list", async ({ page }) => {
${seeds().length ? `${seeds().join("\n")}\n` : ""}  await page.goto("${base}");
${fills}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
${expectation}
});
${
  editable
    ? `
test("owner edits a ${n.labelSingular.toLowerCase()} and sees the change", async ({ page }) => {
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
  await expect(page.getByRole("cell", { name: "${sample(editable)} edited" }).first()).toBeVisible();
});
`
    : ""
}${
    features.csvExport
      ? `
test("${n.labelPlural.toLowerCase()} export as CSV with a header row", async ({ page }) => {
  const res = await page.request.get("${base}/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect((await res.text()).split("\\r\\n")[0]).toBe("${columns.join(",")}");
});
`
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
test("owner filters ${n.labelPlural.toLowerCase()} by tag", async ({ page }) => {
${seeds().length ? `${seeds().join("\n")}\n` : ""}  await page.goto("${base}");
${uniqueFills("tagged", { [camel(tagField.name)]: "e2e-filter, research" })}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
  await expect(page.getByRole("cell", { name: "${markerText("tagged")}", exact: true }).first()).toBeVisible();
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
test("owner sorts ${n.labelPlural.toLowerCase()} by ${label(sortField.name).toLowerCase()}", async ({ page }) => {
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
  }`;

  return [
    { path: `src/db/tables/${n.slug}.ts`, content: table },
    { path: `src/entities/${n.slug}/schema.ts`, content: schema },
    { path: `src/entities/${n.slug}/actions.ts`, content: actions },
    { path: `src/entities/${n.slug}/rules.ts`, content: rules },
    { path: `src/entities/${n.slug}/related.ts`, content: related },
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
  } = {},
): GeneratedFile[] {
  const names = entities.map((e) => entityNames(e.name));
  const barrel = [
    ...(opts.recipeTables ? ['export * from "./recipe-tables";'] : []),
    ...(opts.componentTables ?? []).map((t) => `export * from "./${t}";`),
    ...names.map((n) => `export * from "./tables/${n.slug}";`),
  ];
  const nav = [
    ...(opts.extraNav ?? []),
    ...names.map((n) => ({ label: n.labelPlural, href: `/dashboard/${n.slug}` })),
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

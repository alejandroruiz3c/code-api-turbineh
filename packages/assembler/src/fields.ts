import { sensitiveField, stateField, tenantField, type BuildSpec } from "@turbineh/compiler";
import { camel, snake, words } from "./naming.js";

/**
 * Field-level code generation shared by every generated entity (ADR-0054): which fields are built, the single source
 * of their limits, their column, schema, values and cell, and the database checks that hold even outside the app.
 */
type Entity = BuildSpec["entities"][number];
export type Field = Entity["fields"][number];

/** Columns the generator owns; model-proposed duplicates are dropped. */
const RESERVED_FIELDS = new Set(["id", "organizationId", "createdAt", "updatedAt"]);

/**
 * Fields the generator builds: never a secret or credential (token, secret, password, API key…: no column, form,
 * table, CSV, props or logs — reported as not covered instead), never a tenant id (the server owns organizationId; a
 * free workspaceId or tenantId next to it would let a form move a record between tenants).
 */
export function fieldsOf(e: Entity): Field[] {
  const seen = new Set<string>();
  return e.fields.filter((f) => {
    const key = camel(f.name);
    if (RESERVED_FIELDS.has(key) || seen.has(key)) return false;
    if (sensitiveField(f.name) || tenantField(f.name)) return false;
    seen.add(key);
    return true;
  });
}

/** An enum field with the values the request lists (rendered as a select). */
export const hasOptions = (f: Field): f is Field & { options: string[] } =>
  f.type === "enum" && Array.isArray(f.options) && f.options.length > 0;

/** Workflow state (status, stage, approvalStatus, publishedAt, approvedBy…): never typed in a form. */
export const isStateField = (f: Field): boolean => stateField(f.name) !== null;

/** Fields people type in the create/edit forms and CSV imports: everything but workflow state. */
export function inputsOf(e: Entity): Field[] {
  return fieldsOf(e).filter((f) => !isStateField(f));
}

/**
 * State fields changed by a role-gated server action (a select of their values on the record's page): the status,
 * stage or approval status with the values the request lists.
 */
export function transitionFields(e: Entity): Field[] {
  // With listed values the form is a select; without, a short text the same role-gated action validates.
  return fieldsOf(e).filter((f) => stateField(f.name) === "state" && f.type !== "boolean");
}

/** Approval-like transitions need the "approve" privilege; other state moves (a stage) need "update". */
export function transitionPermission(f: Field): "approve" | "update" {
  const approval =
    /approv|review|publish/i.test(f.name) ||
    (f.options ?? []).some((o) =>
      /^(approved|rejected|published|accepted|declined|paid|refunded|verified)$/i.test(o.trim()),
    );
  return approval ? "approve" : "update";
}

/**
 * Lifecycle fields a transition to `value` stamps: "approvedAt" and "approvedBy" when the status becomes
 * "Approved", "isPublished" when it becomes "Published". Deterministic; other lifecycle fields keep their value.
 */
export function stampsFor(e: Entity, value: string): Field[] {
  const v = words(value).join(" ");
  return fieldsOf(e).filter((f) => {
    if (stateField(f.name) !== "lifecycle") return false;
    const w = words(f.name).filter((x) => x !== "is" && x !== "has");
    const stem = (
      ["at", "on", "by", "date", "time"].includes(w.at(-1) ?? "") ? w.slice(0, -1) : w
    ).join(" ");
    return stem !== "" && stem === v;
  });
}

/**
 * Single source of the length and range limits of generated fields: the database column, the Zod schema and the
 * form input use the same numbers, so a value the form accepts always fits the column.
 */
export const FIELD_LIMITS = {
  string: 255,
  email: 320,
  enum: 64,
  reference: 255,
  text: 5000,
  url: 2048,
  integer: { min: 0, max: 2_147_483_647, signedMin: -2_147_483_648 },
  /** numeric(12, 2). */
  decimal: { min: 0, max: 9_999_999_999.99, signedMin: -9_999_999_999.99 },
} as const;

const SIGNED_WORDS = new Set([
  "balance",
  "delta",
  "adjustment",
  "offset",
  "difference",
  "change",
  "variance",
  "net",
  "profit",
  "temperature",
  "latitude",
  "longitude",
  "lat",
  "lng",
  "correction",
]);

/** Numbers that may be negative by meaning (a balance, an adjustment, a temperature); every other number is >= 0. */
export const signedNumber = (f: Field): boolean => words(f.name).some((w) => SIGNED_WORDS.has(w));

/** Max length of a text-like field (the same for the column, the schema and the input). */
export function maxLength(f: Field): number | null {
  if (hasOptions(f)) return Math.max(FIELD_LIMITS.enum, ...f.options.map((o) => o.length));
  switch (f.type) {
    case "string":
      return FIELD_LIMITS.string;
    case "email":
      return FIELD_LIMITS.email;
    case "enum":
      return FIELD_LIMITS.enum;
    case "reference":
      return FIELD_LIMITS.reference;
    case "text":
      return FIELD_LIMITS.text;
    case "file":
      return FIELD_LIMITS.url;
    default:
      return null;
  }
}

/** Companion column of a datetime field: the IANA time zone it was typed in (the instant is stored in UTC). */
export const timeZoneKey = (f: Field) => `${camel(f.name)}TimeZone`;
/** Companion column of a reference field: the referenced record's id (tenant-scoped foreign key, set by the server). */
export const recordIdKey = (f: Field) => `${camel(f.name)}RecordId`;

export function column(f: Field, stateIsInput = false): string {
  const c = snake(f.name);
  const len = maxLength(f) ?? FIELD_LIMITS.string;
  const base = {
    string: `varchar("${c}", { length: ${len} })`,
    email: `varchar("${c}", { length: ${len} })`,
    text: `text("${c}")`,
    enum: `varchar("${c}", { length: ${len} })`,
    file: `text("${c}")`,
    reference: `varchar("${c}", { length: ${len} })`,
    integer: `integer("${c}")`,
    decimal: `numeric("${c}", { precision: 12, scale: 2 })`,
    boolean: `boolean("${c}")`,
    date: `date("${c}")`,
    datetime: `timestamp("${c}", { withTimezone: true })`,
    tags: `text("${c}").array()`,
  }[f.type];
  if (f.type === "tags") return `${base}.notNull().default([])`;
  if (f.type === "boolean") return `${base}.notNull().default(false)`;
  if (isStateField(f) && !stateIsInput) {
    // State is set by the server: its first value on create (database default), then only by transitions.
    return hasOptions(f) ? `${base}.notNull().default(${JSON.stringify(f.options[0])})` : base;
  }
  return `${base}${f.required ? ".notNull()" : ""}`;
}

/** Column lines of one field: the field and its companions (the time zone of a datetime). */
export function columnLines(f: Field, stateIsInput = false): string[] {
  const lines = [`  ${camel(f.name)}: ${column(f, stateIsInput)},`];
  if (f.type === "datetime")
    lines.push(
      `  ${timeZoneKey(f)}: varchar("${snake(f.name)}_time_zone", { length: 64 }).notNull().default("UTC"),`,
    );
  return lines;
}

/** Text safe inside a SQL string literal written in a generated TypeScript template literal. */
function sqlText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/'/g, "''");
}

/** Postgres identifiers are at most 63 bytes. */
export const constraintName = (table: string, col: string, what: string) =>
  `${`${table}_${col}`.slice(0, 62 - what.length)}_${what}`;

/** Database checks of one field (allowed values, non-negative numbers): they hold even outside the app. */
export function fieldChecks(f: Field, table: string): string[] {
  const k = camel(f.name);
  const c = snake(f.name);
  const out: string[] = [];
  if (hasOptions(f))
    out.push(
      `check("${constraintName(table, c, "values")}", sql\`\${t.${k}} in (${f.options.map((o) => `'${sqlText(o)}'`).join(", ")})\`)`,
    );
  if ((f.type === "integer" || f.type === "decimal") && !signedNumber(f))
    out.push(`check("${constraintName(table, c, "non_negative")}", sql\`\${t.${k}} >= 0\`)`);
  return out;
}

export function zodField(f: Field): string {
  const opt = (s: string) => (f.required ? s : `${s}.optional()`);
  const len = maxLength(f) ?? FIELD_LIMITS.string;
  const str = (max: number) =>
    f.required
      ? `z.string().trim().min(1).max(${max})`
      : `z.string().trim().max(${max}).transform((v) => v || undefined).optional()`;
  if (hasOptions(f)) {
    const e = `z.enum(${JSON.stringify(f.options)})`;
    return f.required ? e : `z.union([${e}, z.literal("").transform(() => undefined)]).optional()`;
  }
  const signed = signedNumber(f);
  switch (f.type) {
    case "tags":
      // Comma- or semicolon-separated, normalised (lowercase, unique, at most 20).
      return `z.string().trim().max(500).default("").transform((v) => [...new Set(v.split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20).map((t) => t.slice(0, 40)))`;
    case "string":
    case "enum":
    case "reference":
      return str(len);
    case "file":
      return f.required
        ? `z.url().max(${FIELD_LIMITS.url})`
        : `z.union([z.url().max(${FIELD_LIMITS.url}), z.literal("").transform(() => undefined)]).optional()`;
    case "text":
      return str(FIELD_LIMITS.text);
    case "email":
      return f.required
        ? `z.email().max(${FIELD_LIMITS.email})`
        : `z.union([z.email().max(${FIELD_LIMITS.email}), z.literal("").transform(() => undefined)]).optional()`;
    case "integer":
      return opt(
        `z.coerce.number().int().min(${signed ? FIELD_LIMITS.integer.signedMin : FIELD_LIMITS.integer.min}).max(${FIELD_LIMITS.integer.max})`,
      );
    case "decimal":
      return opt(
        `z.coerce.number().finite().min(${signed ? FIELD_LIMITS.decimal.signedMin : FIELD_LIMITS.decimal.min}).max(${FIELD_LIMITS.decimal.max})`,
      );
    case "boolean":
      return `z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean())`;
    case "date":
      return f.required
        ? `z.iso.date()`
        : `z.union([z.iso.date(), z.literal("").transform(() => undefined)]).optional()`;
    case "datetime":
      // The local date and time as typed; stored in UTC with the zone it was typed in (src/lib/datetime.ts).
      return f.required
        ? `localDateTime`
        : `z.union([localDateTime, z.literal("").transform(() => undefined)]).optional()`;
  }
}

/** Schema lines of one form field and its companions (the time zone a datetime was typed in). */
export function zodLines(f: Field): string[] {
  const lines = [`  ${camel(f.name)}: ${zodField(f)},`];
  if (f.type === "datetime") lines.push(`  ${timeZoneKey(f)}: timeZone,`);
  return lines;
}

/** Column values from a validated input, for one field and its companions. */
export function valueLines(f: Field, indent = "    "): string[] {
  const k = camel(f.name);
  if (f.type === "boolean") return [`${indent}${k}: input.${k},`];
  if (f.type === "decimal")
    return [
      f.required
        ? `${indent}${k}: String(input.${k}),`
        : `${indent}${k}: input.${k} === undefined ? null : String(input.${k}),`,
    ];
  if (f.type === "datetime")
    return [
      f.required
        ? `${indent}${k}: zonedToUtc(input.${k}, input.${timeZoneKey(f)}),`
        : `${indent}${k}: input.${k} ? zonedToUtc(input.${k}, input.${timeZoneKey(f)}) : null,`,
      `${indent}${timeZoneKey(f)}: input.${timeZoneKey(f)},`,
    ];
  return [f.required ? `${indent}${k}: input.${k},` : `${indent}${k}: input.${k} ?? null,`];
}

/** How a stored value is shown in a list cell (a datetime in the zone it was typed in). */
export function cellValue(f: Field, row = "row"): string {
  const k = `${row}.${camel(f.name)}`;
  if (f.type === "boolean") return `${k} ? "Yes" : "No"`;
  if (f.type === "tags") return `(${k} ?? []).join(", ")`;
  if (f.type === "datetime") return `${k} ? formatDateTime(${k}, ${row}.${timeZoneKey(f)}) : ""`;
  return `String(${k} ?? "")`;
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

/** min/max/maxLength attributes of a form input, from FIELD_LIMITS (the browser checks what the server checks). */
export function inputLimits(f: Field): string {
  const len = maxLength(f);
  if (f.type === "integer")
    return ` min={${signedNumber(f) ? FIELD_LIMITS.integer.signedMin : FIELD_LIMITS.integer.min}} max={${FIELD_LIMITS.integer.max}}`;
  if (f.type === "decimal")
    return ` min={${signedNumber(f) ? FIELD_LIMITS.decimal.signedMin : FIELD_LIMITS.decimal.min}} max={${FIELD_LIMITS.decimal.max}}`;
  if (len && ["string", "text", "email", "reference", "file"].includes(f.type))
    return ` maxLength={${len}}`;
  return "";
}

/** Whether generated schema code for these fields needs the datetime helpers. */
export const usesDateTime = (fields: Field[]) => fields.some((f) => f.type === "datetime");

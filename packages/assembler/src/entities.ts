import type { BuildSpec } from "@turbineh/compiler";
import { camel, entityNames, label, snake } from "./naming.js";

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

export function entitiesToGenerate(spec: BuildSpec): Entity[] {
  const seen = new Set<string>();
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
  }[f.type];
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
  switch (f.type) {
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
      return `z.preprocess((v) => v === "on" || v === "true", z.boolean())`;
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
  }[f.type];
}

/** Sample values used by the generated E2E test (deterministic). */
export function sampleValue(f: Field, entityLabel: string): string {
  switch (f.type) {
    case "email":
      return "e2e@example.com";
    case "integer":
      return "7";
    case "decimal":
      return "12.5";
    case "date":
      return "2026-10-13";
    case "datetime":
      return "2026-10-13T10:30";
    case "file":
      return "https://example.com/file.pdf";
    case "boolean":
      return "on";
    default:
      return `${entityLabel} ${label(f.name)} sample`;
  }
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/** All files for one entity: table, form schema, server actions, page and E2E test. */
export function generateEntity(e: Entity): GeneratedFile[] {
  const n = entityNames(e.name);
  const fields = fieldsOf(e);
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

  const schema = `${GENERATED}
import { z } from "zod";

/** Input validation for ${n.labelPlural} (Security Pack: every boundary is validated). */
export const create${n.pascal}Schema = z.object({
${fields.map((f) => `  ${camel(f.name)}: ${zodField(f)},`).join("\n")}
});

export type Create${n.pascal}Input = z.infer<typeof create${n.pascal}Schema>;
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

  const actions = `${GENERATED}
"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
import { create${n.pascal}Schema } from "./schema";

export async function create${n.pascal}(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create")) throw new UserFacingError("You are not allowed to create ${n.labelPlural.toLowerCase()}.");
  if (!rateLimit(\`create:${n.table}:\${ctx.userId}\`)) throw new UserFacingError("Too many requests. Try again later.");
  const input = create${n.pascal}Schema.parse(Object.fromEntries(formData));
  await db.insert(${n.variable}).values({
    organizationId: ctx.organizationId,
${toRow}
  });
  revalidatePath("/dashboard/${n.slug}");
}

export async function delete${n.pascal}(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "delete")) throw new UserFacingError("You are not allowed to delete ${n.labelPlural.toLowerCase()}.");
  const id = String(formData.get("id") ?? "");
  await db
    .delete(${n.variable})
    .where(and(eq(${n.variable}.id, id), eq(${n.variable}.organizationId, ctx.organizationId)));
  revalidatePath("/dashboard/${n.slug}");
}
`;

  const formFields = fields
    .map((f) => {
      const id = `${n.slug}-${snake(f.name)}`;
      if (f.type === "boolean") {
        return `          <div className="flex items-center gap-2">
            <input id="${id}" name="${camel(f.name)}" type="checkbox" />
            <Label htmlFor="${id}">${label(f.name)}</Label>
          </div>`;
      }
      const step = f.type === "decimal" ? ` step="0.01"` : "";
      return `          <div>
            <Label htmlFor="${id}">${label(f.name)}</Label>
            <Input id="${id}" name="${camel(f.name)}" type="${inputType(f)}"${step}${f.required ? " required" : ""} />
          </div>`;
    })
    .join("\n");

  const page = `${GENERATED}
import { desc, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
import { create${n.pascal}, delete${n.pascal} } from "@/entities/${n.slug}/actions";
import { can, requireMember } from "@/server/authz";

export default async function ${n.pascal}Page() {
  const ctx = await requireMember();
  const rows = await db
    .select()
    .from(${n.variable})
    .where(eq(${n.variable}.organizationId, ctx.organizationId))
    .orderBy(desc(${n.variable}.createdAt))
    .limit(100);
  const canDelete = can(ctx.role, "delete");
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">${n.labelPlural}</h1>
      <Card title="New ${n.labelSingular.toLowerCase()}">
        <form action={create${n.pascal}} className="grid grid-cols-1 gap-4 md:grid-cols-2">
${formFields}
          <div className="md:col-span-2">
            <Button type="submit">Create ${n.labelSingular.toLowerCase()}</Button>
          </div>
        </form>
      </Card>
      <Card title="All ${n.labelPlural.toLowerCase()}">
        <Table head={[${fields.map((f) => `"${label(f.name)}"`).join(", ")}${fields.length ? ", " : ""}""]}>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100">
${fields.map((f) => `              <td className="px-3 py-2">{${f.type === "boolean" ? `row.${camel(f.name)} ? "Yes" : "No"` : `String(row.${camel(f.name)} ?? "")`}}</td>`).join("\n")}
              <td className="px-3 py-2 text-right">
                {canDelete ? (
                  <form action={delete${n.pascal}}>
                    <input type="hidden" name="id" value={row.id} />
                    <button className="text-sm text-red-600" type="submit">
                      Delete
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
`;

  const firstText = fields.find((f) => ["string", "text", "enum", "reference"].includes(f.type));
  const fills = fields
    .filter((f) => f.required || f === firstText)
    .map((f) =>
      f.type === "boolean"
        ? `  await page.getByLabel("${label(f.name)}", { exact: true }).check();`
        : `  await page.getByLabel("${label(f.name)}", { exact: true }).fill("${sampleValue(f, n.labelSingular)}");`,
    )
    .join("\n");
  const expectation = firstText
    ? `  await expect(page.getByRole("cell", { name: "${sampleValue(firstText, n.labelSingular)}" })).toBeVisible();`
    : `  await expect(page.getByRole("row")).toHaveCount(2);`;

  const e2e = `${GENERATED}
import { expect, test } from "@playwright/test";

test("owner creates a ${n.labelSingular.toLowerCase()} and sees it in the list", async ({ page }) => {
  await page.goto("/dashboard/${n.slug}");
${fills}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
${expectation}
});
`;

  return [
    { path: `src/db/tables/${n.slug}.ts`, content: table },
    { path: `src/entities/${n.slug}/schema.ts`, content: schema },
    { path: `src/entities/${n.slug}/actions.ts`, content: actions },
    { path: `src/app/dashboard/${n.slug}/page.tsx`, content: page },
    { path: `tests/e2e/${n.slug}.spec.ts`, content: e2e },
  ];
}

/** Registry, schema barrel and shared E2E helper for the generated entities. */
export function generateIndexes(entities: Entity[]): GeneratedFile[] {
  const names = entities.map((e) => entityNames(e.name));
  return [
    {
      path: "src/db/schema.ts",
      content: `${GENERATED}\n${names.map((n) => `export * from "./tables/${n.slug}";`).join("\n")}${names.length ? "\n" : "export {};\n"}`,
    },
    {
      path: "src/entities/index.ts",
      content: `${GENERATED}\nexport const entityNav: { label: string; href: string }[] = [\n${names.map((n) => `  { label: "${n.labelPlural}", href: "/dashboard/${n.slug}" },`).join("\n")}\n];\n`,
    },
  ];
}

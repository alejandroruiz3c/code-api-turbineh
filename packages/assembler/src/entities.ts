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

/** Optional features switched on by components selected for the build. */
export interface EntityFeatures {
  csvExport: boolean;
  csvImport: boolean;
}

/** All files for one entity: table, form schema, server actions, page, optional CSV routes and E2E tests. */
export function generateEntity(
  e: Entity,
  features: EntityFeatures = { csvExport: false, csvImport: false },
): GeneratedFile[] {
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
${features.csvImport ? `import { redirect } from "next/navigation";\n` : ""}import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
${features.csvImport ? `import { CSV_LIMITS, parseCsv } from "@/lib/csv";\n` : ""}import { UserFacingError } from "@/security/errors";
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
${
  features.csvImport
    ? `
/** CSV import (component data.csv-import.turbineh): bounded size and rows, every row validated. */
export async function import${n.pascal}Csv(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create")) throw new UserFacingError("You are not allowed to import ${n.labelPlural.toLowerCase()}.");
  if (!rateLimit(\`import:${n.table}:\${ctx.userId}\`, 5)) throw new UserFacingError("Too many imports. Try again later.");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserFacingError("Choose a CSV file.");
  if (file.size > CSV_LIMITS.maxBytes) throw new UserFacingError("The CSV file is too large.");
  const rows = parseCsv(await file.text());
  const valid = rows.map((r) => create${n.pascal}Schema.safeParse(r)).filter((r) => r.success).map((r) => r.data);
  if (valid.length > 0) {
    await db.insert(${n.variable}).values(
      valid.map((input) => ({
        organizationId: ctx.organizationId,
${toRow.replace(/^ {4}/gm, " ".repeat(8))}
      })),
    );
  }
  revalidatePath("/dashboard/${n.slug}");
  redirect(\`/dashboard/${n.slug}?imported=\${valid.length}&rejected=\${rows.length - valid.length}\`);
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
      const step = f.type === "decimal" ? ` step="0.01"` : "";
      return `          <div>
            <Label htmlFor="${id}">${label(f.name)}</Label>
            <Input id="${id}" name="${camel(f.name)}" type="${inputType(f)}"${step}${f.required ? " required" : ""} />
          </div>`;
    })
    .join("\n");

  const firstText = fields.find((f) => ["string", "text", "enum", "reference"].includes(f.type));
  const search = firstText ? camel(firstText.name) : null;
  const columns = fields.map((f) => camel(f.name));

  const page = `${GENERATED}
import { and, count, desc, eq${search ? ", ilike" : ""} } from "drizzle-orm";
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
  const where = and(
    eq(${n.variable}.organizationId, ctx.organizationId),
    ${search ? `q ? ilike(${n.variable}.${search}, \`%\${q.replace(/[%_\\\\]/g, "\\\\$&")}%\`) : undefined` : "undefined"},
  );
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db.select().from(${n.variable}).where(where).orderBy(desc(${n.variable}.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(${n.variable}).where(where),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canDelete = can(ctx.role, "delete");
  const link = (p: number) => \`/dashboard/${n.slug}?page=\${p}\${q ? \`&q=\${encodeURIComponent(q)}\` : ""}\`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">${n.labelPlural}</h1>
        ${features.csvExport ? `<a className="text-sm underline" href="/dashboard/${n.slug}/export">Export CSV</a>` : ""}
      </div>
      <Card title="New ${n.labelSingular.toLowerCase()}">
        <form action={create${n.pascal}} className="grid grid-cols-1 gap-4 md:grid-cols-2">
${formFields}
          <div className="md:col-span-2">
            <Button type="submit">Create ${n.labelSingular.toLowerCase()}</Button>
          </div>
        </form>
      </Card>
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
          <p className="mt-2 text-sm text-slate-600" role="status">
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
          <Input aria-label="Search ${n.labelPlural.toLowerCase()}" name="q" defaultValue={q} placeholder="Search by ${label(firstText?.name ?? "")}" />
          <Button type="submit">Search</Button>
        </form>`
            : ""
        }
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

  const fills = fields
    .filter((f) => f.required || f === firstText)
    .map((f) =>
      f.type === "boolean"
        ? `  await page.getByLabel("${label(f.name)}", { exact: true }).check();`
        : `  await page.getByLabel("${label(f.name)}", { exact: true }).fill("${sampleValue(f, n.labelSingular)}");`,
    )
    .join("\n");
  const expectation = firstText
    ? `  await expect(page.getByRole("cell", { name: "${sampleValue(firstText, n.labelSingular)}" }).first()).toBeVisible();`
    : `  await expect(page.getByRole("row").nth(1)).toBeVisible();`;

  const csvSample = (suffix: string) =>
    `${columns.join(",")}\\n${fields
      .map((f) => {
        if (f.type === "boolean") return "true";
        const v = sampleValue(f, n.labelSingular);
        return f === firstText ? `${v} ${suffix}` : v;
      })
      .join(",")}\\n`;

  const e2e = `${GENERATED}
import { expect, test } from "@playwright/test";

test("owner creates a ${n.labelSingular.toLowerCase()} and sees it in the list", async ({ page }) => {
  await page.goto("/dashboard/${n.slug}");
${fills}
  await page.getByRole("button", { name: "Create ${n.labelSingular.toLowerCase()}" }).click();
${expectation}
});
${
  features.csvExport
    ? `
test("${n.labelPlural.toLowerCase()} export as CSV with a header row", async ({ page }) => {
  const res = await page.request.get("/dashboard/${n.slug}/export");
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
  await page.goto("/dashboard/${n.slug}");
  await page.getByLabel(/CSV file/).setInputFiles({ name: "import.csv", mimeType: "text/csv", buffer: Buffer.from("${csvSample("imported")}") });
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByRole("status")).toContainText("Imported 1 rows");
});
`
      : ""
  }`;

  return [
    { path: `src/db/tables/${n.slug}.ts`, content: table },
    { path: `src/entities/${n.slug}/schema.ts`, content: schema },
    { path: `src/entities/${n.slug}/actions.ts`, content: actions },
    { path: `src/app/dashboard/${n.slug}/page.tsx`, content: page },
    ...(features.csvExport
      ? [{ path: `src/app/dashboard/${n.slug}/export/route.ts`, content: exportRoute }]
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

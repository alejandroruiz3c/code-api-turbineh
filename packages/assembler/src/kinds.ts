import type { BuildSpec, EntityModel } from "@turbineh/compiler";
import {
  column,
  fieldsOf,
  generateEntity,
  GENERATED,
  hasOptions,
  inputType,
  sampleFor,
  zodField,
  type ChildLink,
  type EntityFeatures,
  type EntityOptions,
  type EventLink,
  type GeneratedFile,
} from "./entities.js";
import { camel, entityNames, label, snake, words } from "./naming.js";

/**
 * Generation by entity kind (ADR-0042 §1, wired by ADR-0044): business entities get CRUD (or their status is a
 * workflow of domain.workflow), configuration gets a settings page, events become an append-only timeline on their
 * parent, child lists and joins are managed on the parent's page, logs get a table and a writer but no UI, and tag
 * entities are already a `tags` field of their parent. Deterministic.
 */
type Entity = BuildSpec["entities"][number];
type Field = Entity["fields"][number];

export interface KindPlanInput {
  /** Entities this build generates code for (recipe- and component-provided ones already removed). */
  entities: Entity[];
  models: readonly EntityModel[];
  features: EntityFeatures;
  /** Default list order stated by the request ("sorted by date, newest first"). */
  sort: { field: string; direction: "asc" | "desc" }[];
  /** Entities whose status is a workflow of domain.workflow.turbineh: entity → { key, field }. */
  workflows: Record<string, { key: string; field: string }>;
  /** Per-record scope of domain.membership-access.turbineh: the entity it is named after (Company, Project, Shop). */
  scope: { entity: string; label: string } | null;
  /** domain.audit-log.turbineh is installed: the edit tests also check the change in the audit log. */
  auditLog?: boolean;
  /** The request's name for the owner role, for generated test titles. */
  ownerLabel?: string | undefined;
}

export interface KindPlan {
  files: GeneratedFile[];
  /** Pages of their own (business CRUD and settings), for the navigation. */
  nav: { label: string; href: string }[];
  /** Generated per entity (owner = entity:<name>). */
  owners: Record<string, string>;
  /** Entity → how it was generated, for AGENTS.md and the fidelity report. */
  generatedAs: { entity: string; kind: string; ui: string; where: string; reason: string }[];
  /** Things the generator could not wire (e.g. a child list of a recipe page): what is left and where. */
  left: { what: string; where: string; how: string }[];
}

const isUserRef = (f: Field) =>
  /(^|[a-z])(by|By|user|User|author|Author|sender|Sender|actor|Actor|uploader|Uploader|staff|Staff)(Id|Email)?$/.test(
    f.name,
  ) || /^(by|user|author|sender|actor|uploader|staff)(id|email)?$/i.test(f.name);

/** Field of `e` that holds the id of `parent` ("pieceId", "documentRequest", "task_id"). */
function parentFieldOf(e: Entity, parent: string): Field | undefined {
  const target = words(parent).join(" ");
  return e.fields.find((f) => {
    const w = words(f.name);
    const stem = (w.at(-1) === "id" ? w.slice(0, -1) : w).join(" ");
    return stem === target || stem === words(parent).at(-1);
  });
}

/** How an event entity records a change of its parent: which fields hold from/to/actor/time. */
export function eventLink(event: Entity, parent: Entity): EventLink | null {
  const pf = parentFieldOf(event, parent.name);
  if (!pf) return null;
  const fs = event.fields.filter((f) => f !== pf);
  const pick = (re: RegExp) => fs.find((f) => re.test(f.name));
  const from = pick(/^(from|previous|prev|old)[A-Z_]/);
  const to = pick(/^(to|new|next)[A-Z_]/);
  const subject = (f: Field | undefined) =>
    f ? camel(f.name.replace(/^(from|previous|prev|old|to|new|next)[_]?/i, "")) : null;
  const tracked =
    fieldsOf(parent).find((f) => camel(f.name) === subject(to) || camel(f.name) === subject(from))
      ?.name ?? null;
  const actor = fs.find((f) => f !== from && f !== to && isUserRef(f));
  const at = fs.find(
    (f) =>
      (f.type === "datetime" || f.type === "date") &&
      /(at|on|date|time)$/i.test(f.name) &&
      f !== from &&
      f !== to,
  );
  return {
    event,
    parentField: camel(pf.name),
    tracked: tracked ? camel(tracked) : null,
    map: {
      ...(from ? { from: camel(from.name) } : {}),
      ...(to ? { to: camel(to.name) } : {}),
      ...(actor ? { actor: camel(actor.name) } : {}),
      ...(at ? { at: camel(at.name) } : {}),
    },
  };
}

/**
 * Event entity as an append-only history: only the parent id, the new value and the time are required (the generator
 * fills them); the previous value, actor and anything else are optional so the writer never needs invented values.
 */
function eventShape(l: EventLink): Entity {
  const keep = new Set([l.parentField, l.map.to, l.map.at].filter(Boolean) as string[]);
  return {
    ...l.event,
    fields: l.event.fields.map((f) => ({
      ...f,
      // Values come from the parent's field (no own options) and are written by code, never typed.
      type: f.type === "enum" || f.type === "reference" ? ("string" as const) : f.type,
      options: undefined,
      required: keep.has(camel(f.name)) && f.required,
    })),
  };
}

function tableFile(e: Entity): string {
  const n = entityNames(e.name);
  const fields = fieldsOf(e);
  const pg = new Set(["pgTable", "uuid", "varchar", "timestamp"]);
  for (const f of fields) pg.add(column(f).split("(")[0] ?? "");
  return `${GENERATED}
import { ${[...pg].sort().join(", ")} } from "drizzle-orm/pg-core";

export const ${n.variable} = pgTable("${n.table}", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: varchar("organization_id", { length: 64 }).notNull(),
${fields.map((f) => `  ${camel(f.name)}: ${column(f)},`).join("\n")}
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
`;
}

const appendOnlySql = (
  table: string,
  about: string,
) => `-- ${about}: the database refuses to change or delete a row, whatever the code does (ADR-0044). Applied by
-- scripts/migrate.ts after the tables exist; idempotent.
CREATE OR REPLACE FUNCTION turbineh_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ${table}_append_only ON ${table};
CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE ON ${table}
  FOR EACH ROW EXECUTE FUNCTION turbineh_append_only();
`;

/** Event entity: table, append-only writer, database trigger and a timeline component for the parent's page. */
export function generateEventEntity(l: EventLink, parent: Entity): GeneratedFile[] {
  const e = eventShape(l);
  const n = entityNames(e.name);
  const p = entityNames(parent.name);
  const fields = fieldsOf(e);
  const shown = (k: string | undefined) =>
    k ? fields.find((f) => camel(f.name) === k) : undefined;
  const when = shown(l.map.at);
  const record = `${GENERATED}
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";

/**
 * Appends one entry to the ${n.labelPlural.toLowerCase()} history of a ${p.labelSingular.toLowerCase()}. Append-only: no code
 * updates or deletes an entry and the database refuses it (src/db/sql/*-${n.slug}-append-only.sql).
 */
export async function record${n.pascal}(values: typeof ${n.variable}.$inferInsert): Promise<void> {
  await db.insert(${n.variable}).values(values);
}
`;
  const cell = (k: string | undefined, fallback: string) =>
    k ? `{String(r.${k} ?? "${fallback}")}` : `"${fallback}"`;
  const timeline = `${GENERATED}
import { and, asc, eq } from "drizzle-orm";
import { Card } from "@/components/ui/card";
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
import { SPEC_CONSTRAINTS } from "@/lib/spec-constraints";
import { requireMember } from "@/server/authz";

const at = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: SPEC_CONSTRAINTS.timeZone,
});

/** History of one ${p.labelSingular.toLowerCase()} (${n.labelPlural.toLowerCase()}): append-only, oldest first, in the app's time zone. */
export async function ${n.pascal}Timeline({ parentId }: { parentId: string }) {
  const ctx = await requireMember();
  const rows = await db
    .select()
    .from(${n.variable})
    .where(and(eq(${n.variable}.organizationId, ctx.organizationId), eq(${n.variable}.${l.parentField}, parentId)))
    .orderBy(asc(${n.variable}.createdAt))
    .limit(500);
  return (
    <Card title="History">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No changes recorded yet.</p>
      ) : (
        <ol data-testid="timeline" className="flex flex-col gap-2 text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <time dateTime={r.createdAt.toISOString()}>{at.format(${when?.type === "datetime" ? `r.${camel(when.name)} ?? r.createdAt` : "r.createdAt"})}</time>
              {" · "}
              {${l.map.from ? `r.${l.map.from} ? \`\${r.${l.map.from}} → \` : ""` : `""`}}
              ${cell(l.map.to, "changed")}
              {" · "}
              ${cell(l.map.actor, "—")}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
`;
  return [
    { path: `src/db/tables/${n.slug}.ts`, content: tableFile(e) },
    { path: `src/entities/${n.slug}/record.ts`, content: record },
    { path: `src/entities/${n.slug}/timeline.tsx`, content: timeline },
    {
      path: `src/db/sql/120-${n.slug}-append-only.sql`,
      content: appendOnlySql(
        n.table,
        `${n.labelPlural} (history of ${p.labelPlural.toLowerCase()})`,
      ),
    },
  ];
}

/** Child list (comments, messages, phases…; joins too): added, listed and removed on the parent's page. */
export function generateChildEntity(l: ChildLink, parent: Entity): GeneratedFile[] {
  const e = l.child;
  const n = entityNames(e.name);
  const p = entityNames(parent.name);
  const all = fieldsOf(e);
  const auto = all.filter((f) => camel(f.name) !== l.parentField && isUserRef(f));
  const fields = all.filter((f) => camel(f.name) !== l.parentField && !auto.includes(f));
  const parentPath = `/dashboard/${p.slug}`;
  const schema = `${GENERATED}
import { z } from "zod";

/** Input of a new ${n.labelSingular.toLowerCase()} (the ${p.labelSingular.toLowerCase()} and the author come from the server). */
export const create${n.pascal}Schema = z.object({
${fields.map((f) => `  ${camel(f.name)}: ${zodField(f)},`).join("\n")}
});
`;
  const values = fields
    .map((f) => {
      const k = camel(f.name);
      if (f.type === "decimal")
        return f.required
          ? `    ${k}: String(input.${k}),`
          : `    ${k}: input.${k} === undefined ? null : String(input.${k}),`;
      return f.type === "boolean" || f.required
        ? `    ${k}: input.${k},`
        : `    ${k}: input.${k} ?? null,`;
    })
    .join("\n");
  const actions = `${GENERATED}
"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { ${n.variable}, ${p.variable} } from "@/db/schema";
import { audit } from "@/lib/audit";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";
import { create${n.pascal}Schema } from "./schema";

/** The parent ${p.labelSingular.toLowerCase()} of the active workspace, or a user-facing error. */
async function parentOf(organizationId: string, id: string): Promise<string> {
  const [row] = await db
    .select({ id: ${p.variable}.id })
    .from(${p.variable})
    .where(and(eq(${p.variable}.id, id), eq(${p.variable}.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new UserFacingError("This ${p.labelSingular.toLowerCase()} no longer exists.");
  return row.id;
}

/** Adds a ${n.labelSingular.toLowerCase()} to a ${p.labelSingular.toLowerCase()} (same workspace, role may create). */
export async function add${n.pascal}(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create", "${n.slug}")) throw new UserFacingError("You are not allowed to add ${n.labelPlural.toLowerCase()}.");
  if (!rateLimit(\`create:${n.table}:\${ctx.userId}\`)) throw new UserFacingError("Too many requests. Try again later.");
  const parentId = await parentOf(ctx.organizationId, z.uuid().parse(formData.get("parentId")));
  const input = create${n.pascal}Schema.parse(Object.fromEntries(formData));
  const values = {
    organizationId: ctx.organizationId,
    ${l.parentField}: parentId,
${auto.map((f) => `    ${camel(f.name)}: ctx.email,`).join("\n")}
${values}
  };
  const [created] = await db.insert(${n.variable}).values(values).returning({ id: ${n.variable}.id });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, actorEmail: ctx.email, action: "${n.slug}.created", subjectType: "${n.labelSingular}", subjectId: created?.id ?? null, after: values });
  revalidatePath(\`${parentPath}/\${parentId}/edit\`);
}

/** Removes a ${n.labelSingular.toLowerCase()} (same workspace, role may delete). */
export async function remove${n.pascal}(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "delete", "${n.slug}")) throw new UserFacingError("You are not allowed to remove ${n.labelPlural.toLowerCase()}.");
  const id = z.uuid().parse(formData.get("id"));
  const removed = await db
    .delete(${n.variable})
    .where(and(eq(${n.variable}.id, id), eq(${n.variable}.organizationId, ctx.organizationId)))
    .returning();
  for (const before of removed) {
    await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, actorEmail: ctx.email, action: "${n.slug}.deleted", subjectType: "${n.labelSingular}", subjectId: before.id, before });
    revalidatePath(\`${parentPath}/\${before.${l.parentField}}/edit\`);
  }
}
`;
  const inputs = fields
    .map((f) => {
      const id = `${n.slug}-${snake(f.name)}`;
      if (f.type === "boolean")
        return `          <div className="flex items-center gap-2">
            <input id="${id}" name="${camel(f.name)}" type="checkbox" />
            <Label htmlFor="${id}">${label(f.name)}</Label>
          </div>`;
      if (hasOptions(f))
        return `          <div>
            <Label htmlFor="${id}">${label(f.name)}</Label>
            <select id="${id}" name="${camel(f.name)}" className="w-full rounded-md border border-field px-3 py-2 text-sm"${f.required ? " required" : ""}>
${f.required ? "" : `              <option value="">—</option>\n`}${f.options.map((o) => `              <option value=${JSON.stringify(o)}>${o}</option>`).join("\n")}
            </select>
          </div>`;
      return `          <div>
            <Label htmlFor="${id}">${label(f.name)}</Label>
            <Input id="${id}" name="${camel(f.name)}" type="${inputType(f)}"${f.type === "decimal" ? ` step="0.01"` : ""}${f.required ? " required" : ""} />
          </div>`;
    })
    .join("\n");
  const shownFields = [...fields, ...auto];
  const section = `${GENERATED}
import { and, asc, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";
import { can, requireMember } from "@/server/authz";
import { add${n.pascal}, remove${n.pascal} } from "./actions";

/** ${n.labelPlural} of one ${p.labelSingular.toLowerCase()}: listed and added on its page (no page of their own). */
export async function ${n.pascal}Section({ parentId }: { parentId: string }) {
  const ctx = await requireMember();
  const rows = await db
    .select()
    .from(${n.variable})
    .where(and(eq(${n.variable}.organizationId, ctx.organizationId), eq(${n.variable}.${l.parentField}, parentId)))
    .orderBy(asc(${n.variable}.createdAt))
    .limit(500);
  const canAdd = can(ctx.role, "create", "${n.slug}");
  const canRemove = can(ctx.role, "delete", "${n.slug}");
  return (
    <section data-testid="${n.slug}-section">
      <Card title="${n.labelPlural}">
        {rows.length === 0 ? <p className="text-sm text-muted">No ${n.labelPlural.toLowerCase()} yet.</p> : null}
        <ul className="mb-4 flex flex-col gap-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 border-b border-line pb-2">
              <span>
${shownFields.map((f) => `                <span className="mr-2">{${f.type === "boolean" ? `r.${camel(f.name)} ? "${label(f.name)}" : ""` : `String(r.${camel(f.name)} ?? "")`}}</span>`).join("\n")}
              </span>
              {canRemove ? (
                <form action={remove${n.pascal}}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-sm text-danger" type="submit">
                    Remove
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {canAdd ? (
        <form action={add${n.pascal}} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input type="hidden" name="parentId" value={parentId} />
${inputs}
          <div className="md:col-span-2">
            <Button type="submit">Add ${n.labelSingular.toLowerCase()}</Button>
          </div>
        </form>
        ) : null}
      </Card>
    </section>
  );
}
`;
  return [
    { path: `src/db/tables/${n.slug}.ts`, content: tableFile(e) },
    { path: `src/entities/${n.slug}/schema.ts`, content: schema },
    { path: `src/entities/${n.slug}/actions.ts`, content: actions },
    { path: `src/entities/${n.slug}/section.tsx`, content: section },
  ];
}

/** Technical log: a table and an append-only writer; no page unless the request asks to show it. */
export function generateLogEntity(e: Entity): GeneratedFile[] {
  const n = entityNames(e.name);
  const shaped: Entity = { ...e, fields: e.fields.map((f) => ({ ...f, required: false })) };
  const record = `${GENERATED}
import { db } from "@/db/client";
import { ${n.variable} } from "@/db/schema";

/**
 * Writes one ${n.labelSingular.toLowerCase()} (technical log, no page: the request did not ask to show it). Call it where the
 * app does the thing it logs, e.g. after sending an email in src/lib/email.ts.
 */
export async function record${n.pascal}(values: typeof ${n.variable}.$inferInsert): Promise<void> {
  await db.insert(${n.variable}).values(values);
}
`;
  return [
    { path: `src/db/tables/${n.slug}.ts`, content: tableFile(shaped) },
    { path: `src/entities/${n.slug}/record.ts`, content: record },
  ];
}

/** Sample values a child's E2E test types (the same samples the entity generator uses). */
export function childFills(
  l: ChildLink,
): { label: string; value: string; select: boolean; check: boolean }[] {
  const e = l.child;
  return fieldsOf(e)
    .filter((f) => camel(f.name) !== l.parentField && !isUserRef(f) && f.required)
    .map((f) => ({
      label: label(f.name),
      value: sampleFor(e, f, [e]),
      select: hasOptions(f),
      check: f.type === "boolean",
    }));
}

/** Plans and generates every entity by its kind. */
export function generateByKind(input: KindPlanInput): KindPlan {
  const plan: KindPlan = { files: [], nav: [], owners: {}, generatedAs: [], left: [] };
  const byName = new Map(input.entities.map((e) => [e.name, e]));
  const modelOf = (name: string) => input.models.find((m) => m.name === name);
  const kindOf = (name: string) => modelOf(name)?.kind ?? "business";
  const own = (name: string, files: GeneratedFile[]) => {
    for (const f of files) plan.owners[f.path] = `entity:${name}`;
    plan.files.push(...files);
  };
  const pageEntities = input.entities.filter((e) => {
    const m = modelOf(e.name);
    return !m || m.ui === "crud" || m.ui === "settings";
  });
  // Events and children attach to a generated parent; otherwise they are generated unmounted, with a note.
  const events: Record<string, EventLink[]> = {};
  const children: Record<string, ChildLink[]> = {};
  for (const e of input.entities) {
    const m = modelOf(e.name);
    if (!m) continue;
    const parent = m.parent ? byName.get(m.parent) : undefined;
    const parentHasPage = parent && pageEntities.includes(parent);
    if (m.kind === "event") {
      const l = parent ? eventLink(e, parent) : null;
      if (l && parent) {
        own(e.name, generateEventEntity(l, parent));
        if (parentHasPage) (events[parent.name] ??= []).push({ ...l, event: eventShape(l) });
        plan.generatedAs.push({
          entity: e.name,
          kind: "event",
          ui: parentHasPage ? "timeline" : "none",
          where: parentHasPage
            ? `src/entities/${entityNames(e.name).slug}/timeline.tsx (on the ${parent.name} edit page)`
            : `src/entities/${entityNames(e.name).slug}/`,
          reason: m.reason,
        });
        if (!parentHasPage)
          plan.left.push({
            what: `Show the ${entityNames(e.name).labelPlural.toLowerCase()} history on the ${m.parent} page`,
            where: `src/entities/${entityNames(e.name).slug}/timeline.tsx`,
            how: `Render <${entityNames(e.name).pascal}Timeline parentId={…} /> on the ${m.parent} page and call record${entityNames(e.name).pascal}() where it changes.`,
          });
        continue;
      }
      // No parent to attach to: an append-only list of its own is the closest faithful shape.
    }
    if (m.kind === "relationship" && (m.shape === "child" || m.shape === "join")) {
      const pf = m.parent ? parentFieldOf(e, m.parent) : undefined;
      const parentEntity = m.parent ? byName.get(m.parent) : undefined;
      if (m.parent && parentEntity && pf) {
        const base: ChildLink = { child: e, parentField: camel(pf.name) };
        const l: ChildLink = { ...base, fills: childFills(base) };
        own(e.name, generateChildEntity(l, parentEntity));
        if (parentHasPage) (children[m.parent] ??= []).push(l);
        plan.generatedAs.push({
          entity: e.name,
          kind: `relationship (${m.shape})`,
          ui: parentHasPage ? "parent" : "none",
          where: `src/entities/${entityNames(e.name).slug}/section.tsx (on the ${m.parent} edit page)`,
          reason: m.reason,
        });
        continue;
      }
      plan.generatedAs.push({
        entity: e.name,
        kind: `relationship (${m.shape})`,
        ui: "none",
        where: "—",
        reason: `${m.reason}; its parent ${m.parent ?? "(unknown)"} is not generated here`,
      });
      if (m.parent)
        plan.left.push({
          what: `${entityNames(e.name).labelPlural} of each ${m.parent}`,
          where: `the ${m.parent} page`,
          how: `List and add ${entityNames(e.name).labelPlural.toLowerCase()} on the ${m.parent} page (no page of their own), scoped to the workspace.`,
        });
      continue;
    }
    if (m.kind === "relationship") {
      plan.generatedAs.push({
        entity: e.name,
        kind: `relationship (${m.shape ?? "link"})`,
        ui: "none",
        where:
          m.shape === "membership"
            ? "src/app/dashboard/members/ (membership-access) or workspace members"
            : "—",
        reason: m.reason,
      });
      continue;
    }
    if (m.kind === "log" && m.ui === "none") {
      own(e.name, generateLogEntity(e));
      plan.generatedAs.push({
        entity: e.name,
        kind: "log",
        ui: "none",
        where: `src/entities/${entityNames(e.name).slug}/record.ts`,
        reason: m.reason,
      });
      continue;
    }
  }
  const generatedPages = pageEntities.filter(
    (e) => !plan.generatedAs.some((g) => g.entity === e.name),
  );
  for (const e of input.entities) {
    if (plan.generatedAs.some((g) => g.entity === e.name)) continue;
    if (!generatedPages.includes(e) && kindOf(e.name) !== "event") continue;
    const settings = kindOf(e.name) === "configuration";
    const wf = settings ? undefined : input.workflows[e.name];
    const scopeField = input.scope && !settings ? parentFieldOf(e, input.scope.entity) : undefined;
    const fields = wf ? e.fields.filter((f) => camel(f.name) !== camel(wf.field)) : e.fields;
    const shaped: Entity = {
      ...e,
      fields: scopeField
        ? fields.map((f) =>
            f === scopeField ? { ...f, type: "string" as const, required: false } : f,
          )
        : fields,
    };
    const dueField = wf
      ? (shaped.fields.find(
          (f) =>
            (f.type === "date" || f.type === "datetime") && /^(due|end|until|return)/i.test(f.name),
        )?.name ?? null)
      : null;
    const n = entityNames(e.name);
    const sortField = input.sort.find((s) =>
      fieldsOf(shaped).some(
        (f) =>
          (f.type === "date" || f.type === "datetime") &&
          (words(f.name).join(" ").includes(s.field) || /date|time/.test(s.field)),
      ),
    );
    const opts: EntityOptions = {
      variant: settings ? "settings" : "crud",
      events: events[e.name] ?? [],
      children: children[e.name] ?? [],
      sort: sortField ?? null,
      workflow: wf ? { key: wf.key, dueField } : null,
      scope: scopeField ? { field: scopeField.name, label: input.scope?.label ?? "Scope" } : null,
      auditLog: input.auditLog === true && !settings,
      ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
    };
    own(e.name, generateEntity(shaped, input.features, input.entities, opts));
    const href = settings ? `/dashboard/settings/${n.slug}` : `/dashboard/${n.slug}`;
    plan.nav.push({ label: settings ? `Settings · ${n.labelPlural}` : n.labelPlural, href });
    plan.generatedAs.push({
      entity: e.name,
      kind: kindOf(e.name),
      ui: settings ? "settings" : wf ? "crud + workflow" : "crud",
      where: `src/app${href}/`,
      reason: modelOf(e.name)?.reason ?? "records people create and work on",
    });
  }
  return plan;
}

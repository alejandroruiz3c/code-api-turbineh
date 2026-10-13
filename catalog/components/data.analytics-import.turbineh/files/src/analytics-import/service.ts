import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { analyticsImports, analyticsRows } from "@/db/schema";
import { audit } from "@/lib/audit";
import { UserFacingError } from "@/security/errors";
import { can } from "@/server/authz";
import { scopeOptions, visibleScopes, type ScopeContext } from "@/server/record-access";
import { dataset as ds, type Period } from "./config";
import { validateCsv, type RowError } from "./rules";

/**
 * Analytics import and queries (component data.analytics-import.turbineh): the only code that writes or aggregates
 * imported rows. Imports are all-or-nothing in one transaction; every query is limited to the workspace and to the
 * scopes (shops, regions…) the person may see.
 */
export interface Actor extends ScopeContext {
  email: string;
}

export interface Filters {
  from: string;
  to: string;
  /** Value of the scope dimension (e.g. one shop), or "" for every visible one. */
  scopeValue: string;
}

/** Imports a whole CSV file or nothing; returns the error report when any row is invalid. */
export async function importCsv(
  ctx: Actor,
  fileName: string,
  text: string,
): Promise<{ ok: true; rows: number } | { ok: false; errors: RowError[] }> {
  if (!can(ctx.role, "create")) throw new UserFacingError("Your role cannot import data.");
  const options = await scopeOptions(ctx);
  const scopes = await visibleScopes(ctx);
  const byName = new Map(options.map((o) => [o.name.toLowerCase(), o.id]));
  const allowed =
    ds.scope && scopes !== "all" ? new Set(options.map((o) => o.name.toLowerCase())) : "all";
  const { rows, errors } = validateCsv(text, ds, allowed);
  if (errors.length) return { ok: false, errors };
  await db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(analyticsImports)
      .values({
        organizationId: ctx.organizationId,
        fileName: fileName.slice(0, 200),
        rows: rows.length,
        createdBy: ctx.userId,
        createdByEmail: ctx.email.toLowerCase(),
      })
      .returning({ id: analyticsImports.id });
    if (!imp) throw new Error("import not recorded");
    for (let i = 0; i < rows.length; i += 1000) {
      await tx.insert(analyticsRows).values(
        rows.slice(i, i + 1000).map((r) => ({
          organizationId: ctx.organizationId,
          importId: imp.id,
          scopeId: ds.scope
            ? (byName.get((r.dimensions[ds.scope] ?? "").toLowerCase()) ?? null)
            : null,
          day: r.date,
          dimensions: r.dimensions,
          measures: r.measures,
        })),
      );
    }
  });
  await audit({
    organizationId: ctx.organizationId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: "analytics.imported",
    subjectType: ds.entity,
    summary: `Imported ${rows.length} rows from "${fileName.slice(0, 120)}"`,
  });
  return { ok: true, rows: rows.length };
}

/** Workspace + visible scopes + date range + scope value. */
async function where(ctx: Actor, f: Filters): Promise<SQL> {
  const scopes = await visibleScopes(ctx);
  const parts: SQL[] = [
    sql`organization_id = ${ctx.organizationId}`,
    sql`day between ${f.from} and ${f.to}`,
  ];
  if (scopes !== "all")
    parts.push(
      scopes.length
        ? sql`scope_id in (${sql.join(
            scopes.map((s) => sql`${s}`),
            sql`, `,
          )})`
        : sql`false`,
    );
  if (ds.scope && f.scopeValue) parts.push(sql`dimensions->>${ds.scope} = ${f.scopeValue}`);
  return sql.join(parts, sql` and `);
}

const sums = () =>
  sql.join(
    ds.measures.map(
      (m, i) => sql`coalesce(sum((measures->>${m})::numeric), 0) as ${sql.identifier(`m${i}`)}`,
    ),
    sql`, `,
  );
/** A period or a dimension value with the sum of every measure (keyed by measure name). */
export type Point = Record<string, number | string> & { period: string };
export type Slice = Record<string, number | string> & { value: string };

const read = (r: Record<string, unknown>) =>
  Object.fromEntries(ds.measures.map((m, i) => [m, Number(r[`m${i}`] ?? 0)]));

export async function totals(ctx: Actor, f: Filters): Promise<Record<string, number>> {
  const r = await db.execute(
    sql`select ${sums()} from analytics_rows where ${await where(ctx, f)}`,
  );
  return read((r.rows[0] ?? {}) as Record<string, unknown>);
}

/** Measures per period (day, week from Monday, month…). */
export async function series(ctx: Actor, f: Filters, period: Period) {
  const r = await db.execute(
    sql`select to_char(date_trunc(${period}, day::timestamp), 'YYYY-MM-DD') as p, ${sums()}
          from analytics_rows where ${await where(ctx, f)} group by 1 order by 1`,
  );
  return (r.rows as Record<string, unknown>[]).map((x): Point => ({
    ...read(x),
    period: String(x.p),
  }));
}

/** Measures per value of a dimension, largest first by the first measure. */
export async function byDimension(ctx: Actor, f: Filters, dimension: string, limit = 20) {
  if (!ds.dimensions.includes(dimension)) return [];
  const r = await db.execute(
    sql`select dimensions->>${dimension} as v, ${sums()} from analytics_rows where ${await where(ctx, f)}
         group by 1 order by 2 desc limit ${limit}`,
  );
  return (r.rows as Record<string, unknown>[]).map((x): Slice => ({
    ...read(x),
    value: String(x.v),
  }));
}

/** Values of the scope dimension this person may see (for the filter). */
export async function scopeValues(ctx: Actor): Promise<string[]> {
  if (!ds.scope) return [];
  const r = await db.execute(
    sql`select distinct dimensions->>${ds.scope} as v from analytics_rows
         where ${await where(ctx, { from: "0001-01-01", to: "9999-12-31", scopeValue: "" })} order by 1 limit 200`,
  );
  return (r.rows as { v: string }[]).map((x) => x.v);
}

/** Latest day with data (the default range ends there). */
export async function lastDay(ctx: Actor): Promise<string | null> {
  const r = await db.execute(
    sql`select to_char(max(day), 'YYYY-MM-DD') as d from analytics_rows
         where ${await where(ctx, { from: "0001-01-01", to: "9999-12-31", scopeValue: "" })}`,
  );
  return ((r.rows[0] as { d: string | null } | undefined)?.d ?? null) || null;
}

/** Latest imports: all of the workspace for those who see every scope, otherwise their own. */
export async function recentImports(ctx: Actor) {
  const all = (await visibleScopes(ctx)) === "all";
  return db
    .select()
    .from(analyticsImports)
    .where(
      and(
        eq(analyticsImports.organizationId, ctx.organizationId),
        all ? undefined : eq(analyticsImports.createdBy, ctx.userId),
      ),
    )
    .orderBy(desc(analyticsImports.createdAt))
    .limit(10);
}
